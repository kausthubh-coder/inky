// Optional trusted operator adapter. Never imported by the LMS/public agent.
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, chmod, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gradeCodingArtifacts, rainfallSandboxSpec } from './grade-code.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const imageId = value => /^sha256:[a-f0-9]{64}$/.test(value ?? '');
const names = ['main.c', 'stats.c', 'stats.h', 'README.md'];
export const dockerLimits = Object.freeze({ fileBytes: 65536, totalBytes: 131072,
  memoryBytes: 134217728, pids: 32, tmpfsBytes: 33554432, outputBytes: 65536,
  caseWallTimeMs: 10000, totalWallTimeMs: 120000 });

// No candidate header or candidate main is included in the independent driver.
// Inputs and expected results stay with the host operator, not in this source.
export const rainfallOracle = `#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
extern double mean(const double *values, size_t count);
int main(int argc, char **argv) {
  double values[64];
  if (argc > 65) return 2;
  for (int i = 1; i < argc; i++) {
    char *end;
    values[i - 1] = strtod(argv[i], &end);
    if (*end) return 2;
  }
  printf("%.17g\\n", mean(argc == 1 ? NULL : values, (size_t)(argc - 1)));
  return 0;
}
`;
const common = ['-std=c11', '-Wall', '-Wextra', '-Werror'];
export function dockerPlan(image) {
  if (!/^(?:docker\.io\/library\/)?gcc@sha256:[a-f0-9]{64}$/.test(image ?? '')) throw new Error('Use an operator-reviewed official gcc image pinned by SHA256 digest');
  const cases = [{ name: 'entry', values: [], expected: rainfallSandboxSpec.entryOutput,
    command: ['cc', ...common, '/submission/main.c', '/submission/stats.c', '-o', '/work/program'] },
  ...rainfallSandboxSpec.cases.map(item => ({ ...item,
    command: ['cc', ...common, '/submission/oracle.c', '/submission/stats.c', '-o', '/work/program'] }))];
  return { image, cases, testsHash: hash(JSON.stringify({ oracle: rainfallOracle, cases, limits: dockerLimits })), limits: dockerLimits };
}

export function runtimeCreateArgs(name, image, item) {
  if (!/^studi-rainfall-[a-f0-9-]+$/.test(name) || !imageId(image)) throw new Error('Invalid task-owned container identity');
  // All shell words are operator constants or finite numeric test inputs.
  const command = 'cp /submission/observations.csv /work/observations.csv && '
    + item.command.join(' ') + ' && exec /work/program' + item.values.map(value => ' ' + value).join('');
  return ['create', '--name', name, '--pull=never', '--network=none', '--read-only',
    '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--user=65534:65534',
    '--pids-limit=32', '--memory=128m', '--memory-swap=128m', '--cpus=1', '--ipc=none',
    '--ulimit', 'core=0:0', '--ulimit', 'fsize=4194304:4194304', '--restart=no',
    '--log-driver=none', '--no-healthcheck', '--tmpfs', '/work:rw,exec,nosuid,nodev,size=33554432,mode=1777',
    '--env', 'TMPDIR=/work', '--env', 'HOME=/work', '--env', 'LC_ALL=C',
    '--workdir=/work', '--entrypoint=/bin/sh', image, '-c', command];
}

export function assertRuntimeIsolation(container, image) {
  const h = container?.HostConfig;
  if (!h || container.Image !== image || container.Config?.User !== '65534:65534'
    || !h.ReadonlyRootfs || h.NetworkMode !== 'none' || h.Privileged
    || h.Memory !== dockerLimits.memoryBytes || h.MemorySwap !== dockerLimits.memoryBytes
    || h.PidsLimit !== dockerLimits.pids || h.NanoCpus !== 1000000000
    || !h.CapDrop?.includes('ALL') || !h.SecurityOpt?.includes('no-new-privileges:true')
    || h.Binds?.length || h.Devices?.length || container.Mounts?.some(mount => mount.Type !== 'tmpfs' || mount.Destination !== '/work')
    || h.Tmpfs?.['/work'] !== 'rw,exec,nosuid,nodev,size=33554432,mode=1777') {
    throw new Error('Docker did not enforce the required execution isolation');
  }
}

