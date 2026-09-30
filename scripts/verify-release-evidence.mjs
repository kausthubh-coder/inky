// Node 24 standard-library gate: the promotion job installs no app dependencies.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, lstatSync, readdirSync, realpathSync, mkdirSync, appendFileSync, writeFileSync, createReadStream } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const RELEASE_WORKFLOW = '.github/workflows/release-desktop.yml';
export const REQUIRED_RELEASE_CHECKS = [
  'controlled', 'design-fidelity', 'live-chatgpt', 'live-claude', 'learn-journey',
  'windows-installed-upgrade', 'macos-package-smoke',
];
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = value => typeof value === 'string' && !!value.trim();
const safePath = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
  && value.split('/').every(part => part && part !== '.' && part !== '..');
const unique = values => new Set(values).size === values.length;

export function validateReleaseEvidence(manifest, version) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.version !== version || !sha(manifest.sourceRevision)) throw new Error('Release evidence has the wrong version or source revision');
  if (!Number.isSafeInteger(manifest.artifactRunId) || manifest.artifactRunId <= 0) throw new Error('A completed installer workflow run is required');
  if (!Array.isArray(manifest.checks) || manifest.checks.some(check => !check || !REQUIRED_RELEASE_CHECKS.includes(check.id))
    || !unique(manifest.checks.map(check => check.id))) throw new Error('Release checks must have unique known IDs');
  for (const id of REQUIRED_RELEASE_CHECKS) {
    const check = manifest.checks.find(item => item.id === id);
    if (!check || check.status !== 'passed' || check.sourceRevision !== manifest.sourceRevision || !safePath(check.evidencePath)) throw new Error('Missing current-source proof: ' + id);
  }
  if (!unique(manifest.checks.map(check => check.evidencePath))) throw new Error('Each release check needs its own evidence receipt');
  if (!Array.isArray(manifest.assets) || manifest.assets.some(asset => !asset || typeof asset.name !== 'string') || !unique(manifest.assets.map(asset => asset.name.toLowerCase()))) throw new Error('Release assets must have unique names');
  for (const asset of manifest.assets) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(asset.name) || asset.name === 'SHA256SUMS.txt' || !hash(asset.sha256)) throw new Error('Invalid asset filename or SHA256');
  }
  for (const required of ['Studi-Setup.exe', 'Studi-macOS.dmg', 'RELEASES']) {
    if (!manifest.assets.some(asset => asset.name === required)) throw new Error('Missing release asset: ' + required);
  }
  if (!manifest.assets.some(asset => asset.name.endsWith('-full.nupkg'))) throw new Error('Missing Windows update package');
  if (manifest.assets.some(asset => !['Studi-Setup.exe', 'Studi-macOS.dmg', 'RELEASES'].includes(asset.name) && !asset.name.endsWith('-full.nupkg'))) throw new Error('Unexpected release asset type');
  return manifest;
}

export function validateWorkflowRun(run, manifest, repository) {
  if (!run || run.id !== manifest.artifactRunId || run.status !== 'completed' || run.conclusion !== 'success') throw new Error('Artifact workflow run must be completed successfully');
  if (run.path !== RELEASE_WORKFLOW || run.event !== 'workflow_dispatch') throw new Error('Artifacts must come from a manual release-desktop.yml run');
  if (run.head_sha !== manifest.sourceRevision) throw new Error('Artifact run headSHA differs from sourceRevision');
  if (run.repository?.full_name !== repository || run.head_repository?.full_name !== repository) throw new Error('Artifact workflow repository differs from this repository');
  return run;
}

