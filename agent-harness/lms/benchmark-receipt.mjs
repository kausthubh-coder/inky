import { gradeWork } from './grade-work.mjs';
import { gradeRecovery, gradeLearn } from './evaluate.mjs';

const usageFields = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'];
const number = (value, integer = false) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && (!integer || Number.isSafeInteger(value));
export function measuredUsage(attempts) {
  const sum = (read, integer = true) => {
    const values = attempts.map(read);
    if (!values.length || !values.every(value => number(value, integer))) return null;
    const total = values.reduce((a, b) => a + b, 0);
    return number(total, integer) ? total : null;
  };
  return {
    durationMs: sum(item => item.metrics?.durationMs, false),
    toolCalls: sum(item => item.metrics?.toolCalls),
    modelCalls: sum(item => item.metrics?.modelCalls),
    usage: Object.fromEntries(usageFields.map(field => [field, sum(item => item.metrics?.usage?.[field])])),
    // Only explicitly reported monetary charges count. Tokens, subscriptions,
    // missing bills, and an inferred price table do not establish actual cost.
    costUsd: sum(item => item.metrics?.costUsd, false),
  };
}

// Keep every attempted run, including timeouts. A caller-supplied "passed" or
// agent narrative is retained as observation but cannot set the evaluator grade.
export function evaluateBenchmark({ inspection, before, observation, expected, origins }) {
  if (!expected || !['homework', 'recovery', 'learn'].includes(expected.kind)) throw new Error('Authored expectation is required');
  const attempts = observation?.attempts ?? [];
  const config = observation?.config;
  let grade;
  if (expected.kind === 'learn') grade = gradeLearn(inspection, observation?.learn, origins);
  else if (expected.kind === 'recovery') grade = gradeRecovery(before, inspection, expected);
  else grade = gradeWork(inspection, expected.activityId);
  const metrics = measuredUsage(attempts);
  const checks = [
    { name: 'explicit evidence class', passed: ['controlled', 'live-production-runtime'].includes(observation?.evidenceClass) },
    { name: 'attempt inventory recorded', passed: Array.isArray(observation?.attempts) && attempts.length > 0 },
    { name: 'final attempt completed', passed: attempts.at(-1)?.status === 'completed' },
    { name: 'effective configuration recorded', passed: !!config && ['model', 'provider', 'effort'].every(field => observation.evidenceClass === 'controlled' ? config[field] === null || typeof config[field] === 'string' : typeof config[field] === 'string' && config[field].length > 0) },
    { name: 'tool budget measured and respected', passed: Number.isSafeInteger(config?.maxToolCalls) && config.maxToolCalls > 0 && metrics.toolCalls !== null && metrics.toolCalls <= config.maxToolCalls },
    { name: 'time budget measured and respected', passed: number(config?.budgetMs) && config.budgetMs > 0 && metrics.durationMs !== null && metrics.durationMs <= config.budgetMs },
    { name: 'no policy violations', passed: Array.isArray(observation?.policyViolations) && observation.policyViolations.length === 0 },
  ];
  const independentPass = grade.passed === true || grade.outcome === 'passed';
  return { schemaVersion: 1, expected: structuredClone(expected), observation: structuredClone(observation),
    evaluation: { passed: independentPass && checks.every(check => check.passed), checks, grade }, metrics,
    scope: 'Operator grading of recorded school/app results. Live-production-runtime requires a production driver; this evaluator does not run one.' };
}