export function validateDockerResults(plan, records, identity, artifactHash) {
  if (identity?.testsHash !== plan.testsHash || identity?.compilerImage !== plan.image
    || !imageId(identity?.compilerImageId) || !imageId(identity?.submissionImageId)
    || !/^[a-f0-9]{64}$/.test(artifactHash ?? '') || identity?.artifactHash !== artifactHash) return false;
  if (!Array.isArray(records) || records.length !== plan.cases.length || new Set(records.map(item => item?.name)).size !== records.length) return false;
  return plan.cases.every(expected => {
    const actual = records.find(item => item?.name === expected.name);
    if (!actual || actual.isolated !== true || actual.exitCode !== 0 || actual.containerExitCode !== 0
      || actual.timedOut !== false || actual.outputExceeded !== false || actual.oomKilled !== false
      || !Number.isFinite(actual.durationMs) || actual.durationMs < 0 || actual.durationMs > dockerLimits.caseWallTimeMs
      || typeof actual.stdout !== 'string' || typeof actual.stderr !== 'string'
      || Buffer.byteLength(actual.stdout + actual.stderr) > dockerLimits.outputBytes) return false;
    if (expected.name === 'entry') return actual.stdout === expected.expected;
    if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\n$/i.test(actual.stdout)) return false;
    const value = Number(actual.stdout.trim());
    return Number.isFinite(value) && Math.abs(value - expected.expected) <= 1e-9 * Math.max(1, Math.abs(expected.expected));
  });
}

// The only host subprocess is Docker. No cc, shell, submitted script or binary.
export function runDocker(args, timeout = 10000) {
  const start = Date.now();
  const result = spawnSync('docker', args, { encoding: 'utf8', shell: false, windowsHide: true,
    timeout, maxBuffer: dockerLimits.outputBytes, killSignal: 'SIGKILL' });
  const stdout = result.stdout ?? '', stderr = result.stderr ?? '';
  const outputExceeded = result.error?.code === 'ENOBUFS' || Buffer.byteLength(stdout + stderr) > dockerLimits.outputBytes;
  return { exitCode: result.status, stdout: stdout.slice(0, dockerLimits.outputBytes), stderr: stderr.slice(0, Math.max(0, dockerLimits.outputBytes - stdout.length)),
    error: result.error?.code ?? null, timedOut: result.error?.code === 'ETIMEDOUT',
    outputExceeded, durationMs: Date.now() - start };
}

