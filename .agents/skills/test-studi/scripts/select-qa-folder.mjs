import { mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const name = process.argv[2] ?? "profile";
if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(name)) throw new Error("Invalid QA profile name");
const receipt = JSON.parse((await readFile(resolve(root, ".agents/studi-qa/runs", `${name}.json`), "utf8")).replace(/^\uFEFF/, ""));
if (resolve(receipt.workspaceRoot) !== root) throw new Error("Receipt belongs to another worktree");
const qaRoot = await realpath(resolve(root, ".agents/studi-qa"));
const folder = resolve(qaRoot, `homework-${name}`);
await mkdir(folder, { recursive: true });
const resolvedFolder = await realpath(folder);
const rel = relative(qaRoot, resolvedFolder);
if (rel.startsWith("..") || isAbsolute(rel) || (await readdir(resolvedFolder)).length) throw new Error("Chooser needs an empty, unlinked QA homework folder");
const endpoint = new URL(receipt.mainInspectorEndpoint);
if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1") throw new Error("Expected QA loopback inspector");
const targets = await (await fetch(new URL("/json/list", endpoint), { signal: AbortSignal.timeout(3000) })).json();
const wsUrl = new URL(targets[0].webSocketDebuggerUrl);
if (wsUrl.hostname !== endpoint.hostname || wsUrl.port !== endpoint.port) throw new Error("Inspector mismatch");
const expression = `(() => {
  const electron = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron');
  if (electron.app.isPackaged || electron.app.getPath('userData') !== ${JSON.stringify(receipt.profilePath)}) throw new Error('Wrong QA app');
  const original = electron.dialog.showOpenDialog;
  electron.dialog.showOpenDialog = async (...args) => {
    electron.dialog.showOpenDialog = original;
    const options = args[args.length - 1];
    if (!options?.properties?.includes('openDirectory')) return original(...args);
    return { canceled: false, filePaths: [${JSON.stringify(resolvedFolder)}] };
  };
  return true;
})()`;
await new Promise((resolve, reject) => {
  const socket = new WebSocket(wsUrl);
  const timer = setTimeout(() => { socket.terminate(); reject(new Error("Inspector timed out")); }, 5000);
  socket.on("open", () => socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression } })));
  socket.on("message", raw => {
    const message = JSON.parse(raw);
    if (message.id !== 1) return;
    clearTimeout(timer); socket.close();
    if (message.error || message.result?.exceptionDetails) reject(new Error("QA chooser installation failed"));
    else resolve();
  });
  socket.on("error", error => { clearTimeout(timer); reject(error); });
});
console.log(JSON.stringify({ homeworkFolder: resolvedFolder, simulated: "next native directory choice only", next: "Click Choose an empty folder in Studi" }));
