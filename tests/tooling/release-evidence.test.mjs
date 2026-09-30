import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REQUIRED_RELEASE_CHECKS, validateReleaseEvidence, verifyAssets, validateWorkflowRun,
  verifyWorkflowRun, verifyEvidenceReceipt, verifyReleaseSource, prepareArtifacts, checksumText, evidenceFile } from '../../scripts/verify-release-evidence.mjs';

function manifest() {
  const revision = 'a'.repeat(40);
  return { schemaVersion: 1, version: '0.2.0', sourceRevision: revision, artifactRunId: 123,
    checks: REQUIRED_RELEASE_CHECKS.map(id => ({ id, status: 'passed', sourceRevision: revision, evidencePath: `${id}.json` })),
    assets: ['Studi-Setup.exe', 'Studi-macOS.dmg', 'RELEASES', 'studi-0.2.0-full.nupkg'].map(name => ({ name, sha256: createHash('sha256').update(name).digest('hex') })),
  };
}
test('release rejects missing, failed, duplicate or stale required proof', () => {
  const valid = manifest();
  validateReleaseEvidence(valid, '0.2.0');
  for (const id of REQUIRED_RELEASE_CHECKS) {
    const missing = manifest(); missing.checks = missing.checks.filter(check => check.id !== id);
    assert.throws(() => validateReleaseEvidence(missing, '0.2.0'), /Missing current-source proof/);
    const failed = manifest(); failed.checks.find(check => check.id === id).status = 'not_run';
    assert.throws(() => validateReleaseEvidence(failed, '0.2.0'), /Missing current-source proof/);
  }
  const stale = manifest(); stale.checks[0].sourceRevision = 'b'.repeat(40);
  assert.throws(() => validateReleaseEvidence(stale, '0.2.0'), /current-source/);
  const duplicate = manifest(); duplicate.checks.push(duplicate.checks[0]);
  assert.throws(() => validateReleaseEvidence(duplicate, '0.2.0'), /unique/);
});
test('publication must reuse the exact tested files, including Windows updater artifacts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'studi-release-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const value = manifest();
  for (const asset of value.assets) await writeFile(join(root, asset.name), asset.name);
  await verifyAssets(value, root);
  await writeFile(join(root, 'Studi-Setup.exe'), 'rebuilt after verification');
  await assert.rejects(verifyAssets(value, root), /checksum mismatch/);
  await writeFile(join(root, 'unexpected.exe'), 'extra');
  await assert.rejects(verifyAssets(value, root), /inventory/);
});

test('workflow run must be the successful manual build for this source and repository', async () => {
  const value = manifest(), repository = 'test-owner/test-repo';
  const good = { id: value.artifactRunId, status: 'completed', conclusion: 'success', event: 'workflow_dispatch',
    path: '.github/workflows/release-desktop.yml', head_sha: value.sourceRevision,
    repository: { full_name: repository }, head_repository: { full_name: repository } };
  assert.equal(validateWorkflowRun(good, value, repository), good);
  for (const change of [
    { id: 456 }, { status: 'in_progress' }, { conclusion: 'failure' }, { conclusion: 'cancelled' },
    { event: 'push' }, { event: 'pull_request' }, { path: '.github/workflows/other.yml' },
    { head_sha: 'b'.repeat(40) }, { repository: { full_name: 'other/repo' } }, { head_repository: { full_name: 'fork/repo' } },
  ]) assert.throws(() => validateWorkflowRun({ ...good, ...change }, value, repository));
  let calls = 0;
  const options = { repository, token: 'synthetic-unit-test-token', fetchImpl: async (url, request) => {
    calls++;
    assert.equal(url, 'https://api.github.com/repos/test-owner/test-repo/actions/runs/123');
    assert.equal(request.headers.Authorization, 'Bearer synthetic-unit-test-token');
    assert.ok(request.signal instanceof AbortSignal);
    return { ok: true, json: async () => good };
  } };
  assert.equal(await verifyWorkflowRun(value, options), good);
  assert.equal(calls, 1);
  await assert.rejects(verifyWorkflowRun(value, { ...options, fetchImpl: async () => ({ ok: false, status: 404 }) }), /HTTP 404/);
  await assert.rejects(verifyWorkflowRun(value, { ...options, token: '' }), /GH_TOKEN/);
});

