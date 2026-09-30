import assert from "node:assert/strict";
import test from "node:test";
import { assignmentDue, plainError, schoolScanFailure, shortCourse } from "../../desktop/src/app/homeworkText.ts";

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

test("school navigation failures explain recovery without Chromium codes or URLs", () => {
  const raw = "The scan could not start: ERR_TOO_MANY_REDIRECTS (-310) loading 'https://school.example/login/index.php?loginredirect=1'";
  const failure = schoolScanFailure(raw);
  assert.equal(failure.title, "The school page keeps looping");
  assert.match(failure.description, /Open the school page.*sign in if asked.*check again/);
  assert.equal(failure.pageUnavailable, true);
  assert.doesNotMatch(failure.description, /ERR_|https:|\(-310\)/);
  assert.match(plainError("Error invoking remote method 'scan': Error: ERR_INTERNET_DISCONNECTED"), /Check your internet/);
  assert.match(schoolScanFailure("ERR_CONNECTION_TIMED_OUT").description, /Try again in a moment/);
  assert.equal(schoolScanFailure("The school connection timed out.").pageUnavailable, false);
  assert.equal(plainError("ERR_ABORTED (-3)"), "");
});
