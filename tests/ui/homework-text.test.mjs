import assert from "node:assert/strict";
import test from "node:test";
import { assignmentDue, shortCourse } from "../../desktop/src/app/homeworkText.ts";

test("school date text never invents a year, midnight deadline, or overdue assignment", () => {
  for (const dueText of ["Oct 7", "OCTOBER 8", "during class"]) assert.equal(assignmentDue({ dueText }), null);
  assert.equal(assignmentDue({ dueAt: "invalid" }), null);
  assert.equal(assignmentDue({ dueAt: "2026-09-22T16:00:00Z" }), Date.parse("2026-09-22T16:00:00Z"));
});

test("class codes come from the label", () => {
  assert.equal(shortCourse("CSC 316 Data Structures"), "CSC 316");
  assert.equal(shortCourse("ST-370 Probability"), "ST 370");
  assert.equal(shortCourse("Ethics in Computing"), "Ethics in");
});
