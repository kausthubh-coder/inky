import assert from "node:assert/strict";
import test from "node:test";
import { homeworkRecord } from "../../desktop/shared/homework-state.ts";

const assignment = { schoolStatus: { state: "not_submitted" } };
const state = (input) => homeworkRecord({ assignment, mayAttempt: true, ...input }).state;

test("the run's phase decides the state, and a cancelled run is stopped, not stuck", () => {
  assert.equal(state({ execution: { phase: "working" } }), "working");
  assert.equal(state({ execution: { phase: "ready_review" } }), "ready");
  assert.equal(state({ execution: { phase: "submitted" } }), "handed_in");
  assert.equal(state({ execution: { phase: "failed", lastError: "Cancelled by the student." } }), "stopped");
  assert.deepEqual(homeworkRecord({ assignment, mayAttempt: true, execution: { phase: "failed", lastError: "WebAssign timed out" } }), { state: "stuck", reason: "WebAssign timed out" });
  assert.deepEqual(homeworkRecord({ assignment, mayAttempt: true, execution: { phase: "needs_user", needs: "sign_in" } }), { state: "waiting", needs: "sign_in" });
});

test("without a run: the school's own status, then the queue, then the rule", () => {
  assert.equal(homeworkRecord({ assignment: { schoolStatus: { state: "graded" } }, mayAttempt: true }).state, "handed_in_at_school");
  assert.equal(state({ task: { state: "queued" } }), "scheduled");
  assert.equal(state({ task: { state: "queued" }, execution: { phase: "preserved" } }), "scheduled", "saved work waiting to go again shows as waiting");
  assert.equal(state({ task: { state: "discovered" } }), "not_started");
  assert.equal(homeworkRecord({ assignment, task: { state: "discovered" }, mayAttempt: false }).state, "left_to_you");
});

test("the student's own choices come first", () => {
  assert.equal(homeworkRecord({ assignment: { ...assignment, owner: "student" }, execution: { phase: "working" }, mayAttempt: false }).state, "yours");
  assert.equal(homeworkRecord({ assignment: { ...assignment, ignoredReason: "already_done" }, mayAttempt: true }).state, "ignored");
});
