// Planner/adapter tests only. Fake Docker transcripts are not functional C proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dockerPlan, dockerLimits, runtimeCreateArgs, assertRuntimeIsolation,
  validateDockerResults, gradeCodingWithDocker, rainfallOracle } from '../grade-code-docker.mjs';

const image = 'gcc@sha256:' + 'a'.repeat(64), baseId = 'sha256:' + 'b'.repeat(64), sourceId = 'sha256:' + 'c'.repeat(64);
const artifactHash = 'd'.repeat(64);
const success = stdout => ({ exitCode: 0, stdout, stderr: '', timedOut: false, outputExceeded: false, durationMs: 5, error: null });
function isolated() {
  return { Image: sourceId, Config: { User: '65534:65534' }, Mounts: [],
    HostConfig: { ReadonlyRootfs: true, NetworkMode: 'none', Privileged: false,
      Memory: dockerLimits.memoryBytes, MemorySwap: dockerLimits.memoryBytes, PidsLimit: 32, NanoCpus: 1000000000,
      CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'], Binds: [], Devices: [],
      Tmpfs: { '/work': 'rw,exec,nosuid,nodev,size=33554432,mode=1777' } },
    State: { ExitCode: 0, OOMKilled: false } };
}

test('planner pins compiler and isolates each trusted oracle case from candidate main', () => {
  const plan = dockerPlan(image);
  assert.equal(plan.cases.length, 8);
  for (const ref of ['gcc:latest', 'gcc:14', 'other@sha256:' + 'a'.repeat(64), image + ';echo unsafe']) assert.throws(() => dockerPlan(ref), /pinned/);
  assert.equal(plan.testsHash, dockerPlan(image).testsHash);
  assert.doesNotMatch(rainfallOracle, /#include "stats.h"/);
  for (const item of plan.cases.slice(1)) {
    assert.ok(item.command.includes('/submission/oracle.c'));
    assert.ok(item.command.includes('/submission/stats.c'));
    assert.ok(!item.command.includes('/submission/main.c'));
    const args = runtimeCreateArgs('studi-rainfall-1234-abcd', sourceId, item);
    for (const flag of ['--read-only', '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--memory=128m', '--memory-swap=128m', '--pids-limit=32', '--pull=never']) assert.ok(args.includes(flag));
    assert.ok(!args.some(arg => /^(?:--mount|--volume|--privileged|--device|--publish|--env-file)(?:=|$)/.test(arg)));
  }
  assertRuntimeIsolation(isolated(), sourceId);
  for (const change of [{ ReadonlyRootfs: false }, { NetworkMode: 'host' }, { Memory: 0 }, { PidsLimit: -1 }, { Binds: ['/secret:/host'] }, { CapDrop: [] }]) {
    const bad = isolated(); Object.assign(bad.HostConfig, change);
    assert.throws(() => assertRuntimeIsolation(bad, sourceId), /isolation/);
  }
});

test('result validation rejects fake PASS output, missing cases, identity mismatch, timeouts and OOM', () => {
  const plan = dockerPlan(image), identity = { testsHash: plan.testsHash, artifactHash, compilerImage: image, compilerImageId: baseId, submissionImageId: sourceId };
  const results = () => plan.cases.map(item => ({ ...success(item.name === 'entry' ? item.expected : item.expected + '\n'),
    name: item.name, isolated: true, containerExitCode: 0, oomKilled: false }));
  assert.equal(validateDockerResults(plan, results(), identity, artifactHash), true);
  for (const change of [{ stdout: 'PASS\n' }, { stdout: 'nan\n' }, { stdout: '5\nextra\n' }, { stdout: '999\n' },
    { timedOut: true }, { outputExceeded: true }, { oomKilled: true }, { exitCode: 1 }, { containerExitCode: 1 },
    { isolated: false }, { durationMs: 10001 }]) {
    const bad = results(); Object.assign(bad[2], change);
    assert.equal(validateDockerResults(plan, bad, identity, artifactHash), false);
  }
  assert.equal(validateDockerResults(plan, results().slice(1), identity, artifactHash), false);
  assert.equal(validateDockerResults(plan, results(), { ...identity, testsHash: 'e'.repeat(64) }, artifactHash), false);
  assert.equal(validateDockerResults(plan, results(), { ...identity, artifactHash: 'e'.repeat(64) }, artifactHash), false);
  assert.equal(validateDockerResults(plan, results(), { ...identity, compilerImage: 'gcc:latest' }, artifactHash), false);
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'studi-rainfall-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'uploads'));
  const files = [];
  for (const [name, text] of Object.entries({ 'main.c': 'Synthetic planner input; deliberately not C.', 'stats.c': 'Never executed by these tests.',
    'stats.h': 'Not compiled on host.', 'README.md': 'cc -std=c11 -Wall -Wextra -Werror main.c stats.c -o rainfall\n./rainfall\nnormal negative empty\n' })) {
    const bytes = Buffer.from(text), hash = createHash('sha256').update(bytes).digest('hex');
    files.push({ name, hash, bytes: bytes.length });
    await writeFile(join(directory, 'uploads', hash), bytes);
  }
  return { directory, inspection: { state: { scenarioId: 'coding-multifile', submissions: [{ id: 'receipt', activityId: 'rainfall-project', idempotencyKey: 'key', files }] }, effects: [
    { type: 'draft_saved', activityId: 'rainfall-project', sequence: 1 },
    { type: 'submission_committed', activityId: 'rainfall-project', sequence: 2, detail: { key: 'key' } },
  ] } };
}

function fakeDocker({ timeout = false, badIsolation = false, cleanupFailure = false } = {}) {
  const calls = []; let started = 0;
  const command = args => {
    calls.push(args);
    if (args[0] === 'info') return success('"linux"');
    if (args[0] === 'image' && args[1] === 'inspect') return success(JSON.stringify([{ Id: baseId, Os: 'linux', Architecture: 'amd64', RepoDigests: [image], Config: {} }]));
    if (args[0] === 'commit') return success(sourceId);
    if (args[0] === 'inspect') {
      const state = isolated(); if (badIsolation) state.HostConfig.NetworkMode = 'host';
      return success(JSON.stringify([state]));
    }
    if (args[0] === 'start') {
      const item = dockerPlan(image).cases[started++];
      return timeout ? { ...success(''), timedOut: true, exitCode: null, error: 'ETIMEDOUT' }
        : success(item.name === 'entry' ? item.expected : item.expected + '\n');
    }
    if (args[0] === 'rm' && cleanupFailure) return { ...success(''), exitCode: 1 };
    return success('created');
  };
  return { command, calls };
}

test('adapter copies only bounded input into never-started staging and cleans fresh test containers', async t => {
  const { inspection, directory } = await fixture(t), fake = fakeDocker();
  const grade = await gradeCodingWithDocker(inspection, directory, { image, synthetic: true, command: fake.command });
  assert.equal(grade.outcome, 'passed', 'synthetic transcript validates adapter only, not C correctness');
  assert.equal(grade.functional.observations.length, 8);
  assert.equal(grade.functional.artifactHash, grade.artifactHash);
  assert.equal(grade.functional.compilerImageId, baseId);
  const stage = fake.calls.find(args => args[0] === 'cp')[2].split(':')[0];
  assert.ok(!fake.calls.some(args => args[0] === 'start' && args.includes(stage)));
  assert.equal(fake.calls.filter(args => args[0] === 'start').length, 8);
  assert.equal(fake.calls.filter(args => args[0] === 'rm').length, 9);
  assert.ok(fake.calls.some(args => args[0] === 'image' && args[1] === 'rm' && args[2] === sourceId));
  assert.ok(!fake.calls.some(args => args.includes('--volume') || args.includes('--mount') || args[0] === 'pull'));
});

test('missing Docker, unsafe runtime, timeout, cleanup error and absent synthetic consent never pass', async t => {
  const { inspection, directory } = await fixture(t);
  await assert.rejects(gradeCodingWithDocker(inspection, directory, { image }), /synthetic/);
  const missing = await gradeCodingWithDocker(inspection, directory, { image, synthetic: true,
    command: () => ({ ...success(''), exitCode: null, error: 'ENOENT' }) });
  assert.equal(missing.compiler.status, 'blocked');
  assert.equal(missing.outcome, 'incomplete');
  for (const options of [{ timeout: true }, { badIsolation: true }, { cleanupFailure: true }]) {
    const fake = fakeDocker(options);
    const grade = await gradeCodingWithDocker(inspection, directory, { image, synthetic: true, command: fake.command });
    assert.notEqual(grade.outcome, 'passed');
    assert.ok(fake.calls.some(args => args[0] === 'rm'));
    if (options.badIsolation) assert.ok(!fake.calls.some(args => args[0] === 'start'));
    if (options.timeout) assert.equal(grade.functional.observations[0].timedOut, true);
    if (options.cleanupFailure) assert.ok(grade.functional.cleanupErrors.length);
  }
});
