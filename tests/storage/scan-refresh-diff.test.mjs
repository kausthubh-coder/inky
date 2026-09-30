import assert from "node:assert/strict";
import test from "node:test";
import { assignmentScanChange, mergeScanChange, removedScanChanges } from "../../dist/electron/scan/refresh-diff.js";

test("refresh reports one moved deadline and one new item, not evidence-only status changes", () => {
  const before = {
    assignmentId: "moved", courseId: "course", origin: "school", title: "Exam 1",
    dueAt: "2026-10-07T16:00:00Z", dueText: "Oct 7 at noon",
    schoolStatus: { state: "not_submitted", text: "Not submitted", evidence: { evidenceId: "old" } },
  };
  const after = {
    ...before, dueAt: "2026-10-08T16:00:00Z", dueText: "Oct 8 at noon",
    schoolStatus: { ...before.schoolStatus, evidence: { evidenceId: "new" } },
  };
  const changes = [
    assignmentScanChange(before, after),
    assignmentScanChange(undefined, { assignmentId: "new", title: "Quiz 2" }),
  ].filter(Boolean);
  assert.equal(changes.length, 2);
  assert.deepEqual(changes.map(change => change.kind), ["updated", "new"]);
  assert.deepEqual(changes[0].fields, ["dueAt", "dueText"]);
  assert.equal(changes[0].dueChange.before.dueAt, before.dueAt);
  assert.equal(changes[0].dueChange.after.dueAt, after.dueAt);
  assert.equal(assignmentScanChange(after, { ...after, schoolStatus: { ...after.schoolStatus, evidence: { evidenceId: "later" } } }), null);
  assert.equal(mergeScanChange(changes[1], assignmentScanChange(changes[1], { ...after, assignmentId: "new" })).kind, "new");
});

test("removed rows are scoped to completed school courses", () => {
  const before = [
    { assignmentId: "gone", courseId: "checked", origin: "school" },
    { assignmentId: "unread", courseId: "not-checked", origin: "school" },
    { assignmentId: "manual", courseId: "checked", origin: "manual" },
  ];
  assert.deepEqual(
    removedScanChanges(before, new Set(), new Set(["checked"])),
    [{ assignmentId: "gone", kind: "removed", fields: ["sourcePresence"] }],
  );
});