function receipt(check, value) {
  return { checkId: check.id, status: 'passed', sourceRevision: value.sourceRevision, artifactRunId: value.artifactRunId,
    observations: [{ status: 'passed', expected: 'Synthetic controlled test input', observed: 'Synthetic controlled test input; not release proof' }],
    assets: value.assets.filter(asset => check.id.startsWith('macos') ? asset.name === 'Studi-macOS.dmg' : asset.name !== 'Studi-macOS.dmg'),
  };
}
test('native receipts bind the check ID, run, observations and tested artifact hashes', () => {
  const value = manifest();
  for (const check of value.checks) {
    const good = receipt(check, value);
    verifyEvidenceReceipt(good, check, value);
    for (const change of [{ checkId: 'other' }, { status: 'not_run' }, { sourceRevision: 'b'.repeat(40) }, { observations: [] },
      { observations: [{ status: 'passed', expected: ' ', observed: 'ok' }] },
      { observations: [{ status: 'not_run', expected: 'ok', observed: 'ok' }] }]) {
      assert.throws(() => verifyEvidenceReceipt({ ...good, ...change }, check, value));
    }
    if (check.id === 'windows-installed-upgrade' || check.id === 'macos-package-smoke') {
      assert.throws(() => verifyEvidenceReceipt({ ...good, artifactRunId: 456 }, check, value), /another artifact run/);
      assert.throws(() => verifyEvidenceReceipt({ ...good, assets: [] }, check, value), /tested assets/);
      const changed = structuredClone(good); changed.assets[0].sha256 = 'b'.repeat(64);
      assert.throws(() => verifyEvidenceReceipt(changed, check, value), /tested assets/);
    }
  }
});

test('manifest rejects unsafe paths, asset substitutions and invalid source identity', () => {
  for (const mutate of [
    value => { value.version = '0.3.0'; }, value => { value.sourceRevision = 'main'; },
    value => { value.artifactRunId = '123'; }, value => { value.artifactRunId = 0; },
    value => { value.checks[0].evidencePath = '../outside.json'; },
    value => { value.checks[0].evidencePath = '/absolute.json'; },
    value => { value.checks[0].evidencePath = 'nested/../../outside.json'; },
    value => { value.checks[0].evidencePath = value.checks[1].evidencePath; },
    value => { value.assets[0].sha256 = 'wrong'; },
    value => { value.assets[0].name = '../Studi-Setup.exe'; },
    value => { value.assets = value.assets.filter(asset => !asset.name.endsWith('-full.nupkg')); },
    value => { value.assets.push({ name: 'unreviewed.zip', sha256: 'a'.repeat(64) }); },
  ]) { const value = manifest(); mutate(value); assert.throws(() => validateReleaseEvidence(value, '0.2.0')); }
});