export async function gradeCodingWithDocker(inspection, runDirectory, { image, synthetic = false, command = runDocker } = {}) {
  const plan = dockerPlan(image);
  if (!synthetic || inspection.state?.scenarioId !== 'coding-multifile') throw new Error('Explicit --synthetic and coding-multifile inspection required; never send personal school code');
  const delivery = await gradeCodingArtifacts(inspection, runDirectory);
  if (delivery.outcome === 'failed') return delivery;
  const receipt = { ...delivery, compiler: { status: 'blocked', reason: 'Docker execution has not completed' },
    functional: { evidenceClass: 'isolated-compiler', artifactHash: delivery.artifactHash,
      testsHash: plan.testsHash, compilerImage: image, compilerImageId: null, submissionImageId: null,
      limits: dockerLimits, expected: plan.cases.map(({ name, values, expected }) => ({ name, values, expected })),
      observations: [], cleanupErrors: [] } };
  const proof = receipt.functional, owned = [], start = Date.now();
  let staging;
  const checked = (args, timeout = 10000) => {
    const remaining = dockerLimits.totalWallTimeMs - (Date.now() - start);
    if (remaining <= 0) throw new Error('Total Docker evaluation wall timeout');
    const result = command(args, Math.min(timeout, remaining));
    if (result.exitCode !== 0 || result.error || result.timedOut || result.outputExceeded) throw new Error('Docker ' + args[0] + ' unavailable/failed: ' + (result.error ?? result.exitCode));
    return result.stdout.trim();
  };
  try {
    if (JSON.parse(checked(['info', '--format', '{{json .OSType}}'])) !== 'linux') throw new Error('A Linux Docker engine is required');
    const base = JSON.parse(checked(['image', 'inspect', image]))[0];
    if (!imageId(base?.Id) || base.Os !== 'linux' || Object.keys(base.Config?.Volumes ?? {}).length
      || !base.RepoDigests?.some(value => value.endsWith('@' + image.split('@')[1]))) throw new Error('Pinned compiler image is missing, has volumes or has the wrong identity');
    proof.compilerImageId = base.Id;
    proof.architecture = base.Architecture;
    staging = await mkdtemp(join(tmpdir(), 'studi-rainfall-input-'));
    await chmod(staging, 0o755);
    const submission = inspection.state.submissions.find(item => item.id === delivery.receiptId);
    let total = 0;
    for (const name of names) {
      const file = submission.files.find(item => item.name === name);
      if (file.bytes > dockerLimits.fileBytes || (total += file.bytes) > dockerLimits.totalBytes) throw new Error('Synthetic submission exceeds sandbox byte limits');
      const path = join(runDirectory, 'uploads', file.hash), info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.bytes) throw new Error('Submission blob changed after integrity grading');
      const bytes = await readFile(path);
      if (bytes.length !== file.bytes || hash(bytes) !== file.hash) throw new Error('Submission blob changed after integrity grading');
      await writeFile(join(staging, name), bytes, { mode: 0o444, flag: 'wx' });
    }
    await writeFile(join(staging, 'oracle.c'), rainfallOracle, { mode: 0o444 });
    await writeFile(join(staging, 'observations.csv'), 'day,rain_mm\nMonday,5\nTuesday,10\nWednesday,0\nThursday,5\n', { mode: 0o444 });
    const stageName = 'studi-rainfall-' + randomUUID(); owned.push(stageName);
    // Stopped writable staging is necessary for docker cp. It is NEVER started.
    // Commit only these bounded inputs, then every executed root is read-only.
    checked(['create', '--name', stageName, '--pull=never', '--network=none', '--cap-drop=ALL',
      '--security-opt=no-new-privileges:true', '--user=65534:65534', '--entrypoint=/bin/true', image]);
    checked(['cp', staging + '/.', stageName + ':/submission']);
    proof.submissionImageId = checked(['commit', stageName]);
    if (!imageId(proof.submissionImageId)) throw new Error('Invalid disposable submission image identity');
    for (const item of plan.cases) {
      const name = 'studi-rainfall-' + randomUUID(); owned.push(name);
      checked(runtimeCreateArgs(name, proof.submissionImageId, item));
      assertRuntimeIsolation(JSON.parse(checked(['inspect', name]))[0], proof.submissionImageId);
      const remaining = dockerLimits.totalWallTimeMs - (Date.now() - start);
      if (remaining <= 0) throw new Error('Total Docker evaluation wall timeout');
      const result = command(['start', '--attach', name], Math.min(dockerLimits.caseWallTimeMs, remaining));
      // A timeout kills the Docker client, so force-remove the actual container
      // in finally as well. Never trust exit zero or candidate-written PASS text.
      const state = JSON.parse(checked(['inspect', name]))[0].State;
      proof.observations.push({ name: item.name, isolated: true, exitCode: result.exitCode,
        stdout: result.stdout, stderr: result.stderr, timedOut: result.timedOut, outputExceeded: result.outputExceeded,
        durationMs: result.durationMs, containerExitCode: state.ExitCode, oomKilled: state.OOMKilled });
      checked(['rm', '--force', name]); owned.pop();
      if (result.exitCode !== 0 || result.timedOut || result.outputExceeded || state.OOMKilled) break;
    }
    receipt.quality = 'graded';
    receipt.outcome = validateDockerResults(plan, proof.observations, proof, delivery.artifactHash) ? 'passed' : 'failed';
    receipt.compiler = { status: 'completed', reason: 'Independent host oracle evaluated isolated multi-file compilation and per-case outputs' };
    receipt.reason = receipt.outcome === 'passed' ? 'Delivery, strict compilation, entry output and independent mean cases passed in Docker.' : 'Compilation or independent functional checks failed; see bounded observations.';
  } catch (error) {
    receipt.outcome = 'incomplete'; receipt.quality = 'not_run';
    receipt.compiler = { status: 'blocked', reason: error.message };
    receipt.reason = 'Isolated compiler evidence incomplete; no host compiler fallback.';
  } finally {
    for (const name of owned.reverse()) {
      const result = command(['rm', '--force', name], 10000);
      if (result.exitCode !== 0) proof.cleanupErrors.push('Could not remove task container ' + name);
    }
    if (imageId(proof.submissionImageId)) {
      const result = command(['image', 'rm', proof.submissionImageId], 10000);
      if (result.exitCode !== 0) proof.cleanupErrors.push('Could not remove task submission image ' + proof.submissionImageId);
    }
    if (staging) await rm(staging, { recursive: true, force: true });
    if (proof.cleanupErrors.length) {
      receipt.outcome = 'incomplete'; receipt.compiler = { status: 'blocked', reason: 'Sandbox cleanup failed; inspect only the named task resources' };
    }
    proof.durationMs = Date.now() - start;
  }
  return receipt;
}
