import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentJobHost } from "../desktop/agent-system/index.js";
import { HomeworkFiles } from "../desktop/electron/files/homework-files.js";
import { ScriptedAgentDriver } from "./drivers/scripted.js";
import { FileAgentJobStore } from "./file-store.js";
import { currentGitSha, writeRunRecord, type HarnessRunRecord } from "./run-record.js";

export async function runFilesSuite(options: { readonly cwd: string; readonly runsRoot: string }) {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const root = await mkdtemp(join(tmpdir(), "studi-harness-files-"));
  const host = await AgentJobHost.create({ driver: new ScriptedAgentDriver(), store: new FileAgentJobStore(join(options.runsRoot, runId, "state.json")) });
  const assertions: Array<{ name: string; passed: boolean; detail: string }> = [];
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "answer.txt"), "draft\n");
    const files = await HomeworkFiles.open(root);
    assertions.push(check("temporary root lists exact metadata", (await files.list()).some((entry) => entry.path === "src/answer.txt")));
    const receipt = await files.write("src/answer.txt", "finished\n");
    assertions.push(check("write returns a relative receipt", receipt.path === "src/answer.txt"));
    assertions.push(check("written content reopens", (await files.read("src/answer.txt")).content === "finished\n" && await readFile(join(root, "src", "answer.txt"), "utf8") === "finished\n"));
    let traversalRejected = false;
    try { await files.read("../escape.txt"); } catch { traversalRejected = true; }
    assertions.push(check("traversal fails closed", traversalRejected));
    const idle = await host.execute({ command: "send", target: { kind: "assignment", assignmentId: "file-assignment" }, text: "List my files" });
    assertions.push(check("idle assignment has no file tools", !idle.toolNames?.some((name) => name.startsWith("file_"))));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  const events = host.traceEvents();
  const record: HarnessRunRecord = {
    schemaVersion: 1,
    runId,
    suite: "files",
    driver: "scripted",
    gitSha: await currentGitSha(options.cwd),
    startedAt,
    endedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    outcome: assertions.every((item) => item.passed) ? "passed" : "failed",
    state: host.snapshot(),
    events,
    assertions,
  };
  return { record, path: await writeRunRecord(options.runsRoot, record) };
}

function check(name: string, value: unknown) {
  return { name, passed: value === true, detail: value === true ? "passed" : "condition was false" };
}
