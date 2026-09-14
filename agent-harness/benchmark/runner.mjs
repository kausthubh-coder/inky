import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayFixture, gradeReplay } from "./replay-cases.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const hash = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
export async function hashTree(root) {
  const entries = [];
  async function walk(directory) {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, item.name);
      if (item.isDirectory()) await walk(path);
      else if (item.isFile()) entries.push([path.slice(root.length + 1).replaceAll("\\", "/"), hash(await readFile(path))]);
    }
  }
  await walk(root);
  return hash(entries);
}
export async function writeJson(path, value) { await writeFile(path, JSON.stringify(value, null, 2) + "\n"); }

// The timeout terminates only the process created for this run. Nonzero exits
// remain failures with an artifact, never a silently discarded trial.
export function runProcess(command, args, { cwd = ROOT, timeoutMs, env = process.env } = {}) {
  return new Promise(resolveResult => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false;
    child.stdout.on("data", chunk => { stdout = (stdout + chunk).slice(-12000); });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-12000); });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.once("error", error => { clearTimeout(timer); resolveResult({ code: null, error: error.message, stdout, stderr, timedOut }); });
    child.once("exit", code => { clearTimeout(timer); resolveResult({ code, stdout, stderr, timedOut }); });
  });
}

export async function runReplay({ buildRoot = join(ROOT, "dist"), gitSha, budgetMs = 60000, maxToolCalls = 120 } = {}) {
  if (!Number.isSafeInteger(budgetMs) || budgetMs < 1000 || budgetMs > 3600000) throw new Error("Invalid wall-time budget");
  if (!Number.isSafeInteger(maxToolCalls) || maxToolCalls < 1 || maxToolCalls > 5000) throw new Error("Invalid tool-call budget");
  const runId = randomUUID(), runRoot = join(ROOT, ".studi-harness/benchmarks", runId);
  await mkdir(runRoot, { recursive: true });
  const configPath = join(runRoot, "config.json");
  const config = { runRoot, storeRoot: join(runRoot, "store"), buildRoot: resolve(buildRoot), fixture: replayFixture, maxToolCalls };
  await writeJson(configPath, config);
  const started = performance.now();
  const processResult = await runProcess(process.execPath, [join(ROOT, "agent-harness/benchmark/replay-driver.mjs"), configPath], { timeoutMs: budgetMs });
  let result;
  try { result = JSON.parse(await readFile(join(runRoot, "replay-result.json"), "utf8")); }
  catch { result = { status: processResult.timedOut ? "timed_out" : "failed", scanState: null, assignments: [], queue: [], errors: [processResult.error ?? processResult.stderr], metrics: { durationMs: performance.now() - started, toolCalls: null, modelCalls: null, usage: null } }; }
  if (processResult.code !== 0) result.status = processResult.timedOut ? "timed_out" : "failed";
  const record = { schemaVersion: 1, runId, evidenceClass: "controlled-production-replay",
    fixture: { scenarioId: replayFixture.scenarioId, version: replayFixture.version, seed: replayFixture.seed, clock: replayFixture.clock, contentHash: hash(replayFixture) },
    config: { model: null, provider: null, effort: null, budgetMs, maxToolCalls, phases: ["cold"] },
    revision: { gitSha: gitSha ?? spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true }).stdout.trim(), buildTreeSha256: await hashTree(buildRoot), harnessTreeSha256: await hashTree(join(ROOT, "agent-harness/benchmark")) },
    scope: "Fixed synthetic observations through production scan recording tools, storage and queue manager. No model, browser controller, UI or efficiency claim.",
    phases: [{ name: "cold", ...result, grade: gradeReplay(replayFixture, result) }],
  };
  const path = join(runRoot, "result.json");
  await writeJson(path, record);
  return { path, record };
}
