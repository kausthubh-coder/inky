import assert from 'node:assert/strict';
import { test } from 'node:test';
import { affectedScopes, makePlan, buildTreeHash } from '../../scripts/verify-studi.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('build identity covers imported modules as well as entrypoints', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'studi-build-hash-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'nested'));
  await writeFile(join(root, 'main.js'), 'unchanged');
  await writeFile(join(root, 'nested/module.js'), 'before');
  const before = buildTreeHash(root);
  assert.equal(buildTreeHash(root), before);
  await writeFile(join(root, 'nested/module.js'), 'after');
  assert.notEqual(buildTreeHash(root), before);
});

test('release builds prerequisites once and includes every deterministic suite', () => {
  const plan = makePlan({ scope: ['release'] });
  assert.equal(plan.steps.filter(step => step.id === 'build').length, 1);
  assert.equal(plan.steps.filter(step => step.id === 'build-lms').length, 1);
  for (const suite of ['benchmark', 'storage', 'agent', 'auth', 'ui', 'tooling']) assert.ok(plan.files.includes(`tests/${suite}/*.test.mjs`));
  assert.ok(plan.files.includes('agent-harness/lms/tests/*.test.mjs'));
  for (const id of ['backend', 'electron', 'native-materials', 'harness-files']) assert.ok(plan.steps.some(step => step.id === id));
});

test('focused files get their prerequisites without unrelated suites', () => {
  const plan = makePlan({ files: ['tests/storage/scan-evidence.test.mjs'] });
  assert.deepEqual(plan.files, ['tests/storage/scan-evidence.test.mjs']);
  assert.deepEqual(plan.steps.map(step => step.id), ['typecheck', 'build', 'node-tests']);
  assert.deepEqual(plan.steps.find(step => step.id === 'build').args, ['run', 'build:electron']);
  assert.throws(() => makePlan({ files: ['../outside.test.mjs'] }), /repository test/);
  assert.throws(() => makePlan({ scope: ['typo'] }), /Unknown scope/);
});

test('auth file tests build the renderer for launcher regression instead of silently skipping', () => {
  const plan = makePlan({ files: ['tests/auth/qa-tooling.test.mjs'] });
  assert.deepEqual(plan.steps.find(step => step.id === 'build').args, ['run', 'build']);
  assert.deepEqual(plan.steps.at(-1).requires, ['build', 'build-lms']);
});

test('changed selection escalates unknown/shared code and unions affected boundaries', () => {
  assert.deepEqual(affectedScopes(['desktop/electron/scan/coordinator.ts', 'desktop/electron/auth/coordinator.ts']), ['scan', 'auth']);
  assert.deepEqual(affectedScopes(['desktop/electron/main.ts']), ['all']);
  assert.deepEqual(affectedScopes(['bun.lock']), ['all']);
  assert.deepEqual(affectedScopes(['.agents/skills/test-studi/references/full-app-pass.md']), []);
  assert.deepEqual(makePlan({ changedPaths: [] }).steps, []);
});

test('Learn selects its storage, agent, UI and fixture boundaries with bounded worker counts', () => {
  const plan = makePlan({ changedPaths: ['desktop/electron/agent/tutor-coordinator.ts', 'desktop/electron/storage/learn-records.ts'], concurrency: 1 });
  assert.deepEqual(plan.scopes, ['storage', 'agent', 'contracts', 'ui', 'lms']);
  assert.ok(plan.steps.find(step => step.id === 'node-tests').args.includes('--test-concurrency=1'));
  assert.ok(makePlan({ scope: ['backend'], concurrency: 2 }).steps.find(step => step.id === 'backend').args.includes('--maxWorkers=2'));
  assert.throws(() => makePlan({ concurrency: 0 }), /Concurrency/);
  assert.throws(() => makePlan({ concurrency: NaN }), /Concurrency/);
});
