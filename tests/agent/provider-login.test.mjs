import assert from "node:assert/strict";
import test from "node:test";

import { OpenAiCodexLoginAttemptOwner } from "../../dist/electron/agent/provider-login.js";
import { ProviderLoginHandoffSchema } from "../../dist/shared/index.js";

test("one provider login attempt projects the device code and clears on success", async () => {
  const logins = [];
  let finishLogin;
  const owner = new OpenAiCodexLoginAttemptOwner((signal, notify) => {
    logins.push({ signal, notify });
    return new Promise((resolve) => { finishLogin = resolve; });
  });

  assert.deepEqual(owner.start(), { phase: "starting" });
  assert.deepEqual(owner.start(), { phase: "starting" });
  assert.equal(logins.length, 1, "a second start must reuse the main-process attempt");

  logins[0].notify({
    type: "device_code",
    userCode: "ABCD-EFGH",
    verificationUri: "https://auth.openai.com/codex/device",
    expiresInSeconds: 60,
  });
  const handoff = ProviderLoginHandoffSchema.parse(owner.handoff);
  assert.equal(handoff.phase, "waiting");
  assert.equal(handoff.userCode, "ABCD-EFGH");
  assert.equal(handoff.verificationUri, "https://auth.openai.com/codex/device");
  assert.ok(Date.parse(handoff.expiresAt) > Date.now());
  assert.equal(ProviderLoginHandoffSchema.safeParse({ ...handoff, accessToken: "must-not-cross" }).success, false);

  finishLogin();
  await settles();
  assert.equal(owner.handoff, null);
  owner.dispose();
});

test("cancel aborts the owner and permits exactly one clean retry", async () => {
  const signals = [];
  const owner = new OpenAiCodexLoginAttemptOwner((signal) => {
    signals.push(signal);
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    });
  });

  owner.start();
  owner.cancel();
  assert.equal(signals[0].aborted, true);
  assert.equal(owner.handoff, null);

  owner.start();
  owner.start();
  assert.equal(signals.length, 2);
  owner.dispose();
  await settles();
  assert.equal(signals[1].aborted, true);
  assert.equal(owner.handoff, null);
});

test("failed and expired attempts expose only retry-safe terminal phases", async () => {
  const failed = new OpenAiCodexLoginAttemptOwner(async () => {
    throw new Error("secret upstream detail");
  });
  failed.start();
  await settles();
  assert.deepEqual(failed.handoff, { phase: "failed" });
  assert.doesNotMatch(JSON.stringify(failed.handoff), /secret|upstream/);

  const expired = new OpenAiCodexLoginAttemptOwner((signal, notify) => {
    notify({
      type: "device_code",
      userCode: "ONE-TIME",
      verificationUri: "https://auth.openai.com/codex/device",
      expiresInSeconds: 0.01,
    });
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("expired")), { once: true });
    });
  });
  expired.start();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(expired.handoff, { phase: "expired" });
  assert.equal(expired.start().phase, "waiting");
  expired.dispose();
});

function settles() {
  return new Promise((resolve) => setImmediate(resolve));
}
