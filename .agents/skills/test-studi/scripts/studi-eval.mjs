// Evaluate an expression inside a running QA app's renderer over its receipt's CDP endpoint.
// Usage: node studi-eval.mjs <profileName> "<expression>" [--screenshot <path.png>]
// The expression may return a promise (window.studi calls). Output is JSON on stdout.
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const [name = "profile", expression = "location.href", flag, screenshotPath] = process.argv.slice(2);
const receipt = JSON.parse(
  (await readFile(resolve(root, ".agents/studi-qa/runs", `${name}.json`), "utf8")).replace(/^﻿/, ""),
);
if (resolve(receipt.workspaceRoot) !== root) throw new Error("Receipt belongs to another worktree");
const endpoint = new URL(receipt.cdpEndpoint);
if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1") throw new Error("Expected loopback CDP");
const targets = await (await fetch(new URL("/json/list", endpoint), { signal: AbortSignal.timeout(3000) })).json();
const rendererUrl = new URL("dist/client/index.html", `file:///${root.replaceAll("\\", "/")}/`).href;
const renderer = targets.find((target) => target.type === "page" && target.url.startsWith(rendererUrl));
if (!renderer) throw new Error(`Renderer for this checkout not found among ${targets.map((t) => t.url).join(", ")}`);

const socket = new WebSocket(renderer.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
socket.on("message", (raw) => {
  const message = JSON.parse(raw);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const send = (method, params = {}) =>
  new Promise((done, fail) => {
    const id = nextId++;
    const timer = setTimeout(() => fail(new Error(`${method} timed out`)), 60_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      message.error ? fail(new Error(message.error.message)) : done(message.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
await new Promise((open, fail) => {
  socket.once("open", open);
  socket.once("error", fail);
});
try {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "evaluation failed");
  console.log(JSON.stringify(result.result.value, null, 2));
  if (flag === "--screenshot" && screenshotPath) {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(resolve(root, screenshotPath), Buffer.from(shot.data, "base64"));
  }
} finally {
  socket.close();
}
