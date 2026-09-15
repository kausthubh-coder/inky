import assert from "node:assert/strict";
import test from "node:test";

import { ProviderLoginAttemptOwner } from "../../dist/electron/agent/provider-login.js";
import { ProviderLoginHandoffSchema } from "../../dist/shared/index.js";

test("a ChatGPT login projects the device code and clears on success", async () => {
  const logins = [];
  let finishLogin;
  const owner = new ProviderLoginAttemptOwner((providerId, signal, interaction) => {
    logins.push({ providerId, signal, interaction });
    return new Promise((resolve) => {
      finishLogin = resolve;
    });
  });

  assert.deepEqual(owner.start("openai-codex"), { phase: "starting", providerId: "openai-codex" });
  assert.deepEqual(owner.start("openai-codex"), { phase: "starting", providerId: "openai-codex" });
  assert.equal(logins.length, 1, "a second start must reuse the main-process attempt");

  logins[0].interaction.notify({
    type: "device_code",
    userCode: "ABCD-EFGH",
    verificationUri: "https://auth.openai.com/codex/device",
    expiresInSeconds: 60,
  });
  const handoff = ProviderLoginHandoffSchema.parse(owner.handoff);
  assert.equal(handoff.phase, "waiting");
  assert.equal(handoff.providerId, "openai-codex");
  assert.equal(handoff.userCode, "ABCD-EFGH");
  assert.equal(handoff.verificationUri, "https://auth.openai.com/codex/device");
  assert.ok(Date.parse(handoff.expiresAt) > Date.now());
  assert.equal(
    ProviderLoginHandoffSchema.safeParse({ ...handoff, accessToken: "must-not-cross" }).success,
    false,
  );

  finishLogin();
  await settles();
  assert.equal(owner.handoff, null);
  owner.dispose();
});

test("a Claude login projects the browser page and hands a pasted code back to Pi", async () => {
  const prompts = [];
  let finishLogin;
  const owner = new ProviderLoginAttemptOwner(async (providerId, _signal, interaction) => {
    assert.equal(providerId, "anthropic");
    interaction.notify({
      type: "auth_url",
      url: "https://claude.ai/oauth/authorize?code=true",
      instructions: "Complete login",
    });
    const code = await interaction.awaitManualCode();
    prompts.push(code);
    await new Promise((resolve) => {
      finishLogin = resolve;
    });
  });

  owner.start("anthropic");
  await settles();
  const handoff = ProviderLoginHandoffSchema.parse(owner.handoff);
  assert.equal(handoff.phase, "browser");
  assert.equal(handoff.providerId, "anthropic");
  assert.equal(handoff.authorizationUrl, "https://claude.ai/oauth/authorize?code=true");

  owner.complete("openai-codex", "wrong-subscription");
  assert.deepEqual(prompts, [], "a code for another subscription must be ignored");
  owner.complete("anthropic", "abc#state");
  await settles();
  assert.deepEqual(prompts, ["abc#state"]);
  assert.equal(owner.handoff?.phase, "browser", "the page stays visible while Pi exchanges the code");

  finishLogin();
  await settles();
  assert.equal(owner.handoff, null);
  owner.dispose();
});

test("starting another subscription replaces the active attempt", async () => {
  const signals = [];
  const owner = new ProviderLoginAttemptOwner((providerId, signal) => {
    signals.push({ providerId, signal });
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    });
  });
  owner.start("openai-codex");
  owner.start("anthropic");
  await settles();
  assert.equal(signals[0].signal.aborted, true);
  assert.equal(signals[1].signal.aborted, false);
  assert.deepEqual(owner.handoff, { phase: "starting", providerId: "anthropic" });
  owner.dispose();
});

test("cancel aborts the owner and permits exactly one clean retry", async () => {
  const signals = [];
  const owner = new ProviderLoginAttemptOwner((_providerId, signal) => {
    signals.push(signal);
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    });
  });

  owner.start("openai-codex");
  owner.cancel();
  assert.equal(signals[0].aborted, true);
  assert.equal(owner.handoff, null);

  owner.start("openai-codex");
  owner.start("openai-codex");
  assert.equal(signals.length, 2);
  owner.dispose();
  await settles();
  assert.equal(signals[1].aborted, true);
  assert.equal(owner.handoff, null);
});

test("failed and expired attempts expose only retry-safe terminal phases", async () => {
  const failed = new ProviderLoginAttemptOwner(async () => {
    throw new Error("secret upstream detail");
  });
  failed.start("anthropic");
  await settles();
  assert.deepEqual(failed.handoff, { phase: "failed", providerId: "anthropic" });
  assert.doesNotMatch(JSON.stringify(failed.handoff), /secret|upstream/);

  const expired = new ProviderLoginAttemptOwner((_providerId, signal, interaction) => {
    interaction.notify({
      type: "device_code",
      userCode: "ONE-TIME",
      verificationUri: "https://auth.openai.com/codex/device",
      expiresInSeconds: 0.01,
    });
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("expired")), { once: true });
    });
  });
  expired.start("openai-codex");
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(expired.handoff, { phase: "expired", providerId: "openai-codex" });
  assert.equal(expired.start("openai-codex").phase, "waiting");
  expired.dispose();
});

function settles() {
  return new Promise((resolve) => setImmediate(resolve));
}
