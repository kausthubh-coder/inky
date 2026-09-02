import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SignJWT, exportJWK, generateKeyPair } from "jose";

import { AuthCoordinator } from "../../dist/electron/auth/coordinator.js";
import { openLoopbackCallback } from "../../dist/electron/auth/loopback.js";
import { createOAuthTransaction } from "../../dist/electron/auth/pkce.js";
import { AuthVault, createOfflineCache, validOfflineCache } from "../../dist/electron/auth/vault.js";

const issuer = "https://novel-eel-63.clerk.accounts.dev";
const clientId = "oNhxE8nbGeztDJzo";
const testRoots = [];

test.after(async () => {
  await Promise.all(testRoots.map((root) => rm(root, { recursive: true, force: true })));
});

test("PKCE transactions use independent 256-bit values and the exact S256 challenge", () => {
  const transactions = Array.from({ length: 12 }, () => createOAuthTransaction());
  assert.equal(new Set(transactions.map(({ verifier }) => verifier)).size, transactions.length);
  assert.equal(new Set(transactions.map(({ state }) => state)).size, transactions.length);
  assert.equal(new Set(transactions.map(({ nonce }) => nonce)).size, transactions.length);
  for (const transaction of transactions) {
    assert.equal(transaction.verifier.length, 43);
    assert.equal(transaction.challenge, createHash("sha256").update(transaction.verifier).digest("base64url"));
    assert.equal(transaction.state.length, 43);
    assert.equal(transaction.nonce.length, 43);
  }
});

test("loopback callback binds an ephemeral 127.0.0.1 port and consumes one valid response", async () => {
  const callback = await openLoopbackCallback("expected-state", 3_000);
  assert.match(callback.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  const first = await fetch(`${callback.redirectUri}?code=first-code&state=expected-state`);
  assert.equal(first.status, 200);
  assert.equal(await callback.code, "first-code");
  const duplicate = await fetch(`${callback.redirectUri}?code=second-code&state=expected-state`).catch(() => null);
  assert.ok(duplicate === null || duplicate.status === 410);
  await callback.close();
});

test("loopback callback rejects a wrong state without yielding an authorization code", async () => {
  const callback = await openLoopbackCallback("expected-state", 3_000);
  const response = await fetch(`${callback.redirectUri}?code=stolen-code&state=wrong-state`);
  assert.equal(response.status, 400);
  await assert.rejects(callback.code, /callback validation failed/);
  await callback.close();
});

test("offline approval is bound to one device and never exceeds 24 hours", () => {
  const checkedAt = Date.now();
  const cache = createOfflineCache(
    { subject: "user_1", email: "student@example.com", name: "Student" },
    { plan: "beta", credits: 25 },
    "00000000-0000-4000-8000-000000000010",
    checkedAt,
  );
  assert.deepEqual(validOfflineCache(cache, cache.deviceId, checkedAt + 1_000), cache);
  assert.equal(validOfflineCache(cache, "00000000-0000-4000-8000-000000000011", checkedAt + 1_000), null);
  assert.equal(validOfflineCache({ ...cache, expiresAt: new Date(checkedAt + 24 * 60 * 60_000 + 1).toISOString() }, cache.deviceId, checkedAt + 1_000), null);
  assert.equal(validOfflineCache(cache, cache.deviceId, Date.parse(cache.expiresAt)), null);
});

test("secure-storage fallback is memory-only and a revoked refresh token is erased", async () => {
  const vault = memoryVault();
  await vault.save({ schemaVersion: 1, refreshToken: "revoked-refresh-token" });
  const coordinator = new AuthCoordinator({
    vault,
    openExternal: async () => undefined,
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration")) return jsonResponse(metadata());
      if (url.endsWith("/oauth/token")) return jsonResponse({ error: "invalid_grant" }, 400);
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const state = await coordinator.start();
  assert.equal(state.status, "signed_out");
  assert.match(state.message, /expired/i);
  assert.equal(await vault.load(), null);
  assert.equal(vault.secureStorageAvailable, false);
});

test("OIDC nonce mismatch is rejected before any Convex account call", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "studi-test-key";
  jwk.use = "sig";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/.well-known/jwks.json")) return jsonResponse({ keys: [jwk] });
    throw new Error(`Unexpected global request: ${String(input)}`);
  };
  let tokenExchanges = 0;
  try {
    const vault = memoryVault();
    const coordinator = new AuthCoordinator({
      vault,
      openExternal: async (authorization) => {
        const url = new URL(authorization);
        const callback = new URL(url.searchParams.get("redirect_uri"));
        callback.searchParams.set("code", "one-shot-code");
        callback.searchParams.set("state", url.searchParams.get("state"));
        setImmediate(() => requestLocal(callback.toString()));
      },
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith("/.well-known/openid-configuration")) return jsonResponse(metadata());
        if (url.endsWith("/oauth/token")) {
          tokenExchanges += 1;
          const idToken = await new SignJWT({ nonce: "wrong-nonce", email: "student@example.com", name: "Student" })
            .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
            .setIssuer(issuer)
            .setAudience(clientId)
            .setSubject("user_nonce_test")
            .setIssuedAt()
            .setExpirationTime("5m")
            .sign(privateKey);
          return jsonResponse({ access_token: "access", refresh_token: "refresh", id_token: idToken, expires_in: 300 });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });
    assert.equal((await coordinator.start()).status, "signed_out");
    const state = await coordinator.signIn();
    assert.equal(state.status, "signed_out");
    assert.match(state.message, /unverifiable/i);
    assert.equal(tokenExchanges, 1);
    assert.equal(await vault.load(), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function memoryVault() {
  const root = join(tmpdir(), `studi-auth-test-${process.pid}-${Date.now()}-${testRoots.length}`);
  testRoots.push(root);
  return new AuthVault(root, {
    isEncryptionAvailable: () => false,
    encryptString: () => { throw new Error("memory fallback must not encrypt"); },
    decryptString: () => { throw new Error("memory fallback must not decrypt"); },
  });
}

function metadata() {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    revocation_endpoint: `${issuer}/oauth/token/revoke`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    scopes_supported: ["openid", "profile", "email", "offline_access"],
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function requestLocal(url) {
  const request = get(url, (response) => response.resume());
  request.on("error", () => undefined);
}
