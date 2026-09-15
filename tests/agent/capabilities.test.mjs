import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentTurn } from "../../dist/agent-system/index.js";

test("capabilities follow target, explicit work, claim, and submit facts", async () => {
  const home = await buildAgentTurn({ target: { kind: "home" }, phase: "conversing", hasBrowserClaim: false }, "hello");
  assert.deepEqual(home.toolNames, ["home_status", "queue_inspect", "queue_start", "queue_cancel", "note_search"]);
  const connectedHome = await buildAgentTurn({ target: { kind: "home" }, phase: "conversing", hasBrowserClaim: false, composioTools: ["connected_apps_search", "connected_apps_execute"] }, "email my professor");
  assert.deepEqual(connectedHome.toolNames.slice(-2), ["connected_apps_search", "connected_apps_execute"]);

  const talk = await buildAgentTurn({ target: { kind: "assignment", assignmentId: "a-1" }, phase: "conversing", hasBrowserClaim: false }, "due?");
  assert.deepEqual(talk.toolNames, ["assignment_read", "assignment_start", "note_search", "note_read"]);
  const connectedTalk = await buildAgentTurn({ target: { kind: "assignment", assignmentId: "a-1" }, phase: "conversing", hasBrowserClaim: false, composioTools: ["connected_apps_search", "connected_apps_execute"] }, "put this in Notion");
  assert.deepEqual(connectedTalk.toolNames.slice(-2), ["connected_apps_search", "connected_apps_execute"]);

  const work = await buildAgentTurn({ target: { kind: "assignment", assignmentId: "a-1" }, phase: "working", hasBrowserClaim: true }, "work");
  assert.equal(work.toolNames.includes("browser_snapshot"), true);
  assert.equal(work.toolNames.includes("browser_submit"), false);

  const submit = await buildAgentTurn({ target: { kind: "assignment", assignmentId: "a-1" }, phase: "working", hasBrowserClaim: true, submissionAuthorized: true }, "submit");
  assert.equal(submit.toolNames.includes("browser_submit"), true);
  assert.notEqual(work.system.hash, submit.system.hash);
});
