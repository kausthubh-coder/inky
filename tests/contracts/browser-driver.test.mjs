import assert from "node:assert/strict";
import test from "node:test";

import { browserDriver } from "../../dist/shared/index.js";

test("a hidden browser has no driver", () => {
  assert.equal(browserDriver({ layout: "hidden", scanState: "running", executionPhase: "working" }), "none");
});

test("working or submitting execution drives the visible desk browser", () => {
  assert.equal(browserDriver({ layout: "desk", executionPhase: "working" }), "inky");
  assert.equal(browserDriver({ layout: "desk", executionPhase: "submitting" }), "inky");
});

test("a running scan drives the onboarding browser", () => {
  assert.equal(browserDriver({ layout: "onboarding", scanState: "running" }), "inky");
});

test("needs_user and idle visible browsers belong to the student", () => {
  assert.equal(browserDriver({ layout: "onboarding", scanState: "needs_user" }), "student");
  assert.equal(browserDriver({ layout: "desk", executionPhase: "needs_user" }), "student");
  assert.equal(browserDriver({ layout: "onboarding" }), "student");
  assert.equal(browserDriver({ layout: "desk", executionPhase: "ready_review" }), "student");
});
