// Trusted operator tooling only. Never import into the candidate/browser runtime.
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { gradeWork } from './grade-work.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const names = ['main.c', 'stats.c', 'stats.h', 'README.md'];

// The runner must execute this in a disposable sandbox with no host mounts,
// credentials or network. Source files and the compiled binary are untrusted.
// The constant oracle belongs to the operator and must not be sent to Inky.
export const rainfallSandboxSpec = Object.freeze({
  language: 'c11', compile: ['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', 'main.c', 'stats.c', '-o', 'rainfall'],
  entryOutput: '5.00\n',
  cases: [
    { name: 'normal', values: [5, 10, 0, 5], expected: 5 },
    { name: 'negative', values: [-8, -4, -3], expected: -5 },
    { name: 'empty', values: [], expected: 0 },
    { name: 'singleton', values: [7.25], expected: 7.25 },
    { name: 'mixed', values: [-2, 0, 1, 9], expected: 2 },
    { name: 'fractional', values: [0.1, 0.2, 0.3], expected: 0.2 },
    { name: 'zeros', values: [0, 0, 0], expected: 0 },
  ],
  limits: { wallTimeMs: 10000, memoryMb: 128, outputBytes: 65536, network: false, hostMounts: false },
});

export async function gradeCodingArtifacts(inspection, runDirectory) {
  const delivery = gradeWork(inspection, 'rainfall-project');
  if (delivery.outcome === 'failed') return { ...delivery, checks: [] };
  const submission = inspection.state.submissions.find(item => item.id === delivery.receiptId);
  const checks = [], files = {};
  const add = (name, passed, detail) => checks.push({ name, passed, detail });
  let root;
  try { root = await realpath(join(resolve(runDirectory), 'uploads')); }
  catch { return { ...delivery, outcome: 'failed', quality: 'not_run', reason: 'Committed upload directory is missing', checks }; }
  for (const name of names) {
    const file = submission.files.find(item => item.name === name);
    try {
      if (!/^[a-f0-9]{64}$/.test(file.hash) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > 1_000_000) throw new Error('Invalid or oversized committed artifact');
      const path = join(root, file.hash), info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.bytes || dirname(await realpath(path)) !== root) throw new Error('Artifact must be an ordinary committed blob');
      const bytes = await readFile(path);
      if (sha256(bytes) !== file.hash) throw new Error('Committed artifact hash mismatch');
      files[name] = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      add(`${name}: committed bytes verified`, true, { sha256: file.hash, bytes: file.bytes });
    } catch (error) { add(`${name}: committed bytes verified`, false, error.message); }
  }
  const readme = files['README.md'] ?? '';
  add('README documents strict multi-file compilation', /(?:cc|gcc|clang)\s[^\n]*-std=c11/.test(readme) && ['-Wall', '-Wextra', '-Werror', 'main.c', 'stats.c'].every(part => readme.includes(part)), 'Text heuristic; actual compilation is a separate gate.');
  add('README documents execution and required test categories', /(?:\.\/rainfall|rainfall\.exe)/.test(readme) && ['normal', 'negative', 'empty'].every(word => new RegExp(`\\b${word}\\b`, 'i').test(readme)), 'Documentation coverage, not functional correctness.');
  const passed = checks.every(item => item.passed);
  const artifactHash = sha256(JSON.stringify(submission.files.map(file => ({ name: file.name, hash: file.hash })).sort((a, b) => a.name.localeCompare(b.name))));
  return { ...delivery, outcome: passed ? 'incomplete' : 'failed', quality: 'not_run', checks, artifactHash,
    compiler: { status: 'blocked', reason: 'Static grading does not run a compiler. Use the opt-in synthetic Docker adapter; never compile or execute submitted code on the host.' },
    reason: passed ? 'Delivery, artifact integrity and README coverage passed. Compilation and functional quality remain unproven.' : 'Artifact integrity or documented requirements failed.' };
}
