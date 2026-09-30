import assert from 'node:assert/strict';
import test from 'node:test';
import { gradeWork } from '../grade-work.mjs';
import { gradeLearn, gradeRecovery, gradeHomeworkDoesNotTeach } from '../evaluate.mjs';
import { evaluateBenchmark, measuredUsage } from '../benchmark-receipt.mjs';

function quiz() {
  return { state: { submissions: [{ id: 'receipt-1', activityId: 'structures-quiz', idempotencyKey: 'quiz:1', answer: 'Q1: B\nQ2: A\nQ3: O(n)', files: [] }] }, effects: [
    { sequence: 1, type: 'draft_saved', activityId: 'structures-quiz' },
    { sequence: 2, type: 'submission_committed', activityId: 'structures-quiz', detail: { key: 'quiz:1' } },
  ] };
}

test('quiz grading rejects invented receipt evidence, duplicate labels and wrong answers', () => {
  assert.equal(gradeWork(quiz(), 'structures-quiz').outcome, 'passed');
  for (const mutate of [
    item => { item.effects = []; },
    item => { item.effects[1].detail.key = 'other-attempt'; },
    item => { item.effects.push({ ...item.effects[1], sequence: 3 }); },
    item => { item.state.submissions[0].answer = 'Q1: B\nQ1: B\nQ3: O(n)'; },
    item => { item.state.submissions[0].answer = 'Q1: B\nQ2: B\nQ3: O(n)'; },
  ]) {
    const inspection = quiz(); mutate(inspection);
    assert.equal(gradeWork(inspection, 'structures-quiz').outcome, 'failed');
  }
});

test('each quiz attempt must have its own matching committed effect', () => {
  const inspection = quiz();
  inspection.state.submissions.push({ ...inspection.state.submissions[0], id: 'receipt-2', idempotencyKey: 'quiz:2' });
  assert.equal(gradeWork(inspection, 'structures-quiz').outcome, 'failed');
  inspection.effects.push({ sequence: 3, type: 'submission_committed', activityId: 'structures-quiz', detail: { key: 'quiz:2' } });
  assert.equal(gradeWork(inspection, 'structures-quiz').outcome, 'passed');
});

test('coding filenames and a successful build badge cannot establish correct code', () => {
  const inspection = quiz();
  for (const effect of inspection.effects) effect.activityId = 'rainfall-project';
  inspection.state.submissions[0].activityId = 'rainfall-project';
  inspection.state.submissions[0].files = ['main.c', 'stats.c', 'stats.h', 'README.md'].map(name => ({ name, bytes: 100 }));
  inspection.state.builds = [{ state: 'success' }];
  assert.equal(gradeWork(inspection, 'rainfall-project').outcome, 'incomplete');
  inspection.state.submissions[0].files.push({ name: 'other.c', bytes: 1 });
  assert.equal(gradeWork(inspection, 'rainfall-project').outcome, 'failed');
});

test('Learn grading rejects invented topics, changed weights and foreign provenance', () => {
  const origins = { school: 'http://127.0.0.1:32100' };
  const inspection = { truth: {
    expectedExams: [{ id: 'midterm', courseId: 'structures', title: 'Midterm', date: '2026-09-21T17:00:00.000Z', sourcePath: '/courses/structures/syllabus' }],
    expectedTopics: [{ id: 'trees', examId: 'midterm', courseId: 'structures', title: 'Trees', chapter: 1, weight: 100 }],
    expectedSyllabi: [{ courseId: 'structures', filePath: '/files/structures-syllabus' }],
  } };
  const observed = () => ({ exams: [{ ...inspection.truth.expectedExams[0], sourceUrl: origins.school + '/courses/structures/syllabus' }], topics: structuredClone(inspection.truth.expectedTopics) });
  assert.equal(gradeLearn(inspection, observed(), origins).passed, true);
  const fileSource = observed(); fileSource.exams[0].sourceUrl = origins.school + '/files/structures-syllabus';
  assert.equal(gradeLearn(inspection, fileSource, origins).passed, true);
  for (const mutate of [
    item => { item.topics[0].weight = 90; },
    item => { item.topics.push({ ...item.topics[0], id: 'invented' }); },
    item => { item.exams.push({ ...item.exams[0] }); },
    item => { item.exams[0].sourceUrl = 'https://foreign.example/courses/structures/syllabus'; },
    item => { item.exams[0].sourceUrl = 'http://user@127.0.0.1:32100/courses/structures/syllabus'; },
    item => { item.exams[0].date = '2026-09-22T17:00:00.000Z'; },
  ]) {
    const observation = observed(); mutate(observation);
    assert.equal(gradeLearn(inspection, observation, origins).passed, false);
  }
  const empty = { truth: { expectedExams: [], expectedTopics: [], expectedSyllabi: [] } };
  assert.equal(gradeLearn(empty, undefined, origins).passed, false);
  assert.equal(gradeLearn(empty, { exams: [], topics: [] }, origins).passed, true);
});

