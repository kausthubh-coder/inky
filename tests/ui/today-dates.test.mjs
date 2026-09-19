import assert from "node:assert/strict";
import test from "node:test";
import { assignmentDue, todayGroups } from "../../desktop/src/app/todayGroups.ts";

test("school date text never invents a year, midnight deadline, or overdue assignment", () => {
  const assignments = ["Oct 7", "OCTOBER 8", "Nov 2", "October 7, 2026", "during class"]
    .map((dueText, index) => ({ assignmentId: `date-${index}`, title: dueText, dueText, deadlinePrecision: "date" }));
  for (const assignment of assignments) assert.equal(assignmentDue(assignment), null);
  const groups = todayGroups(assignments, [], { manager: { entries: [] } }, new Date("2026-09-19T16:00:00Z"));
  assert.equal(groups.next.length, 0);
  assert.deepEqual(groups.undated.map(item => item.assignment.dueText), assignments.map(a => a.dueText));
});

test("verified deadlines still sort future work separately from due and overdue work", () => {
  const now = new Date("2026-09-19T16:00:00Z");
  const assignments = [
    { assignmentId: "past", title: "Past", dueAt: "2026-09-18T16:00:00Z" },
    { assignmentId: "soon", title: "Soon", dueAt: "2026-09-22T16:00:00Z" },
    { assignmentId: "future", title: "Future", dueAt: "2026-10-07T16:00:00Z", dueText: "Oct 7" },
  ];
  const groups = todayGroups(assignments, [], { manager: { entries: [] } }, now);
  assert.deepEqual(groups.next.map(item => item.assignment.assignmentId), ["past", "soon"]);
  assert.deepEqual(groups.later.map(item => item.assignment.assignmentId), ["future"]);
  assert.equal(groups.next.filter(item => item.due < now.getTime()).length, 1);
  assert.equal(assignmentDue({ dueAt: "invalid", dueText: "Oct 7" }), null);
});