async function directory(t) {
  const root = await mkdtemp(join(tmpdir(), 'studi-release-gate-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test('artifact staging starts empty; stale checksums, directories and missing assets fail closed', async t => {
  const root = await directory(t), staged = join(root, 'release'), value = manifest();
  prepareArtifacts(staged);
  for (const asset of value.assets) await writeFile(join(staged, asset.name), asset.name);
  assert.throws(() => prepareArtifacts(staged), /must be empty/);
  await verifyAssets(value, staged);
  await writeFile(join(staged, 'SHA256SUMS.txt'), 'stale checksum list');
  await assert.rejects(verifyAssets(value, staged), /SHA256SUMS/);
  await writeFile(join(staged, 'SHA256SUMS.txt'), checksumText(value));
  await verifyAssets(value, staged);
  await rm(join(staged, 'Studi-Setup.exe'));
  await assert.rejects(verifyAssets(value, staged), /inventory/);
  await mkdir(join(staged, 'Studi-Setup.exe'));
  await assert.rejects(verifyAssets(value, staged), /regular file/);
});

test('an evidence path cannot escape via a symlinked parent directory', async t => {
  const root = await directory(t), evidence = join(root, 'evidence'), outside = join(root, 'outside');
  await mkdir(evidence); await mkdir(outside);
  await writeFile(join(outside, 'proof.json'), '{}');
  await symlink(outside, join(evidence, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => evidenceFile(evidence, 'linked/proof.json'), /inside the release evidence/);
});

function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, '-c', 'user.name=Controlled test', '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=' + join(root, 'no-hooks'), ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function sourceFixture(t) {
  // This history is only in a disposable temp repository. Never create real
  // release receipts, tags or commits in the working checkout from these tests.
  const root = await directory(t);
  git(root, 'init');
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.2.0' }));
  await writeFile(join(root, 'app.js'), '// synthetic source\n');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'Synthetic source');
  const value = manifest(); value.sourceRevision = git(root, 'rev-parse', 'HEAD');
  for (const check of value.checks) check.sourceRevision = value.sourceRevision;
  const evidenceRoot = join(root, 'docs/releases/v0.2.0');
  await mkdir(evidenceRoot, { recursive: true });
  for (const check of value.checks) await writeFile(join(evidenceRoot, check.evidencePath), JSON.stringify(receipt(check, value)));
  await writeFile(join(evidenceRoot, 'evidence.json'), JSON.stringify(value));
  git(root, 'add', '.'); git(root, 'commit', '-m', 'Synthetic evidence only');
  return { root, value, evidenceRoot };
}
test('real Git gate permits evidence-only descendants and rejects source changes or untracked proof', async t => {
  const { root, value, evidenceRoot } = await sourceFixture(t);
  assert.equal(verifyReleaseSource(root, 'v0.2.0').sourceRevision, value.sourceRevision);
  assert.throws(() => verifyReleaseSource(root, 'v0.2.1'), /tag must match/);
  await writeFile(join(root, 'app.js'), '// changed after source build\n');
  assert.throws(() => verifyReleaseSource(root), /tracked changes/);
  git(root, 'add', '.'); git(root, 'commit', '-m', 'Synthetic source changed');
  assert.throws(() => verifyReleaseSource(root), /Code changed/);
  await writeFile(join(root, 'app.js'), '// synthetic source\n');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'Restore synthetic source tree');
  git(root, 'rm', '--cached', 'docs/releases/v0.2.0/controlled.json');
  git(root, 'commit', '-m', 'Synthetic receipt untracked');
  assert.throws(() => verifyReleaseSource(root), /Git source verification failed/);
  assert.ok(await readFile(join(evidenceRoot, 'controlled.json'), 'utf8'));
});

test('standalone Node CLI verifies exact files and emits promotion outputs without dependencies', async t => {
  const { root, value } = await sourceFixture(t), staged = join(root, 'release');
  prepareArtifacts(staged);
  for (const asset of value.assets) await writeFile(join(staged, asset.name), asset.name);
  const output = join(root, 'github-output');
  const script = fileURLToPath(new URL('../../scripts/verify-release-evidence.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--tag', 'v0.2.0', '--artifacts', staged, '--write-checksums', '--github-output', output], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(staged, 'SHA256SUMS.txt'), 'utf8'), checksumText(value));
  assert.equal(await readFile(output, 'utf8'), `artifactRunId=123\nsourceRevision=${value.sourceRevision}\nversion=0.2.0\n`);
  await writeFile(join(staged, 'Studi-macOS.dmg'), 'wrong binary');
  const bad = spawnSync(process.execPath, [script, '--artifacts', staged], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /checksum mismatch/);
});
