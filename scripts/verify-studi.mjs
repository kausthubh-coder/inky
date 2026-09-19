import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const groups = ['contracts', 'agent', 'storage', 'auth', 'telemetry', 'packaging', 'foundation', 'ui', 'benchmark', 'lms', 'tooling', 'backend', 'harness', 'electron'];
const scopes = {
  all: groups, release: groups,
  scan: ['contracts', 'storage', 'agent', 'ui', 'benchmark', 'lms'],
  homework: ['contracts', 'storage', 'agent', 'harness', 'lms'],
  auth: ['auth', 'contracts', 'backend'],
  ui: ['ui'], agent: ['agent', 'contracts', 'harness', 'benchmark'],
  storage: ['storage', 'contracts'], lms: ['lms'],
  tooling: ['tooling', 'auth', 'lms'],
  telemetry: ['telemetry'], updates: ['contracts', 'packaging'],
  backend: ['backend'], electron: ['electron'],
};

// Conservative boundary map, not a dependency graph. Unknown code escalates.
export function affectedScopes(paths) {
  const selected = new Set();
  for (const raw of paths) {
    const path = raw.replaceAll('\\', '/');
    if (/^(.agents\/skills\/test-studi\/scripts\/|scripts\/verify-studi|tests\/tooling\/)/.test(path)) selected.add('tooling');
    else if (/^(agent-harness\/lms\/)/.test(path)) selected.add('lms');
    else if (/^agent-harness\/benchmark\//.test(path)) selected.add('scan');
    else if (/^(desktop\/electron\/(scan|browser)\/)/.test(path)) selected.add('scan');
    else if (/^desktop\/electron\/(assignment|files|lifecycle|manager)\//.test(path)) selected.add('homework');
    else if (/^desktop\/electron\/auth\//.test(path)) selected.add('auth');
    else if (/^desktop\/electron\/storage\//.test(path)) selected.add('storage');
    else if (/^desktop\/electron\/telemetry\//.test(path)) selected.add('telemetry');
    else if (/^desktop\/electron\/updates\//.test(path)) selected.add('updates');
    else if (/^(desktop\/agent-system\/|desktop\/electron\/agent\/|agent-harness\/)/.test(path)) selected.add('agent');
    else if (/^desktop\/src\//.test(path)) selected.add('ui');
    else if (/^convex\//.test(path)) selected.add('backend');
    else if (/^tests\/(contracts|agent|storage|auth|telemetry|packaging|ui|benchmark)\//.test(path)) selected.add(path.split('/')[1]);
    else if (/\.(md|html)$/.test(path) && /^(docs\/|\.agent\/plans\/|\.agents\/skills\/|AGENTS\.md$)/.test(path)) continue;
    else selected.add('all');
  }
  return [...selected];
}

export function makePlan({ scope = [], files = [], changedPaths = [] } = {}) {
  const selected = new Set();
  for (const name of [...scope, ...affectedScopes(changedPaths)]) {
    const entries = scopes[name] ?? (groups.includes(name) ? [name] : null);
    if (!entries) throw new Error(`Unknown scope: ${name}`);
    entries.forEach(entry => selected.add(entry));
  }
  const targets = new Set();
  for (const file of files) {
    const normalized = file.replaceAll('\\', '/').replace(/^\.\//, '');
    if (!/^(tests\/[a-z0-9-]+\/|agent-harness\/lms\/tests\/)[a-z0-9.-]+\.test\.mjs$/i.test(normalized)) throw new Error(`Expected a repository test file: ${file}`);
    targets.add(normalized);
  }
  for (const group of selected) {
    if (group === 'foundation') {
      targets.add('tests/clean-room-boundary.test.mjs'); targets.add('tests/build-shape.test.mjs');
    } else if (group === 'lms') targets.add('agent-harness/lms/tests/*.test.mjs');
    else if (!['backend', 'harness', 'electron'].includes(group)) targets.add(`tests/${group}/*.test.mjs`);
  }
  const steps = [];
  const add = (id, executable, args, requires = []) => steps.push({ id, executable, args, requires });
  const needsFullBuild = selected.has('foundation') || selected.has('electron') || selected.has('auth') || [...targets].some(file => file.startsWith('tests/auth/'));
  const needsElectron = needsFullBuild || [...targets].some(file => !/^(tests\/(ui|benchmark|tooling)\/|agent-harness\/lms\/)/.test(file));
  const needsLms = ['lms', 'auth', 'harness'].some(group => selected.has(group)) || [...targets].some(file => /^(tests\/auth\/|agent-harness\/lms\/)/.test(file));
  if (selected.size || targets.size) add('typecheck', 'bun', ['run', 'typecheck']);
  if (needsLms) add('typecheck-lms', 'bun', ['run', 'typecheck:lms']);
  if (needsElectron) add('build', 'bun', ['run', needsFullBuild ? 'build' : 'build:electron']);
  if (needsLms) add('build-lms', 'bun', ['run', 'build:lms']);
  if (targets.size) add('node-tests', process.execPath, ['--experimental-strip-types', '--test', ...targets], [...(needsElectron ? ['build'] : []), ...(needsLms ? ['build-lms'] : [])]);
  if (selected.has('backend')) add('backend', 'bun', ['run', 'test:backend']);
  if (selected.has('harness')) for (const suite of ['foundation', 'routing', 'trace', 'files']) add(`harness-${suite}`, 'bun', ['agent-harness/cli.ts', 'run', '--suite', suite, '--driver', 'scripted', '--json'], ['build-lms']);
  if (selected.has('electron')) {
    add('electron', process.execPath, ['tests/electron-self-test-runner.mjs'], ['build']);
    add('native-materials', 'bun', ['x', 'electron', 'tests/school-materials-native.cjs'], ['build']);
  }
  return { scopes: [...selected], files: [...targets], steps,
    pending: ['Affected visible interaction and recovery (when applicable)', 'Live admission → onboarding → scan → chat → homework → restart for a full journey', 'Installed package/upgrade on each shipping platform for release'] };
}

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
  return result.stdout;
}

export function buildTreeHash(directory) {
  const hash = createHash('sha256');
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = resolve(path, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) hash.update(`${relative(directory, file).replaceAll('\\', '/')}\0`).update(readFileSync(file)).update('\0');
      else throw new Error('Build output must contain only regular files and directories');
    }
  }
  visit(directory);
  return hash.digest('hex');
}

async function main() {
  const { values } = parseArgs({ options: {
    scope: { type: 'string', multiple: true }, file: { type: 'string', multiple: true },
    changed: { type: 'boolean' }, base: { type: 'string' }, 'dry-run': { type: 'boolean' },
  } });
  if (!values.scope?.length && !values.file?.length && !values.changed) throw new Error('Use --scope scan|homework|auth|ui|agent|storage|lms|tooling|all|release, --file tests/<suite>/<name>.test.mjs, or --changed [--base <ref>]. Add --dry-run to inspect.');
  if (values.base && !values.changed) throw new Error('--base requires --changed');
  const changedPaths = values.changed ? [...new Set([
    ...git(['diff', '--name-only', '-z', 'HEAD']).split('\0'),
    ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
    ...(values.base ? git(['diff', '--name-only', '-z', `${values.base}...HEAD`]).split('\0') : []),
  ].filter(Boolean))] : [];
  const plan = makePlan({ scope: values.scope, files: values.file, changedPaths });
  if (values['dry-run']) { console.log(JSON.stringify({ ...plan, changedPaths }, null, 2)); return; }
  const directory = resolve('.agents/studi-qa/checks', `${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`);
  mkdirSync(directory, { recursive: true });
  const receipt = { schemaVersion: 1, evidence: 'controlled', revision: git(['rev-parse', 'HEAD']).trim(), dirty: Boolean(git(['status', '--porcelain']).trim()), changedPaths, plan, checks: [], status: 'running' };
  const save = () => writeFileSync(resolve(directory, 'result.json'), JSON.stringify(receipt, null, 2));
  save();
  for (const step of plan.steps) {
    if (step.requires.some(id => receipt.checks.find(check => check.id === id)?.status !== 'passed')) {
      receipt.checks.push({ id: step.id, status: 'not_run', reason: 'Prerequisite failed' }); save(); continue;
    }
    console.log(`Running ${step.id}…`);
    const started = Date.now();
    const result = spawnSync(step.executable, step.args, { encoding: 'utf8', windowsHide: true, timeout: 600000, maxBuffer: 32 * 1024 * 1024 });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`;
    const log = resolve(directory, `${step.id}.log`);
    writeFileSync(log, output);
    const status = result.status === 0 && !result.error ? 'passed' : 'failed';
    receipt.checks.push({ id: step.id, status, elapsedMs: Date.now() - started, exitCode: result.status, log: relative(process.cwd(), log) });
    if (status === 'passed' && step.id === 'build') receipt.buildTreeSha256 = buildTreeHash(resolve('dist'));
    console.log(`${status}: ${step.id} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    if (status === 'failed') console.error(output.split('\n').slice(-30).join('\n'));
    save();
  }
  receipt.status = !plan.steps.length ? 'not_run' : receipt.checks.every(check => check.status === 'passed') ? 'passed' : 'failed';
  save();
  console.log(`${receipt.status}: ${relative(process.cwd(), directory)}/result.json`);
  console.log('Controlled checks only; live/visual/installed gates remain separate.');
  if (receipt.status === 'failed') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