export async function verifyWorkflowRun(manifest, { repository, token, apiUrl = 'https://api.github.com', fetchImpl = fetch }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') || !text(token)) throw new Error('GITHUB_REPOSITORY and GH_TOKEN are required to verify the artifact run');
  const response = await fetchImpl(apiUrl.replace(/\/$/, '') + '/repos/' + repository + '/actions/runs/' + manifest.artifactRunId, {
    headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error('Artifact workflow lookup failed: HTTP ' + response.status);
  return validateWorkflowRun(await response.json(), manifest, repository);
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('Git source verification failed (' + args[0] + ')');
  return result.stdout.trim();
}
function inside(root, file) {
  const rel = relative(root, file);
  return rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && !isAbsolute(rel);
}
export function evidenceFile(root, path) {
  if (!safePath(path)) throw new Error('Evidence path must be relative with no traversal');
  const file = resolve(root, path);
  if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()
    || !inside(realpathSync(root), realpathSync(file))) throw new Error('Evidence must be a regular file inside the release evidence directory');
  return file;
}

export function verifyEvidenceReceipt(evidence, check, manifest) {
  if (!evidence || evidence.checkId !== check.id || evidence.status !== 'passed' || evidence.sourceRevision !== manifest.sourceRevision
    || !Array.isArray(evidence.observations) || !evidence.observations.length) throw new Error('Evidence receipt is incomplete: ' + check.id);
  if (evidence.observations.some(item => !item || !text(item.expected) || !text(item.observed) || item.status !== 'passed')) throw new Error('Unproven observations in ' + check.evidencePath);
  if (['windows-installed-upgrade', 'macos-package-smoke'].includes(check.id)) {
    if (evidence.artifactRunId !== manifest.artifactRunId) throw new Error('Native proof is for another artifact run: ' + check.id);
    const expected = manifest.assets.filter(asset => check.id.startsWith('macos') ? asset.name === 'Studi-macOS.dmg' : asset.name !== 'Studi-macOS.dmg');
    if (!Array.isArray(evidence.assets) || evidence.assets.length !== expected.length || !unique(evidence.assets.map(asset => asset?.name))
      || expected.some(asset => !evidence.assets.some(actual => actual?.name === asset.name && actual.sha256 === asset.sha256))) throw new Error('Native proof does not identify the tested assets: ' + check.id);
  }
}

export function verifyReleaseSource(root = process.cwd(), tag) {
  root = resolve(root);
  const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new Error('Invalid release version');
  if (tag !== undefined && tag !== 'v' + version) throw new Error('Release tag must match package.json version');
  const prefix = 'docs/releases/v' + version + '/', directory = resolve(root, prefix);
  const manifestFile = evidenceFile(directory, 'evidence.json');
  const manifest = validateReleaseEvidence(JSON.parse(readFileSync(manifestFile, 'utf8')), version);
  git(root, ['merge-base', '--is-ancestor', manifest.sourceRevision, 'HEAD']);
  const changes = git(root, ['diff', '--name-only', '-z', manifest.sourceRevision, 'HEAD']).split('\0').filter(Boolean);
  if (changes.some(file => !file.startsWith(prefix))) throw new Error('Code changed after the verified installer build');
  if (git(root, ['status', '--porcelain', '--untracked-files=no'])) throw new Error('Commit all tracked changes before verifying release evidence');
  git(root, ['ls-files', '--error-unmatch', '--', prefix + 'evidence.json']);
  for (const check of manifest.checks) {
    const file = evidenceFile(directory, check.evidencePath);
    git(root, ['ls-files', '--error-unmatch', '--', prefix + check.evidencePath]);
    verifyEvidenceReceipt(JSON.parse(readFileSync(file, 'utf8')), check, manifest);
  }
  return manifest;
}

export function prepareArtifacts(directory) {
  directory = resolve(directory);
  if (existsSync(directory)) {
    if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory() || readdirSync(directory).length) throw new Error('Artifact download directory must be empty and task-owned');
  } else mkdirSync(directory, { recursive: true });
}
export function checksumText(manifest) {
  return [...manifest.assets].sort((a, b) => a.name.localeCompare(b.name, 'en')).map(asset => asset.sha256 + '  ' + asset.name + '\n').join('');
}
export async function verifyAssets(manifest, directory) {
  directory = resolve(directory);
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error('Artifact directory must be a regular directory');
  const names = readdirSync(directory).filter(name => name !== 'SHA256SUMS.txt').sort();
  if (JSON.stringify(names) !== JSON.stringify(manifest.assets.map(asset => asset.name).sort())) throw new Error('Downloaded artifacts do not match the tested asset inventory');
  for (const asset of manifest.assets) {
    const file = evidenceFile(directory, asset.name), digest = createHash('sha256');
    if (!lstatSync(file).size) throw new Error('Empty tested installer: ' + asset.name);
    for await (const chunk of createReadStream(file)) digest.update(chunk);
    if (digest.digest('hex') !== asset.sha256) throw new Error('Tested installer checksum mismatch: ' + asset.name);
  }
  if (existsSync(resolve(directory, 'SHA256SUMS.txt'))
    && readFileSync(evidenceFile(directory, 'SHA256SUMS.txt'), 'utf8') !== checksumText(manifest)) throw new Error('SHA256SUMS.txt differs from the verified asset hashes');
}

async function main() {
  const { values } = parseArgs({ options: {
    artifacts: { type: 'string' }, tag: { type: 'string' }, 'verify-run': { type: 'boolean' },
    'prepare-artifacts': { type: 'string' }, 'github-output': { type: 'string' }, 'write-checksums': { type: 'boolean' },
  } });
  const manifest = verifyReleaseSource(process.cwd(), values.tag);
  if (values['verify-run']) await verifyWorkflowRun(manifest, {
    repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN,
    apiUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com',
  });
  if (values['prepare-artifacts']) prepareArtifacts(values['prepare-artifacts']);
  if (values.artifacts) await verifyAssets(manifest, values.artifacts);
  if (values['write-checksums']) {
    if (!values.artifacts) throw new Error('--write-checksums requires --artifacts');
    writeFileSync(resolve(values.artifacts, 'SHA256SUMS.txt'), checksumText(manifest), { flag: 'wx' });
  }
  if (values['github-output']) appendFileSync(values['github-output'], 'artifactRunId=' + manifest.artifactRunId + '\nsourceRevision=' + manifest.sourceRevision + '\nversion=' + manifest.version + '\n');
  console.log('Release evidence' + (values['verify-run'] ? ', manual artifact run' : '') + ' and ' + (values.artifacts ? 'tested artifact checksums' : 'source identity') + ' verified for v' + manifest.version);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
