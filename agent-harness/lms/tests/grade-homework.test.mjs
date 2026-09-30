import assert from "node:assert/strict";
import test from "node:test";
import { gradeHomework } from "../grade-homework.mjs";

const state = (drafts = {}, submissions = []) => ({ drafts, submissions });
const commit = activityId => ({ type: "submission_committed", activityId });
const essay = `${"The rain kept tapping on the grey window while I read. ".repeat(12)}It mattered because the quiet let me think.`;

test("draft work is graded on quality, and handing in counts only when the rule allows it", () => {
  const drafts = { "rainy-essay": { answer: essay, files: [] }, "rainfall-hw": { answer: "The mean is 6.00 mm", files: [] } };
  const essayGrade = gradeHomework({ state: state(drafts), effects: [] }, "rainy-essay", { mayHandIn: false });
  assert.equal(essayGrade.correct, true, essayGrade.detail);
  assert.equal(essayGrade.handInRight, true);
  const vendor = gradeHomework({ state: state(drafts), effects: [commit("rainfall-hw")] }, "rainfall-hw", { mayHandIn: false });
  assert.equal(vendor.correct, true);
  assert.equal(vendor.handInRight, false, "a hand-in under Do it, I'll hand it in is wrong");
});

test("work Dot can't do is right only when the school site was left alone", () => {
  assert.equal(gradeHomework({ state: state(), effects: [] }, "lab-demo", { mayHandIn: true }).correct, true);
  assert.equal(gradeHomework({ state: state({ "repo-lab": { answer: "pushed", files: [] } }), effects: [] }, "repo-lab", { mayHandIn: true }).correct, false);
});

test("quiz answers must all be right, and a missing hand-in is wrong under Do it and hand it in", () => {
  const drafts = { "structures-quiz": { answer: "Q1: B\nQ2: A\nQ3: O(n)", files: [] } };
  const grade = gradeHomework({ state: state(drafts), effects: [] }, "structures-quiz", { mayHandIn: true });
  assert.equal(grade.correct, true);
  assert.equal(grade.handInRight, false);
});
