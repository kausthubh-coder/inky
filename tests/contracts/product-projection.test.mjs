import assert from "node:assert/strict";
import test from "node:test";

import { classifyAgentRuntimeAttention, hasCompletedSchoolOnboarding, nextSchoolScanAction, presentSchoolOnboardingScan, projectProtectedAuthState } from "../../dist/shared/index.js";

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

test("runtime attention distinguishes usage, Codex reauth, and ordinary scan failure", () => {
  assert.equal(classifyAgentRuntimeAttention({ state: "ready", reason: "OpenAI Codex is ready to use." }), "none");
  assert.equal(classifyAgentRuntimeAttention({ state: "needs_login", reason: "OpenAI Codex needs authentication." }), "needs_login");
  assert.equal(classifyAgentRuntimeAttention({ state: "ready", reason: "OpenAI Codex is ready to use." }, "The scan agent stopped: rate limit"), "usage");
  assert.equal(classifyAgentRuntimeAttention({ state: "unavailable", reason: "Studi could not check OpenAI Codex authentication." }), "unavailable");
  assert.deepEqual(presentSchoolOnboardingScan({
    profile: {},
    scan: { state: "failed", coverage: [], completedAt: "2026-09-02T19:23:04.569Z", failures: ["The scan agent stopped: quota exceeded"] },
    workflowRevision: null,
  }, { state: "ready", reason: "OpenAI Codex is ready to use." }), { step: 7, kind: "runtime_usage" });
  assert.deepEqual(presentSchoolOnboardingScan({
    profile: {},
    scan: { state: "partial", coverage: [{}], completedAt: "2026-09-02T19:23:04.569Z", handoff: null },
    workflowRevision: null,
  }, { state: "needs_login", reason: "OpenAI Codex needs authentication." }), { step: 1, kind: "runtime_login" });
});

test("onboarding chat only asks for another login when a scan is actually waiting", () => {
  const profile = {};
  assert.deepEqual(presentSchoolOnboardingScan({ profile, scan: { state: "running" }, workflowRevision: null }), {
    step: 6,
    kind: "scanning",
  });
  assert.deepEqual(presentSchoolOnboardingScan({ profile, scan: { state: "needs_user" }, workflowRevision: null }), {
    step: 7,
    kind: "handoff",
  });
  assert.deepEqual(presentSchoolOnboardingScan({
    profile,
    scan: {
      state: "partial",
      coverage: [{}],
      completedAt: "2026-09-02T19:23:04.569Z",
      handoff: null,
    },
    workflowRevision: null,
  }), { step: 8, kind: "ready" });
  assert.deepEqual(presentSchoolOnboardingScan({
    profile,
    scan: { state: "failed", coverage: [], completedAt: "2026-09-02T19:23:04.569Z", handoff: null },
    workflowRevision: null,
  }), { step: 7, kind: "retry" });
});
