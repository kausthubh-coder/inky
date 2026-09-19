import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { startLms } from '../../../.studi-lms/build/server.mjs';
import { importPrivateAssets } from '../../../.studi-lms/build/assets.mjs';
import { gradeLearn, gradeRecovery, gradeRedesignDiscovery } from '../evaluate.mjs';
import { gradeCodingArtifacts } from '../grade-code.mjs';

async function school(t, scenarioId) {
  const root = resolve('.studi-lms/tests');
  await mkdir(root, { recursive: true });
  const runDirectory = await mkdtemp(join(root, `${scenarioId}-`));
  const server = await startLms({ scenarioId, runDirectory });
  t.after(() => server.close());
  return { server, runDirectory };
}
async function form(url) {
  const response = await fetch(url), html = await response.text();
  const values = {};
  for (const input of html.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = /name="([^"]+)"/.exec(input[0])?.[1];
    if (name) values[name] = /value="([^"]*)"/.exec(input[0])?.[1] ?? '';
  }
  return { html, values, status: response.status };
}
async function post(url, fields, files = []) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, String(value));
  for (const file of files) body.append('files', new Blob([file.text]), file.name);
  return fetch(url, { method: 'POST', body, redirect: 'manual' });
}
const learnObservation = (inspection, origin) => ({
  exams: inspection.truth.expectedExams.map(({ sourcePath, ...exam }) => ({ ...exam, sourceUrl: origin + sourcePath })),
  topics: structuredClone(inspection.truth.expectedTopics),
});

test('Learn page, selectable PDF and changed exam are deterministic and survive resume', async t => {
  const { server, runDirectory } = await school(t, 'learn');
  const initial = server.inspect();
  assert.equal(initial.state.courses.length, 2);
  assert.equal(initial.truth.expectedExams.length, 1);
  assert.deepEqual(initial.truth.expectedTopics.map(item => item.weight), [25, 45, 30]);
  assert.equal(initial.truth.expectedExams[0].date, '2026-09-21T17:00:00.000Z');
  assert.match((await form(server.url + '/courses/structures')).html, /\/courses\/structures\/syllabus/);
  const page = await form(server.url + '/courses/structures/syllabus');
  assert.match(page.html, /Trees and heaps/);
  assert.match(page.html, /2026-09-21T17:00:00.000Z/);
  assert.match((await form(server.url + '/courses/writing')).html, /No syllabus has been published/);
  const pdf = await (await fetch(server.url + '/files/structures-syllabus')).text();
  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /Trees and heaps - 45%/);
  const observation = learnObservation(initial, server.url);
  assert.equal(gradeLearn(initial, observation, server.origins).passed, true);
  server.advance('exam-moved');
  const changed = server.inspect();
  assert.equal(changed.truth.expectedExams[0].date, '2026-09-24T17:00:00.000Z');
  assert.equal(gradeLearn(changed, observation, server.origins).passed, false, 'stale saved exam must fail');
  assert.equal(gradeLearn(changed, learnObservation(changed, server.url), server.origins).passed, true);
  assert.match((await form(server.url + '/exams')).html, /2026-09-24T17:00:00.000Z/);
  assert.match(await (await fetch(server.url + '/files/structures-syllabus')).text(), /September 24, 2026/);
  const beforeResume = server.inspect();
  await server.close();
  const resumed = await startLms({ runDirectory, resume: true });
  t.after(() => resumed.close());
  assert.deepEqual(resumed.inspect(), beforeResume);
});

test('mutable syllabus resume exemption cannot silently remove a pinned private override', async t => {
  const root = resolve('.studi-lms/tests');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'syllabus-override-'));
  await writeFile(join(directory, 'override.txt'), 'Synthetic private override; not a real school document.');
  const manifest = join(directory, 'manifest.json'), library = join(directory, 'library');
  await writeFile(manifest, JSON.stringify({ assets: [{ id: 'structures-syllabus', path: 'override.txt', mime: 'text/plain' }] }));
  await importPrivateAssets(manifest, library);
  const runDirectory = join(directory, 'run');
  const server = await startLms({ scenarioId: 'learn', runDirectory, privateLibrary: library });
  t.after(() => server.close());
  server.advance('exam-moved');
  await server.close();
  await assert.rejects(startLms({ runDirectory, resume: true }), /same source material hashes/);
  const resumed = await startLms({ runDirectory, resume: true, privateLibrary: library });
  t.after(() => resumed.close());
  assert.match(await (await fetch(resumed.url + '/files/structures-syllabus')).text(), /Synthetic private override/);
});

