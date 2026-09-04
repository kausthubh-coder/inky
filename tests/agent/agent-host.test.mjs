import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentJobHost,
  HarnessReplySchema,
  MemoryAgentJobStore,
  buildAgentTurn,
} from "../../dist/agent-system/index.js";

class TestDriver {
  id = "test";

  async run(turn) {
    return { text: `reply:${turn.target.kind}`, outcome: "completed", toolCalls: [] };
  }
}

test("capabilities follow target, explicit work, claim, and submit facts", async () => {
  const home = await buildAgentTurn({ target: { kind: "home" }, phase: "conversing", hasBrowserClaim: false }, "hello");
  assert.deepEqual(home.toolNames, ["home_status", "queue_inspect", "queue_start", "queue_cancel", "note_search"]);
  const connectedHome = await buildAgentTurn({ target: { kind: "home" }, phase: "conversing", hasBrowserClaim: false, composioTools: ["connected_apps_search", "connected_apps_execute"] }, "email my professor");
  assert.deepEqual(connectedHome.toolNames.slice(-2), ["connected_apps_search", "connected_apps_execute"]);

  const talk = await buildAgentTurn({ target: { kind: "assignment", assignmentId: "a-1" }, phase: "conversing", hasBrowserClaim: false }, "due?");
  assert.deepEqual(talk.toolNames, ["assignment_read", "note_search", "note_read"]);
  const connectedTalk = await buildAgentTurn({ target: { kind: "assignment", assignmentId: "a-1" }, phase: "conversing", hasBrowserClaim: false, composioTools: ["connected_apps_search", "connected_apps_execute"] }, "put this in Notion");
  assert.deepEqual(connectedTalk.toolNames.slice(-2), ["connected_apps_search", "connected_apps_execute"]);

  const work = await buildAgentTurn({ target: { kind: "assignment", assignmentId: "a-1" }, phase: "working", hasBrowserClaim: true }, "work");
  assert.equal(work.toolNames.includes("browser_snapshot"), true);
  assert.equal(work.toolNames.includes("browser_submit"), false);

  const submit = await buildAgentTurn({ target: { kind: "assignment", assignmentId: "a-1" }, phase: "working", hasBrowserClaim: true, submissionAuthorized: true }, "submit");
  assert.equal(submit.toolNames.includes("browser_submit"), true);
  assert.notEqual(work.system.hash, submit.system.hash);
});

test("headless job host keeps addressed threads, refuses tutor, and survives restart", async () => {
  const store = new MemoryAgentJobStore();
  const host = await AgentJobHost.create({ driver: new TestDriver(), store });
  const home = HarnessReplySchema.parse(await host.execute({ command: "send", target: { kind: "home" }, text: "hello" }));
  const talk = HarnessReplySchema.parse(await host.execute({ command: "send", target: { kind: "assignment", assignmentId: "a-1" }, text: "question" }));
  assert.equal(home.ok, true);
  assert.equal(talk.ok, true);
  assert.equal(host.snapshot().jobs.length, 2);

  const started = HarnessReplySchema.parse(await host.execute({ command: "start_assignment", assignmentId: "a-1" }));
  assert.equal(started.state.browserClaim?.target.kind, "assignment");
  assert.equal(started.toolNames.includes("browser_snapshot"), true);
  assert.equal(started.toolNames.includes("browser_submit"), false);

  const tutor = HarnessReplySchema.parse(await host.execute({ command: "send", target: { kind: "tutor" }, text: "teach" }));
  assert.equal(tutor.ok, false);
  assert.deepEqual(tutor.toolNames, []);

  const before = host.snapshot();
  await host.execute({ command: "restart" });
  assert.deepEqual(host.snapshot(), before);
  assert.equal(host.traceEvents().every((event, index) => event.sequence === index), true);
});
