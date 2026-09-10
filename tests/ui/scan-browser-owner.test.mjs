import assert from "node:assert/strict";
import { test } from "node:test";
import { scanBrowserOwner } from "../../desktop/src/app/scanBrowserOwner.ts";

test("paused/review work restored after restart remains named and actionable", () => {
  for (const phase of ["needs_user", "ready_review"]) {
    const lifecycle = { manager: { entries: [], lease: { taskId: "task-1", state: "active" } }, execution: { taskId: "task-1", assignmentId: "a1", phase } };
    const owner = scanBrowserOwner({ assignments: [{ assignmentId: "a1", title: "Sorting homework" }] }, lifecycle);
    assert.deepEqual(owner, { taskId: "task-1", title: "Sorting homework", phase, canStop: true });
  }
});
test("acquiring work has an owner but cannot be stopped via active-worker controls", () => {
  const owner = scanBrowserOwner({ assignments: [{ assignmentId: "a1", title: "Sorting homework" }] }, { execution: null, manager: { lease: { taskId: "task-1", state: "acquiring" }, entries: [{ taskId: "task-1", assignmentId: "a1" }] } });
  assert.equal(owner.title, "Sorting homework");
  assert.equal(owner.phase, "starting");
  assert.equal(owner.canStop, false);
});
test("completed historical execution without a lease never blocks scan", () => {
  assert.equal(scanBrowserOwner({ assignments: [] }, { execution: { phase: "failed" }, manager: { lease: null, entries: [] } }), null);
});