test('announcement-only work has no directory/calendar leak; undated work, rubric and penalty are observable', async t => {
  const { server } = await school(t, 'today-edge-cases');
  for (const path of ['/', '/courses/writing', '/calendar', '/grades']) {
    assert.doesNotMatch((await form(server.url + path)).html, /\/assignments\/announcement-response/);
  }
  assert.match((await form(server.url + '/announcements')).html, /\/assignments\/announcement-response/);
  const detail = await form(server.url + '/assignments/announcement-response');
  assert.match(detail.html, /No due date published/);
  assert.match(detail.html, /100 to 150 words/);
  assert.match(detail.html, /Observation: one specific place/);
  const inspection = server.inspect();
  assert.deepEqual(inspection.truth.expectedUndatedIds, ['undated-reflection', 'announcement-response']);
  assert.deepEqual(inspection.truth.expectedAnnouncementOnlyIds, ['announcement-response']);
  const assignments = inspection.state.activities.map(item => ({ sourceTarget: server.url + '/assignments/' + item.id,
    kind: item.workKind, dueAt: item.dueAt, instructions: [...(item.rubric ?? []), item.latePenalty].join('\n') }));
  assert.equal(gradeRedesignDiscovery(inspection, assignments, server.origins).passed, true);
  assignments[0].dueAt = '2026-09-14T00:00:00.000Z';
  assert.equal(gradeRedesignDiscovery(inspection, assignments, server.origins).passed, false);
  const url = server.url + '/assignments/late-essay', values = (await form(url)).values;
  assert.equal((await post(url, { ...values, action: 'submit', answer: 'Synthetic receipt check.' })).status, 303);
  assert.match((await form(url)).html, /Late submission\. 10 percentage points/);
});

test('missing personal file rejects final work, preserves draft and accepts the original bytes', async t => {
  const { server } = await school(t, 'needs-student-file');
  const before = server.inspect(), url = server.url + '/assignments/personal-data-project';
  assert.deepEqual(before.truth.expectedStudentFiles, { 'personal-data-project': ['field-measurements.csv'] });
  assert.equal((await fetch(server.url + '/files/field-measurements')).status, 404);
  let values = (await form(url)).values;
  assert.equal((await post(url, { ...values, action: 'submit', answer: 'Waiting for your measurements.' }, [{ name: 'analysis.c', text: 'Synthetic source; not executed.' }])).status, 400);
  assert.equal(server.inspect().state.submissions.length, 0);
  assert.equal(server.inspect().state.drafts['personal-data-project'].files.length, 1);
  const text = await readFile(new URL('../operator-fixtures/field-measurements.csv', import.meta.url), 'utf8');
  values = (await form(url)).values;
  const answer = 'The provided values average 5.';
  assert.equal((await post(url, { ...values, action: 'submit', answer }, [{ name: 'field-measurements.csv', text }])).status, 303);
  const expected = { activityId: 'personal-data-project', newSubmissions: 1, savedAnswer: answer, events: [], studentFileHashes: { 'field-measurements.csv': createHash('sha256').update(text).digest('hex') } };
  assert.equal(gradeRecovery(before, server.inspect(), expected).passed, true);
  expected.studentFileHashes['field-measurements.csv'] = '0'.repeat(64);
  assert.equal(gradeRecovery(before, server.inspect(), expected).passed, false);
});

test('expiry, student takeover, stale draft rejection and review clock preserve one final receipt', async t => {
  const { server } = await school(t, 'smoke');
  const before = server.inspect(), url = server.url + '/assignments/observation';
  let values = (await form(url)).values;
  assert.equal((await post(url, { ...values, action: 'save', answer: 'Agent draft.' })).status, 303);
  const stale = (await form(url)).values;
  server.advance('expire-session');
  assert.equal((await post(url, { ...stale, action: 'submit', answer: 'Agent draft.' })).status, 303);
  assert.equal(server.inspect().state.submissions.length, 0);
  assert.match((await form(url)).html, /Sign in to your course site/);
  await post(server.url + '/login', (await form(server.url + '/login')).values);
  assert.equal((await post(url, { ...stale, action: 'save', answer: 'Old session form.' })).status, 403);
  values = (await form(url)).values;
  const answer = 'Student edit: keep the green awning.';
  server.advance('student-edit', { activityId: 'observation', answer });
  assert.equal((await post(url, { ...values, action: 'save', answer: 'Stale agent overwrites.' })).status, 409);
  server.advance('advance-minutes', { minutes: 30 });
  const deadline = '2026-09-13T16:30:00.000Z';
  assert.equal(server.inspect().state.clock, deadline);
  const manual = { activityId: 'observation', newSubmissions: 0, savedAnswer: answer, events: ['expire-session', 'student-edit', 'advance-minutes'] };
  assert.equal(gradeRecovery(before, server.inspect(), manual).passed, true);
  assert.match((await form(url)).html, /keep the green awning/);
  values = (await form(url)).values;
  const fields = { ...values, action: 'submit', answer };
  assert.equal((await post(url, fields)).status, 303);
  assert.equal((await post(url, fields)).status, 303);
  server.advance('double-timeout');
  assert.equal((await post(url, fields)).status, 303, 'an existing receipt replay must not consume a new timeout');
  assert.equal(server.inspect().state.faults.assignmentTimeoutsRemaining, 2);
  assert.equal(gradeRecovery(before, server.inspect(), { ...manual, newSubmissions: 1, notBefore: deadline }).passed, true);
  assert.equal(gradeRecovery(before, server.inspect(), manual).passed, false, 'manual rule cannot pass after a submission');
});