test('recovery requires actual page re-read, saved student text and observed fault events', () => {
  const before = { state: { submissions: [], drafts: {} }, effects: [] };
  const after = { state: { submissions: [], drafts: { observation: { answer: 'Student edit.' } } }, effects: [
    { sequence: 1, type: 'school_advanced', detail: { event: 'student-edit', activityId: 'observation' } },
    { sequence: 2, type: 'page_viewed', detail: { path: '/assignments/observation' } },
    { sequence: 3, type: 'draft_saved', activityId: 'observation', detail: {} },
  ] };
  const expected = { activityId: 'observation', newSubmissions: 0, savedAnswer: 'Student edit.', events: ['student-edit'] };
  assert.equal(gradeRecovery(before, after, expected).passed, true);
  for (const mutate of [
    item => { item.effects.splice(1, 1); },
    item => { item.state.drafts.observation.answer = 'Agent overwrite.'; },
    item => { item.effects[0].detail.event = 'other'; },
    item => { item.effects.push({ sequence: 4, type: 'draft_saved', activityId: 'other', detail: {} }); },
    item => { item.effects.push({ sequence: 4, type: 'submission_committed', activityId: 'observation', detail: {} }); },
  ]) {
    const changed = structuredClone(after); mutate(changed);
    assert.equal(gradeRecovery(before, changed, expected).passed, false);
  }
  assert.throws(() => gradeRecovery(before, after, {}), /expectation/);
});

test('homework cannot count as student mastery or new tutoring evidence', () => {
  const before = [{ topicId: 'trees', level: 1, evidence: ['typed-response-1'] }];
  assert.equal(gradeHomeworkDoesNotTeach(before, structuredClone(before)).passed, true);
  assert.equal(gradeHomeworkDoesNotTeach(before, [{ ...before[0], level: 2 }]).passed, false);
  assert.equal(gradeHomeworkDoesNotTeach(before, [{ ...before[0], evidence: ['homework-submitted'] }]).passed, false);
  assert.throws(() => gradeHomeworkDoesNotTeach([], []), /snapshots/);
});

function observation() {
  return { evidenceClass: 'controlled', config: { model: null, provider: null, effort: null, budgetMs: 1000, maxToolCalls: 10 },
    policyViolations: [], attempts: [{ status: 'completed', metrics: { durationMs: 25, modelCalls: 1, toolCalls: 2,
      usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 } } }] };
}

test('metrics retain failures, unknown tokens and unknown cost without inference', () => {
  const attempts = observation().attempts;
  attempts.unshift({ status: 'timed_out', metrics: { durationMs: 50, toolCalls: 3, modelCalls: 1 } });
  const metrics = measuredUsage(attempts);
  assert.equal(metrics.durationMs, 75);
  assert.equal(metrics.toolCalls, 5);
  assert.equal(metrics.costUsd, null);
  assert.deepEqual(Object.values(metrics.usage), [null, null, null, null]);
  for (const invalid of [-1, NaN, Infinity, '1', 0.5]) {
    const items = observation().attempts; items[0].metrics.toolCalls = invalid;
    assert.equal(measuredUsage(items).toolCalls, null);
  }
  assert.equal(measuredUsage([]).durationMs, null);
  const item = observation().attempts; item[0].metrics.costUsd = 0;
  assert.equal(measuredUsage(item).costUsd, 0);
});

test('benchmark grades school evidence independently and keeps expected result out of observation', () => {
  const expected = { kind: 'homework', activityId: 'structures-quiz' };
  const observed = observation(), original = structuredClone(observed);
  const receipt = evaluateBenchmark({ inspection: quiz(), observation: observed, expected });
  assert.equal(receipt.evaluation.passed, true);
  assert.deepEqual(receipt.observation, original);
  assert.deepEqual(observed, original);
  assert.equal('expected' in receipt.observation, false);
  assert.equal(receipt.metrics.costUsd, null);
  for (const mutate of [
    item => { item.attempts[0].status = 'timed_out'; },
    item => { item.policyViolations.push('out-of-school action'); },
    item => { item.config.maxToolCalls = 1; },
    item => { item.config.budgetMs = 1; },
    item => { item.evidenceClass = 'live-production-runtime'; },
    item => { item.attempts = []; },
  ]) {
    const changed = observation(); mutate(changed); changed.passed = true;
    assert.equal(evaluateBenchmark({ inspection: quiz(), observation: changed, expected }).evaluation.passed, false);
  }
  const inspection = quiz(); inspection.state.submissions[0].answer = 'I am correct.';
  assert.equal(evaluateBenchmark({ inspection, observation: { ...observed, passed: true }, expected }).evaluation.passed, false);
});
