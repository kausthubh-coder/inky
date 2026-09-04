import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { AgentJobHost, HarnessReplySchema } from "../desktop/agent-system/index.js";
import { ScriptedAgentDriver } from "./drivers/scripted.js";
import { FileAgentJobStore } from "./file-store.js";
import { currentGitSha, writeRunRecord, type HarnessRunRecord } from "./run-record.js";

export async function runRoutingSuite(options: {
  readonly cwd: string;
  readonly runsRoot: string;
}): Promise<{ readonly record: HarnessRunRecord; readonly path: string }> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const store = new FileAgentJobStore(join(options.runsRoot, runId, "state.json"));
  const host = await AgentJobHost.create({ driver: new ScriptedAgentDriver(), store });
  const target = { kind: "assignment" as const, assignmentId: "assignment-routing" };
  const first = HarnessReplySchema.parse(await host.execute({ command: "send", target, text: "What is this?" }));
  const second = HarnessReplySchema.parse(await host.execute({ command: "send", target, text: "What is the next step?" }));
  const home = HarnessReplySchema.parse(await host.execute({ command: "send", target: { kind: "home" }, text: "What is next?" }));
  const beforeRestart = host.snapshot();
  await host.execute({ command: "restart" });
  const third = HarnessReplySchema.parse(await host.execute({ command: "send", target, text: "Check it once more." }));
  const assignmentJob = third.state.jobs.find((job) => job.target.kind === "assignment");
  const homeJob = home.state.jobs.find((job) => job.target.kind === "home");
  const firstAssignmentJob = first.state.jobs.find((job) => job.target.kind === "assignment");
  const secondAssignmentJob = second.state.jobs.find((job) => job.target.kind === "assignment");
  const assertions = [
    check("two sends resolve one assignment job", firstAssignmentJob?.jobId === secondAssignmentJob?.jobId),
    check("home resolves a separate job", homeJob?.jobId !== firstAssignmentJob?.jobId),
    check("assignment talk never claims the browser", beforeRestart.browserClaim === null),
    check("restart retains the assignment identity", assignmentJob?.jobId === firstAssignmentJob?.jobId),
    check("three turns retain six transcript messages", assignmentJob?.turnIndex === 3 && assignmentJob.messages.length === 6),
    check("assignment talk exposes no browser action", !third.toolNames?.some((name) => name.startsWith("browser_"))),
    check("trace remains monotonic", host.traceEvents().every((event, index) => event.sequence === index)),
  ];
  const outcome = assertions.every((assertion) => assertion.passed) ? "passed" as const : "failed" as const;
  const record: HarnessRunRecord = {
    schemaVersion: 1,
    runId,
    suite: "routing",
    driver: "scripted",
    gitSha: await currentGitSha(options.cwd),
    startedAt,
    endedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    outcome,
    state: host.snapshot(),
    events: host.traceEvents(),
    assertions,
  };
  const path = await writeRunRecord(options.runsRoot, record);
  return { record, path };
}

function check(name: string, value: boolean | undefined) {
  return { name, passed: value === true, detail: value === true ? "passed" : "condition was false" };
}
