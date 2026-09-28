import assert from "node:assert/strict";
import test from "node:test";

import { readSubmissionConfirmation } from "../../dist/shared/index.js";

test("the school's own confirmation words count; drafts, negatives and old words don't", () => {
  assert.equal(readSubmissionConfirmation("No submission", "Submission status: Submitted for grading"), "Submitted for grading");
  assert.equal(readSubmissionConfirmation("", "Your attempt has been submitted."), "has been submitted");
  assert.equal(readSubmissionConfirmation("", "Draft (not submitted)"), null);
  assert.equal(readSubmissionConfirmation("", "This work was not turned in"), null);
  assert.equal(readSubmissionConfirmation("Attempt 1: Submitted for grading", "Attempt 1: Submitted for grading"), null);
});
