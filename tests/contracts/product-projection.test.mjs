import assert from "node:assert/strict";
import test from "node:test";

import { hasCompletedSchoolOnboarding, nextSchoolScanAction, projectProtectedAuthState } from "../../dist/shared/index.js";

const approved = {
  status: "approved",
  user: { subject: "user_1", email: "student@example.com", name: "Student" },
  entitlement: { plan: "beta", credits: 10 },
  deviceId: "00000000-0000-4000-8000-000000000010",
  secureStorage: true,
};

test("approved auth stays checking until the existing protected runtime is ready", () => {
  assert.deepEqual(projectProtectedAuthState(approved, false), { status: "checking" });
  assert.deepEqual(projectProtectedAuthState(approved, true), approved);
  assert.deepEqual(projectProtectedAuthState({ status: "signed_out" }, false), { status: "signed_out" });
});

test("retained workflow keeps the dashboard route after a later scan failure", () => {
  const failedLatestScan = {
    state: "failed",
    coverage: [],
    completedAt: "2026-09-01T12:00:00.000Z",
  };
  assert.equal(hasCompletedSchoolOnboarding({ profile: {}, scan: failedLatestScan, workflowRevision: 2 }), true);
  assert.equal(hasCompletedSchoolOnboarding({ profile: {}, scan: failedLatestScan, workflowRevision: null }), false);
  assert.equal(hasCompletedSchoolOnboarding({
    profile: {},
    scan: { state: "partial", coverage: [{}], completedAt: "2026-09-01T12:00:00.000Z" },
    workflowRevision: null,
  }), true);
});

test("manual scan retries are fresh until a successful workflow exists", () => {
  assert.equal(nextSchoolScanAction({ workflowRevision: null }), "scan");
  assert.equal(nextSchoolScanAction({ workflowRevision: 1 }), "replay");
});
