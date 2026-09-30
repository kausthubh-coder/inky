import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { startLms } from "../../.studi-lms/build/server.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), "studi-browser-replay-"));
const school = await startLms({ scenarioId: "moodle-noisy", runDirectory: join(directory, "school"), seed: 42 });
let child;
try {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electronPath, [join(root, "tests/browser-tools/electron-child.mjs"), JSON.stringify({ root, directory, origins: school.origins })],
    { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  console.log(`replay child pid ${child.pid}`);
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk.toString().slice(0, 1000); });
  child.stdout.on("data", chunk => { console.log(`replay stdout: ${chunk.toString().slice(0, 500)}`); });
  const receipt = await new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Browser replay timed out: ${stderr.slice(-1000)}`)); }, 30_000);
    child.on("message", message => { if (message.progress) { console.log(`replay: ${message.progress}`); return; } clearTimeout(timer); resolveResult(message); });
    child.on("exit", code => { clearTimeout(timer); reject(new Error(`Browser replay exited ${code}: ${stderr.slice(-1000)}`)); });
  });
  if (receipt.error) throw new Error(receipt.error);
  assert.equal(receipt.rows, 130);
  assert.ok(receipt.rowCalls <= 3);
  assert.equal(receipt.iframeReadable, true);
  assert.equal(receipt.submitLab3Opened, true);
  assert.equal(receipt.showMoreExpanded, true);
  assert.equal(receipt.pdfTextReadable, true);
  assert.equal(receipt.imagePdfReadable, true);
  assert.equal(receipt.schoolPostBlocked, true);
  assert.equal(receipt.ssoPostAllowed, true);
  assert.equal(receipt.staleRefErrors, 0);
  assert.ok(receipt.averageActionResultChars < 400);
  assert.ok(receipt.beforeStyleActionResultChars > receipt.averageActionResultChars);
  assert.equal(school.inspect().effects.some(effect => ["submitted", "draft_saved", "submission_committed"].includes(effect.type)), false);
  console.log(JSON.stringify(receipt));
} finally {
  child?.kill();
  await school.close();
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
