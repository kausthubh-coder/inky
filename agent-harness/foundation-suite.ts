import { randomUUID } from "node:crypto";
import { join } from "node:path";

import {
  AgentJobHost,
  HarnessReplySchema,
  type HarnessReply,
} from "../desktop/agent-system/index.js";
import { ScriptedAgentDriver } from "./drivers/scripted.js";
import { FileAgentJobStore } from "./file-store.js";
import { currentGitSha, writeRunRecord, type HarnessRunRecord } from "./run-record.js";
import { startSchoolFixture } from "./school-fixture.js";

export async function runFoundationSuite(options: {
  readonly cwd: string;
  readonly runsRoot: string;
  readonly fixturePath?: string;
}): Promise<{ readonly record: HarnessRunRecord; readonly path: string }> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const store = new FileAgentJobStore(join(options.runsRoot, runId, "state.json"));
  const host = await AgentJobHost.create({ driver: new ScriptedAgentDriver(), store });
  const school = await startSchoolFixture({
    fixturePath: options.fixturePath ?? join(options.cwd, "agent-harness", "fixtures", "school", "assignment-basic.yaml"),
  });
  const firstAssignment = school.fixture.assignments[0];
  if (!firstAssignment) throw new Error("The foundation fixture requires at least one assignment");
  const assignmentPage = await fetch(`${school.url}/assignments/${encodeURIComponent(firstAssignment.id)}`).then((response) => response.text());
  const emptyCourses = await fetch(`${school.url}/courses?state=empty`).then((response) => response.text());
  await school.close();
  const replies: HarnessReply[] = [];
  replies.push(HarnessReplySchema.parse(await host.execute({ command: "send", target: { kind: "home" }, text: "What should I do next?" })));
  replies.push(HarnessReplySchema.parse(await host.execute({ command: "send", target: { kind: "assignment", assignmentId: "assignment-1" }, text: "When is this due?" })));
  replies.push(HarnessReplySchema.parse(await host.execute({ command: "start_assignment", assignmentId: "assignment-1" })));
  const assignmentWork = replies.at(-1)!;
  replies.push(HarnessReplySchema.parse(await host.execute({ command: "abort" })));
  replies.push(HarnessReplySchema.parse(await host.execute({ command: "start_scan", scanId: "scan-1" })));
  const scanWork = replies.at(-1)!;
  replies.push(HarnessReplySchema.parse(await host.execute({ command: "abort" })));
  const tutor = HarnessReplySchema.parse(await host.execute({ command: "send", target: { kind: "tutor" }, text: "Tutor me." }));
  replies.push(tutor);
  replies.push(HarnessReplySchema.parse(await host.execute({ command: "restart" })));

  const home = replies[0]!;
  const assignmentTalk = replies[1]!;
  const assertions = [
    check("home gets queue and note search", home.toolNames?.includes("queue_inspect") && home.toolNames.includes("note_search")),
    check("assignment talk has no browser", !assignmentTalk.toolNames?.some((name) => name.startsWith("browser_"))),
    check("assignment work gets browser but not submit", assignmentWork.toolNames?.includes("browser_snapshot") && !assignmentWork.toolNames.includes("browser_submit")),
    check("scan gets recording tools", scanWork.toolNames?.includes("scan_record_assignment") && scanWork.toolNames.includes("browser_snapshot")),
    check("tutor is refused with zero tools", !tutor.ok && tutor.toolNames?.length === 0),
    check("restart restores all logical jobs", host.snapshot().jobs.length === 4),
    check("trace sequences are monotonic", host.traceEvents().every((event, index) => event.sequence === index)),
    check("loopback school renders assignment details", assignmentPage.includes(firstAssignment.title) && assignmentPage.includes("data-studi-fixture")),
    check("loopback school renders empty state", emptyCourses.includes("No courses found.")),
  ];
  const outcome = assertions.every((assertion) => assertion.passed) ? "passed" as const : "failed" as const;
  const record: HarnessRunRecord = {
    schemaVersion: 1,
    runId,
    suite: "foundation",
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

function check(name: string, value: boolean | undefined): { name: string; passed: boolean; detail: string } {
  return { name, passed: value === true, detail: value === true ? "passed" : "condition was false" };
}
