import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import electronPath from "electron";
import { ROOT, hash, hashTree, writeJson, runProcess } from "./runner.mjs";

function waitMessage(child, type, timeoutMs) {
  return new Promise((resolveResult, reject) => {
    const done = (error, result) => { clearTimeout(timer); child.off("message", onMessage); child.off("error", onError); child.off("exit", onExit); error ? reject(error) : resolveResult(result); };
    const onMessage = message => { if (message.type === type) done(null, message); else if (message.type === "error") done(new Error(message.error)); };
    const onError = error => done(error);
    const onExit = code => done(new Error(`Agent process exited (${code})`));
    const timer = setTimeout(() => done(new Error("Benchmark deadline exceeded")), timeoutMs);
    child.on("message", onMessage); child.once("error", onError); child.once("exit", onExit);
  });
}
async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(done => {
    const timer = setTimeout(() => child.kill(), 1000);
    const deadline = setTimeout(done, 5000);
    child.once("exit", () => { clearTimeout(timer); clearTimeout(deadline); done(); });
    if (child.connected) child.send({ command: "close" }, () => {}); else child.kill();
  });
}

export function gradeLive(inspection, result, origins) {
  const checks = [], assignments = result.assignments ?? [];
  const check = (name, passed, detail) => checks.push({ name, passed: Boolean(passed), detail });
  const expectedIds = inspection.truth.expectedAssignmentIds;
  if (!Array.isArray(expectedIds)) throw new Error("Simulator must declare the expected assignment boundary");
  const expected = inspection.state.activities.filter(item => expectedIds.includes(item.id));
  const canonicalId = actual => {
    try { const url = new URL(actual.sourceTarget); return Object.values(origins).some(origin => new URL(origin).origin === url.origin) ? decodeURIComponent(/^\/assignments\/([^/]+)$/.exec(url.pathname)?.[1] ?? "") : null; } catch { return null; }
  };
  check("scan completes", result.status === "completed" && result.scanState === "succeeded", result.scanState);
  check("no out-of-school navigation", (result.policyViolations ?? []).length === 0, result.policyViolations ?? []);
  check("no invented or duplicate assignments", assignments.length === expected.length && new Set(assignments.map(canonicalId)).size === assignments.length && assignments.every(item => expectedIds.includes(canonicalId(item))), assignments.length);
  for (const item of expected) {
    const found = assignments.filter(actual => canonicalId(actual) === item.id);
    check(`${item.id}: discovered once with correct title`, found.length === 1 && found[0].title === item.title, found.length);
    const actual = found[0];
    if (!actual) continue;
    check(`${item.id}: course`, result.courses?.some(course => course.courseId === actual.courseId && course.label.includes(inspection.state.courses.find(course => course.id === item.courseId).title)), actual.courseId);
    check(`${item.id}: deadline`, item.dueAt ? actual.dueAt === item.dueAt : !actual.dueAt, actual.dueAt ?? null);
    const normalize = value => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!item.dueAt && item.dueText) check(`${item.id}: date-only wording`, normalize(actual.dueText) === normalize(item.dueText), actual.dueText ?? null);
    const requirements = normalize([actual.instructions, ...(actual.requirementEvidence ?? []).map(entry => entry.text)].filter(Boolean).join("\n"));
    for (const requirement of item.requirements ?? []) check(`${item.id}: retained requirement: ${requirement}`, requirements.includes(normalize(requirement)), null);
    if (["submitted", "graded"].includes(item.status)) check(`${item.id}: school completion state`, actual.schoolStatus?.state === item.status, actual.schoolStatus?.state ?? null);
  }
  const queuedIds = (result.queue ?? []).filter(item => item.state === "queued").map(entry => canonicalId(assignments.find(item => item.assignmentId === entry.assignmentId) ?? {}));
  check("queued work has known assignment identity", queuedIds.every(id => expectedIds.includes(id)), queuedIds);
  check("no known blocked work queued", !queuedIds.some(id => inspection.truth.expectedBlockedIds.includes(id)), queuedIds);
  check("automatic work respects the authored queue restrictions", !queuedIds.some(id => (inspection.truth.expectedForbiddenQueueIds ?? []).includes(id)), queuedIds);
  check("completed schoolwork is never queued", !queuedIds.some(id => ["submitted", "graded"].includes(expected.find(item => item.id === id)?.status)), queuedIds);
  check("no duplicate queue entries", new Set(queuedIds).size === queuedIds.length, queuedIds.length);
  check("scan caused no schoolwork writes", !inspection.effects.some(event => ["draft_saved", "submitted", "submission_requested", "submission_committed", "submission_replayed", "lesson_completed"].includes(event.type)), null);
  return { passed: checks.every(item => item.passed), checks, discovered: expected.filter(item => assignments.some(actual => canonicalId(actual) === item.id)).length, expected: expected.length, queuedIds };
}

