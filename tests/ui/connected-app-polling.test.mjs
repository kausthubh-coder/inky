import assert from "node:assert/strict";
import test from "node:test";
import { waitForAppConnection } from "../../desktop/src/app/waitForAppConnection.ts";

const connection = status => ({ toolkit: "gmail", sessionId: "test", connectedAccountId: status === "ACTIVE" ? "test" : null, status, redirectUrl: null });
const options = () => ({ initial: connection("INITIATED"), signal: new AbortController().signal, intervalMs: 1, timeoutMs: 100 });

test("automatically waits through pending and delayed account creation until active", async () => {
  const statuses = [null, "DISCONNECTED", "INITIATED", "ACTIVE"];
  let calls = 0;
  const result = await waitForAppConnection({ ...options(), read: async () => {
    const status = statuses[calls++];
    return status ? connection(status) : null;
  } });
  assert.equal(result.status, "ACTIVE");
  assert.equal(calls, 4);
});

test("already active accounts finish without a refresh", async () => {
  await waitForAppConnection({ ...options(), initial: connection("ACTIVE"), read: () => assert.fail("unnecessary refresh") });
});

test("terminal failures and failed requests end the attempt", async () => {
  for (const status of ["FAILED", "EXPIRED", "INACTIVE"]) {
    await assert.rejects(waitForAppConnection({ ...options(), read: async () => connection(status) }), /Connection failed/);
  }
  await assert.rejects(waitForAppConnection({ ...options(), read: async () => { throw Error("offline"); } }), /offline/);
});

test("a hung provider request times out without overlapping polls", async () => {
  let calls = 0;
  await assert.rejects(waitForAppConnection({ ...options(), timeoutMs: 20, read: () => {
    calls++;
    return new Promise(() => {});
  } }), /timed out/);
  assert.equal(calls, 1);
});

test("opening sign-in is also bounded by the connection deadline", async () => {
  await assert.rejects(waitForAppConnection({ ...options(), timeoutMs: 20, initial: new Promise(() => {}), read: () => assert.fail("sign-in never opened") }), /timed out/);
});

test("sign-out cancels a pending request and ignores its late result", async () => {
  const controller = new AbortController();
  let finish;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const result = waitForAppConnection({ ...options(), signal: controller.signal, read: () => {
    started();
    return new Promise(resolve => { finish = resolve; });
  } });
  await ready;
  controller.abort();
  await assert.rejects(result, /cancelled/);
  finish(connection("ACTIVE"));
});
