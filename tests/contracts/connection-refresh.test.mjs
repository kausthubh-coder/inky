import assert from "node:assert/strict";
import test from "node:test";
import { watchConnection } from "../../dist/shared/connection-refresh.js";

const connection = (status) => ({ toolkit: "gmail", sessionId: "test", connectedAccountId: "account-test", status, redirectUrl: null });

test("OAuth completion reconciles pending and propagating accounts without another click", async () => {
  const statuses = ["DISCONNECTED", "INITIATED", "INITIALIZING", "ACTIVE"];
  const observed = [];
  let calls = 0;
  let done;
  const completed = new Promise((resolve) => { done = resolve; });
  const watcher = watchConnection({
    intervalMs: 1,
    refresh: async () => connection(statuses[calls++]),
    onConnection: (value) => { observed.push(value.status); if (value.status === "ACTIVE") done(); },
    onError: (error) => { throw error; },
  });
  try {
    await completed;
    await watcher.refresh();
    assert.deepEqual(observed, ["INITIATED", "INITIALIZING", "ACTIVE"]);
    assert.equal(calls, 4);
  } finally { watcher.dispose(); }
});

test("focus cannot overlap refreshes and disposal ignores late responses", async () => {
  let resolve;
  let calls = 0;
  const observed = [];
  const watcher = watchConnection({
    refresh: () => { calls++; return new Promise((done) => { resolve = done; }); },
    onConnection: (value) => observed.push(value), onError: () => {},
  });
  await watcher.refresh();
  assert.equal(calls, 1);
  watcher.dispose();
  resolve(connection("ACTIVE"));
  await Promise.resolve();
  assert.deepEqual(observed, []);
});

test("provider failure remains visible and stops background polling", async () => {
  const observed = [];
  let calls = 0;
  const watcher = watchConnection({
    refresh: async () => { calls++; return connection("FAILED"); },
    onConnection: (value) => observed.push(value.status), onError: () => {},
  });
  await Promise.resolve();
  await watcher.refresh();
  assert.deepEqual(observed, ["FAILED"]);
  assert.equal(calls, 1);
  watcher.dispose();
});