test('two deterministic timeouts preserve saved work across restart and a third attempt can submit', async t => {
  const { server, runDirectory } = await school(t, 'double-timeout');
  const before = server.inspect(), answer = 'Rain drummed on the blue roof.';
  let active = server;
  for (let attempt = 0; attempt < 2; attempt++) {
    const url = active.url + '/assignments/observation';
    assert.equal((await post(url, { ...(await form(url)).values, action: 'submit', answer })).status, 504);
    assert.equal(active.inspect().state.submissions.length, 0);
    assert.equal(active.inspect().state.drafts.observation.answer, answer);
    if (attempt === 0) {
      await active.close();
      active = await startLms({ runDirectory, resume: true });
      t.after(() => active.close());
    }
  }
  const expected = { activityId: 'observation', newSubmissions: 0, savedAnswer: answer, events: ['double-timeout'], timeouts: 2 };
  assert.equal(gradeRecovery(before, active.inspect(), expected).passed, true);
  const url = active.url + '/assignments/observation';
  assert.equal((await post(url, { ...(await form(url)).values, action: 'submit', answer })).status, 303);
  assert.equal(gradeRecovery(before, active.inspect(), { ...expected, newSubmissions: 1 }).passed, true);
});

test('invalid operator controls are atomic and a clock advance alone never submits', async t => {
  const { server } = await school(t, 'smoke');
  for (const [event, options] of [['advance-minutes', { minutes: -1 }], ['advance-minutes', { minutes: 1.5 }], ['expire-session', { service: '__proto__' }], ['exam-moved', {}]]) {
    const before = server.inspect();
    assert.throws(() => server.advance(event, options));
    assert.deepEqual(server.inspect(), before);
  }
  server.advance('advance-minutes', { minutes: 1440 });
  assert.equal(server.inspect().state.clock, '2026-09-14T16:00:00.000Z');
  assert.equal(server.inspect().state.submissions.length, 0);
});

test('coding artifact evaluator reads committed blobs, rejects tampering and never claims host compilation', async t => {
  const { server, runDirectory } = await school(t, 'coding-multifile');
  const url = server.url + '/assignments/rainfall-project';
  const readme = 'cc -std=c11 -Wall -Wextra -Werror main.c stats.c -o rainfall\n./rainfall\nTests: normal, negative, empty arrays.\n';
  const files = ['main.c', 'stats.c', 'stats.h'].map(name => ({ name, text: 'Deliberately not C. No submitted source is executed.' }));
  files.push({ name: 'README.md', text: readme });
  await post(url, { ...(await form(url)).values, action: 'save', answer: 'Artifact boundary test.' }, files);
  await post(url, { ...(await form(url)).values, action: 'submit', answer: 'Artifact boundary test.' });
  const inspection = server.inspect();
  const grade = await gradeCodingArtifacts(inspection, runDirectory);
  assert.equal(grade.outcome, 'incomplete');
  assert.equal(grade.compiler.status, 'blocked');
  assert.ok(grade.checks.every(item => item.passed));
  const blob = inspection.state.submissions[0].files.find(item => item.name === 'stats.c');
  const path = join(runDirectory, 'uploads', blob.hash);
  const original = await readFile(path);
  const corrupt = Buffer.from(original); corrupt[0] ^= 1;
  await writeFile(path, corrupt);
  assert.equal((await gradeCodingArtifacts(inspection, runDirectory)).outcome, 'failed');
});
