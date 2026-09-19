import assert from 'node:assert/strict';
import test from 'node:test';
import { ProtectedRuntimeLifecycle } from '../../dist/electron/auth/runtime-lifecycle.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('concurrent activation shares initialization; signout drains partial startup', async () => {
  const gate = deferred(), entered = deferred(), calls = [];
  const lifecycle = new ProtectedRuntimeLifecycle(async (owner, current) => {
    calls.push('start:' + owner); entered.resolve(); await gate.promise;
    calls.push(current() ? 'ready' : 'cancelled');
  }, async () => { calls.push('dispose'); });
  const first = lifecycle.activate('a');
  assert.equal(lifecycle.activate('a'), first);
  await entered.promise;
  const stopped = lifecycle.deactivate();
  gate.resolve();
  await stopped;
  assert.deepEqual(calls, ['start:a', 'cancelled', 'dispose']);
  assert.equal(lifecycle.transitioning, false);
});

test('an account change disposes the old runtime before activating the next', async () => {
  const calls = [];
  const lifecycle = new ProtectedRuntimeLifecycle(async owner => { calls.push('start:' + owner); },
    async () => { calls.push('dispose'); });
  await lifecycle.activate('a');
  await lifecycle.activate('b');
  await lifecycle.deactivate();
  assert.deepEqual(calls, ['start:a', 'dispose', 'start:b', 'dispose']);
});

test('failed initialization is cleaned up and can be retried', async () => {
  let attempts = 0, disposals = 0;
  const lifecycle = new ProtectedRuntimeLifecycle(async () => {
    if (++attempts === 1) throw new Error('startup failed');
  }, async () => { disposals++; });
  await assert.rejects(lifecycle.activate('a'), /startup failed/);
  await lifecycle.activate('a');
  await lifecycle.deactivate();
  assert.equal(attempts, 2);
  assert.equal(disposals, 2);
});
