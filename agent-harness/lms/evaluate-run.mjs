// Run after an operator captures school inspection and production observations.
// This CLI evaluates evidence; it never invokes or substitutes for an agent.
import { parseArgs } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { evaluateBenchmark } from './benchmark-receipt.mjs';
import { gradeCodingArtifacts } from './grade-code.mjs';
import { gradeCodingWithDocker } from './grade-code-docker.mjs';

const { values } = parseArgs({ options: { ...Object.fromEntries(
  ['inspection', 'before', 'observation', 'expected', 'origins', 'coding-run', 'output', 'docker-image'].map(name => [name, { type: 'string' }]),
), synthetic: { type: 'boolean' } } });
for (const required of ['inspection', 'observation', 'expected']) {
  if (!values[required]) throw new Error(`--${required} is required`);
}
const json = async name => values[name] ? JSON.parse(await readFile(resolve(values[name]), 'utf8')) : undefined;
const inspection = await json('inspection'), observation = await json('observation'), expected = await json('expected');
if (values['docker-image'] && (expected.kind !== 'homework' || expected.activityId !== 'rainfall-project' || !values['coding-run'] || !values.synthetic)) {
  throw new Error('--docker-image requires rainfall homework, --coding-run and explicit --synthetic');
}
const receipt = evaluateBenchmark({ inspection, observation, expected, before: await json('before'), origins: await json('origins') });
if (expected.activityId === 'rainfall-project' && values['coding-run']) {
  receipt.codingArtifacts = values['docker-image']
    ? await gradeCodingWithDocker(inspection, resolve(values['coding-run']), { image: values['docker-image'], synthetic: values.synthetic })
    : await gradeCodingArtifacts(inspection, resolve(values['coding-run']));
  receipt.evaluation.grade = receipt.codingArtifacts;
  receipt.evaluation.passed = receipt.codingArtifacts.outcome === 'passed' && receipt.evaluation.checks.every(check => check.passed);
}
const output = resolve(values.output ?? `.studi-lms/evaluations/${randomUUID()}.json`);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, passed: receipt.evaluation.passed, metrics: receipt.metrics }));
process.exitCode = receipt.evaluation.passed ? 0 : 1;
