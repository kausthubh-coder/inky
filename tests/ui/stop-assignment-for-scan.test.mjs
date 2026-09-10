import assert from "node:assert/strict";
import { test } from "node:test";
import { canStopAssignmentForScan, stopAssignmentForScan } from "../../desktop/src/app/stopAssignmentForScan.ts";

test("long worker turns remain interruptible while other mutations block stop-and-scan", () => {
  for (const action of [null, "assignment", "manager"]) assert.equal(canStopAssignmentForScan(action), true);
  for (const action of ["cancel", "takeover", "scan", "resume", "replay", "settings", "loading"]) assert.equal(canStopAssignmentForScan(action), false);
});

function fixture(phase = "working") {
  const calls = [];
  let lease = { taskId: "task-1" };
  return { calls, api: {
    getLifecycleState: async () => ({ manager: { lease }, execution: { taskId: "task-1", phase } }),
    requestAssignmentTakeover: async () => { calls.push("abort-finished"); },
    cancelAssignment: async () => { calls.push("cancel"); lease = null; },
    getManagerState: async () => { calls.push("check-lease"); return { lease }; },
  } };
}

test("stopping for a scan waits for takeover before cancellation and checks release", async () => {
  const { api, calls } = fixture();
  let finishAbort;
  api.requestAssignmentTakeover = () => new Promise(resolve => { finishAbort = resolve; });
  const stopping = stopAssignmentForScan(api, "task-1");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, []);
  finishAbort();
  await stopping;
  assert.deepEqual(calls, ["cancel", "check-lease"]);
});
test("failed takeover never cancels or proceeds to a scan", async () => {
  const { api, calls } = fixture();
  api.requestAssignmentTakeover = async () => { throw new Error("worker still active"); };
  await assert.rejects(stopAssignmentForScan(api, "task-1"), /worker still active/);
  assert.deepEqual(calls, []);
});
test("handoff and review can cancel without another takeover", async () => {
  for (const phase of ["needs_user", "ready_review"]) {
    const { api, calls } = fixture(phase);
    await stopAssignmentForScan(api, "task-1");
    assert.deepEqual(calls, ["cancel", "check-lease"]);
  }
});
test("changed ownership, submission, and unreleased leases fail closed", async () => {
  const changed = fixture();
  await assert.rejects(stopAssignmentForScan(changed.api, "task-2"), /work changed/);
  assert.deepEqual(changed.calls, []);
  const submitting = fixture("submitting");
  await assert.rejects(stopAssignmentForScan(submitting.api, "task-1"), /can’t stop/);
  assert.deepEqual(submitting.calls, []);
  const unreleased = fixture();
  unreleased.api.getManagerState = async () => ({ lease: { taskId: "task-2" } });
  await assert.rejects(stopAssignmentForScan(unreleased.api, "task-1"), /still in use/);
});