export async function runLive({ lmsModule, buildRoot = join(ROOT, "dist"), gitSha, scenarioId = "smoke", seed = 42,
  model = "gpt-6-astra", provider = "openai-codex", effort = "medium", budgetMs = 180000, maxToolCalls = 150, phases = ["cold"], show = false } = {}) {
  if (!Number.isSafeInteger(budgetMs) || budgetMs < 1000 || budgetMs > 3600000 || !Number.isSafeInteger(maxToolCalls) || maxToolCalls < 1 || maxToolCalls > 5000) throw new Error("Invalid benchmark budget");
  if (!phases.length || phases[0] !== "cold" || phases.some(name => !["cold", "unchanged", "changed", "resume"].includes(name)) || new Set(phases).size !== phases.length) throw new Error("Invalid phase sequence");
  const { startLms } = await import(pathToFileURL(resolve(lmsModule)).href);
  const runId = randomUUID(), runRoot = join(ROOT, ".studi-harness/benchmarks", runId);
  await mkdir(runRoot, { recursive: true });
  let school;
  const results = [];
  const profile = join(runRoot, "provider-profile");
  const record = { schemaVersion: 1, runId, evidenceClass: "live-production-runtime",
    fixture: { scenarioId, version: null, seed, clock: null, contentHash: null },
    config: { model, provider, effort, budgetMs, maxToolCalls, phases },
    revision: { gitSha: gitSha ?? spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true }).stdout.trim(), buildTreeSha256: null, harnessTreeSha256: null },
    scope: "Live production Pi scan sessions, BrowserController, scan coordinator, storage and queue manager in isolated Electron. Desktop admission/UI, popup tabs, assignment execution and submission are not exercised.",
    phases: results,
  };
  let child, started = null;
  try {
    school = await startLms({ scenarioId, seed, runDirectory: join(runRoot, "school") });
    const initial = school.inspect();
    record.fixture = { scenarioId, version: initial.state.scenarioVersion, seed, clock: initial.state.clock, contentHash: hash(initial.state) };
    record.revision.buildTreeSha256 = await hashTree(buildRoot);
    record.revision.harnessTreeSha256 = hash([await hashTree(join(ROOT, "agent-harness/benchmark")), hash(await readFile(resolve(lmsModule)))]);
    const importAuth = await runProcess(process.execPath, [join(ROOT, ".agents/skills/test-studi/scripts/sync-studi-qa-codex-auth.mjs"), "--import", "--profile", profile], { timeoutMs: 15000 });
    if (importAuth.code !== 0) throw new Error("Dedicated QA provider cache unavailable");
    const configPath = join(runRoot, "agent-config.json");
    await writeJson(configPath, { runId, runRoot, buildRoot: resolve(buildRoot), schoolUrl: school.url, origins: Object.values(school.origins), clock: initial.state.clock,
      agentWorkspace: join(runRoot, "agent-workspace"), agentDir: join(profile, "studi-data/pi"), model, provider, effort, maxToolCalls, show });
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(electronPath, [join(ROOT, "agent-harness/benchmark/electron-scan.mjs"), configPath], { cwd: ROOT, env, windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    record.ready = await waitMessage(child, "ready", 45000);
    if (record.ready.model !== model || record.ready.effort !== effort) throw new Error("Effective session settings differ from requested settings");
    started = performance.now();
    for (const name of phases) {
      if (name === "changed") await school.advance("deadline-change");
      if (name === "resume") {
        if (results.at(-1)?.scanState !== "needs_user") throw new Error("Resume requires a real interrupted scan");
        await school.advance("restore-access");
      }
      const remaining = budgetMs - (performance.now() - started);
      if (remaining <= 0) throw new Error("Benchmark deadline exceeded");
      const pending = waitMessage(child, "result", remaining);
      child.send({ command: "run", phase: name });
      const { result } = await pending;
      const inspection = school.inspect();
      await writeJson(join(runRoot, `${name}-school.json`), inspection);
      results.push({ ...result, grade: gradeLive(inspection, result, school.origins) });
      // Persist completed phases immediately so later timeout cannot erase them.
      await writeJson(join(runRoot, "result.json"), record);
      if (result.status !== "completed") break;
    }
  } catch (error) {
    record.error = error.message;
    const name = phases[results.length];
    if (name) results.push({ name, status: started === null ? "infrastructure_failed" : error.message === "Benchmark deadline exceeded" ? "timed_out" : "failed", scanState: null,
      metrics: { durationMs: started === null ? null : performance.now() - started - results.reduce((sum, phase) => sum + phase.metrics.durationMs, 0), toolCalls: null, modelCalls: null, usage: null },
      grade: { passed: false, checks: [{ name: "run completes", passed: false, detail: error.message }] } });
  } finally {
    await stopChild(child);
    record.wallTimeMs = started === null ? null : performance.now() - started;
    if (school) {
      try {
        const inspection = school.inspect();
        await writeJson(join(runRoot, "final-school.json"), inspection);
        const interrupted = results.at(-1);
        if (started !== null && interrupted && !interrupted.assignments) {
          // Recover facts already committed before a deadline/crash without
          // invoking a coordinator or fabricating a completed scan.
          try {
            const { openLocalStore } = await import(pathToFileURL(join(resolve(buildRoot), "electron/storage/index.js")).href);
            const saved = await openLocalStore(join(runRoot, "store"));
            try {
              interrupted.assignments = saved.assignments.listAll();
              interrupted.courses = saved.school.listCourses();
              interrupted.scanState = saved.school.latestScan()?.state ?? null;
              interrupted.queue = saved.manager.listQueue().map(entry => ({ ...entry, state: saved.tasks.get(entry.taskId)?.state }));
              interrupted.grade = gradeLive(inspection, interrupted, school.origins);
            } finally { saved.close(); }
          } catch (error) { record.recoveryError = error.message; }
          try {
            const events = (await readFile(join(runRoot, "trace.jsonl"), "utf8")).trim().split("\n").filter(Boolean)
              .map(line => JSON.parse(line)).filter(event => event.phase === interrupted.name);
            if (events.length) {
              interrupted.metrics.toolCalls = events.filter(event => event.diagnostic?.kind === "tool_execution_start").length;
              interrupted.metrics.modelCalls = events.filter(event => event.diagnostic?.kind === "provider_request").length;
            }
            // Completed generation usage is a lower bound after an interrupted
            // request. Preserve it separately; total usage remains unknown.
            interrupted.completedGenerations = events.filter(event => event.diagnostic?.kind === "generation")
              .map(event => ({ inputTokens: event.diagnostic.payload.$ai_input_tokens ?? null, outputTokens: event.diagnostic.payload.$ai_output_tokens ?? null,
                cacheReadTokens: event.diagnostic.payload.$ai_cache_read_input_tokens ?? null, cacheWriteTokens: event.diagnostic.payload.$ai_cache_creation_input_tokens ?? null }));
          } catch (error) { record.traceRecoveryError = error.message; }
        }
      }
      finally { await school.close(); }
    }
  }
  const path = join(runRoot, "result.json"); await writeJson(path, record);
  return { path, record };
}
