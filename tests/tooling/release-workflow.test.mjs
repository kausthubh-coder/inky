import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import forge from '../../forge.config.mjs';
import { assertNativeRunner, assertStartup } from '../../scripts/verify-macos-first-launch.mjs';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const workflow = parse(read('.github/workflows/release-desktop.yml'));
const action = (job, name) => job.steps.filter(step => step.uses?.startsWith(name + '@'));

test('manual builds and tag promotion have disjoint execution paths without skipped dependencies', () => {
  assert.ok(Object.hasOwn(workflow.on, 'workflow_dispatch'));
  assert.deepEqual(workflow.on.push.tags, ['v*']);
  for (const name of ['windows', 'macos']) {
    const job = workflow.jobs[name];
    assert.equal(job.if, "github.event_name == 'workflow_dispatch'");
    assert.ok(job.steps.some(step => step.run?.includes('bun run make:')));
    assert.ok(job.steps.some(step => step.run === 'bun run test:release'));
    assert.equal(action(job, 'actions/upload-artifact').find(step => step.with.name === 'studi-' + name).with['if-no-files-found'], 'error');
  }
  const promotion = workflow.jobs.release;
  assert.equal(promotion.if, "github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')");
  assert.equal(promotion.needs, undefined);
  assert.equal(promotion.permissions.actions, 'read');
  assert.equal(promotion.permissions.contents, 'write');
  assert.equal(action(promotion, 'actions/setup-node')[0].with['node-version'], 24);
  assert.equal(action(promotion, 'oven-sh/setup-bun').length, 0);
  assert.doesNotMatch(promotion.steps.map(step => step.run ?? '').join('\n'), /\b(?:bun|bunx|npm|npx)\b|make:|build:/);
  for (const job of Object.values(workflow.jobs)) assert.equal(action(job, 'actions/checkout')[0].with['fetch-depth'], 0);
});

test('promotion downloads only named assets from verified run into one empty directory, then hashes before publication', () => {
  const steps = workflow.jobs.release.steps;
  const gateIndex = steps.findIndex(step => step.id === 'evidence');
  assert.match(steps[gateIndex].run, /node scripts\/verify-release-evidence\.mjs.*--verify-run.*--prepare-artifacts release.*--github-output/);
  assert.equal(steps[gateIndex].env.GH_TOKEN, '${{ github.token }}');
  const downloads = action(workflow.jobs.release, 'actions/download-artifact');
  assert.deepEqual(downloads.map(step => step.with.name), ['studi-windows', 'studi-macos']);
  for (const step of downloads) {
    assert.ok(steps.indexOf(step) > gateIndex);
    assert.deepEqual(step.with, { name: step.with.name, 'run-id': '${{ steps.evidence.outputs.artifactRunId }}',
      'github-token': '${{ github.token }}', repository: '${{ github.repository }}', path: 'release' });
  }
  const hashIndex = steps.findIndex(step => step.run?.includes('--artifacts release --write-checksums'));
  const publishIndex = steps.findIndex(step => step.run?.includes('gh release create'));
  assert.ok(hashIndex > Math.max(...downloads.map(step => steps.indexOf(step))));
  assert.ok(publishIndex > hashIndex);
  assert.match(steps[hashIndex].run, /--verify-run/);
  assert.match(steps[publishIndex].run, /release\/\* --verify-tag/);
  assert.equal(steps[publishIndex].if, undefined, 'publication must require preceding successful verification');
  assert.equal(steps[hashIndex]['continue-on-error'], undefined);
  assert.equal(steps[gateIndex]['continue-on-error'], undefined);
});

test('plans and evidence stay outside packaged app while production entrypoints stay included', () => {
  const ignored = path => forge.packagerConfig.ignore.some(pattern => pattern.test(path));
  for (const path of ['/docs', '/docs/redesign/plan.html/SPEC.md', '/docs/releases/v0.2.0/evidence.json', '/.agents/studi-qa/receipt.json']) assert.equal(ignored(path), true, path);
  for (const path of ['/package.json', '/dist/client/index.html', '/dist/electron/main.js', '/node_modules/production/index.js']) assert.equal(ignored(path), false, path);
});

test('macOS stages one image, inspects it read-only, launches its app and retains separate native proof', () => {
  const steps = workflow.jobs.macos.steps;
  const stage = steps.findIndex(step => step.name === 'Stage macOS disk image');
  const native = steps.findIndex(step => step.run?.includes('bash scripts/verify-macos-dmg.sh'));
  const upload = steps.findIndex(step => step.with?.name === 'studi-macos');
  assert.ok(stage < native && native < upload);
  assert.match(steps[stage].run, /test "\$count" = 1/);
  assert.match(steps[native].run, /release\/Studi-macOS.dmg out\/Studi-darwin-universal\/Studi.app native-proof\/macos/);
  const proof = steps.find(step => step.with?.name === 'studi-macos-native-proof');
  assert.equal(proof.if, 'always()');
  assert.equal(proof.with.path, 'native-proof/macos/*');
  const script = read('scripts/verify-macos-dmg.sh');
  assert.match(script, /hdiutil attach "\$image" -readonly -nobrowse/);
  assert.match(script, /-verify_arch x86_64 arm64/);
  assert.match(script, /trap cleanup EXIT/);
  assert.ok(script.indexOf('cmp "$app/Contents/Resources/app.asar"') < script.indexOf('node scripts/verify-macos-first-launch.mjs'));
});

test('native startup guard rejects local machines and empty/foreign/missing-preload renderers', () => {
  const env = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123' };
  assertNativeRunner(env, 'darwin');
  assert.throws(() => assertNativeRunner(env, 'win32'), /disposable/);
  for (const change of [{ GITHUB_ACTIONS: 'false' }, { RUNNER_ENVIRONMENT: 'self-hosted' }, { GITHUB_SHA: 'main' }, { GITHUB_RUN_ID: '' }]) {
    assert.throws(() => assertNativeRunner({ ...env, ...change }, 'darwin'), /disposable/);
  }
  const url = 'file:///Volumes/Test/Studi.app/Contents/Resources/app.asar/dist/client/index.html';
  const state = { url, ready: 'complete', rootRendered: true, preload: true, authResponded: true };
  assertStartup(state, url);
  for (const change of [{ url: 'http://localhost:5173' }, { ready: 'loading' }, { rootRendered: false }, { preload: false }, { authResponded: false }]) {
    assert.throws(() => assertStartup({ ...state, ...change }, url), /not ready/);
  }
  const script = fileURLToPath(new URL('../../scripts/verify-macos-first-launch.mjs', import.meta.url));
  const blocked = spawnSync(process.execPath, [script], { encoding: 'utf8', windowsHide: true, env: { ...process.env, GITHUB_ACTIONS: 'false' } });
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /disposable GitHub-hosted/);
});
