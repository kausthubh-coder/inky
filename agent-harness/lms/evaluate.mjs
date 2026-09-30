// Operator-only. Feed persisted records, never an agent's success narrative.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = values => [...values].sort();
function report(checks) {
  return { passed: checks.length > 0 && checks.every(item => item.passed), checks };
}
function checker(checks) {
  return (name, expected, observed) => checks.push({ name, passed: same(expected, observed), expected, observed: observed ?? null });
}
function canonicalPath(source, origin) {
  try {
    const url = new URL(source);
    return url.origin === new URL(origin).origin && !url.username && !url.password ? decodeURIComponent(url.pathname) : null;
  } catch { return null; }
}

// Normalized adapter contract: exams [{id,courseId,title,date,sourceUrl}],
// topics [{id,examId,courseId,title,chapter,weight}]. IDs here are fixture IDs;
// production-local IDs must be mapped by source identity in the operator adapter.
export function gradeLearn(inspection, observation, origins) {
  const { expectedExams, expectedTopics } = inspection.truth;
  if (!Array.isArray(expectedExams) || !Array.isArray(expectedTopics)) throw new Error('Learn truth is required');
  const checks = [], check = checker(checks);
  check('persisted Learn inventories provided', true, Array.isArray(observation?.exams) && Array.isArray(observation?.topics));
  const exams = observation?.exams ?? [], topics = observation?.topics ?? [];
  check('exam inventory', sorted(expectedExams.map(item => item.id)), sorted(exams.map(item => item.id)));
  check('topic inventory', sorted(expectedTopics.map(item => item.id)), sorted(topics.map(item => item.id)));
  for (const expected of expectedExams) {
    const actual = exams.find(item => item.id === expected.id);
    for (const field of ['courseId', 'title', 'date']) check(`${expected.id}: ${field}`, expected[field], actual?.[field]);
    const filePath = inspection.truth.expectedSyllabi.find(item => item.courseId === expected.courseId)?.filePath;
    check(`${expected.id}: syllabus provenance`, true, [expected.sourcePath, filePath].filter(Boolean).includes(canonicalPath(actual?.sourceUrl, origins.school)));
  }
  for (const expected of expectedTopics) {
    const actual = topics.find(item => item.id === expected.id);
    for (const field of ['examId', 'courseId', 'title', 'chapter', 'weight']) check(`${expected.id}: ${field}`, expected[field], actual?.[field]);
  }
  return report(checks);
}

// Complements the existing scan grader; it does not replace its coverage/status checks.
export function gradeRedesignDiscovery(inspection, assignments, origins) {
  const checks = [], check = checker(checks);
  for (const id of inspection.truth.expectedAssignmentIds) {
    const activity = inspection.state.activities.find(item => item.id === id);
    const found = assignments.filter(item => canonicalPath(item.sourceTarget, origins[activity.service]) === `/assignments/${id}`);
    check(`${id}: source occurs once`, 1, found.length);
    check(`${id}: kind`, inspection.truth.expectedKinds[id], found[0]?.kind);
    if (inspection.truth.expectedUndatedIds.includes(id)) check(`${id}: no invented deadline`, null, found[0]?.dueAt ?? null);
    for (const line of [...(activity.rubric ?? []), ...(activity.latePenalty ? [activity.latePenalty] : [])]) {
      const evidence = [found[0]?.instructions, ...(found[0]?.requirementEvidence ?? []).map(item => item.text)].join('\n').replace(/\s+/g, ' ').toLowerCase();
      check(`${id}: retained source requirement: ${line}`, true, evidence.includes(line.replace(/\s+/g, ' ').toLowerCase()));
    }
  }
  return report(checks);
}

// Author the expectation BEFORE invoking the driver. Zero submissions is a real
// expectation for review-only work; absence of an expectation cannot pass.
export function gradeRecovery(before, after, expectation) {
  if (!expectation?.activityId || !Number.isSafeInteger(expectation.newSubmissions) || expectation.newSubmissions < 0
    || typeof expectation.savedAnswer !== 'string' || !Array.isArray(expectation.events)) throw new Error('Explicit recovery expectation required');
  const id = expectation.activityId, checks = [], check = checker(checks);
  const lastSequence = before.effects.at(-1)?.sequence ?? 0;
  const effects = after.effects.filter(item => item.sequence > lastSequence);
  const oldIds = new Set(before.state.submissions.map(item => item.id));
  const receipts = after.state.submissions.filter(item => !oldIds.has(item.id));
  check('earlier effect history retained', before.effects, after.effects.filter(item => item.sequence <= lastSequence));
  check('earlier receipts retained', before.state.submissions, after.state.submissions.filter(item => oldIds.has(item.id)));
  check('no writes to other assignments', [], effects.filter(item => item.activityId && item.activityId !== id && ['draft_saved', 'submission_committed', 'lesson_completed'].includes(item.type)).map(item => item.activityId));
  check('new submission count', expectation.newSubmissions, receipts.length);
  check('commit effects match new receipts', receipts.length, effects.filter(item => item.type === 'submission_committed').length);
  check('all receipts belong to target', true, receipts.every(item => item.activityId === id));
  check('receipt IDs are unique', after.state.submissions.length, new Set(after.state.submissions.map(item => item.id)).size);
  check('saved answer matches expected page', expectation.savedAnswer, after.state.drafts[id]?.answer);
  for (const event of expectation.events) check(`observed ${event}`, true, effects.some(item => item.detail?.event === event || item.detail?.fault === event));
  if (expectation.timeouts !== undefined) check('submission timeout count', expectation.timeouts, effects.filter(item => item.activityId === id && item.detail?.fault === 'double-timeout').length);
  for (const receipt of receipts) {
    check(`${receipt.id}: committed exactly once`, 1, effects.filter(item => item.type === 'submission_committed' && item.activityId === id && item.detail?.key === receipt.idempotencyKey).length);
    check(`${receipt.id}: submitted answer`, expectation.savedAnswer, receipt.answer);
    if (expectation.notBefore) check(`${receipt.id}: review window elapsed`, true, Date.parse(receipt.submittedAt) >= Date.parse(expectation.notBefore));
  }
  for (const [name, hash] of Object.entries(expectation.studentFileHashes ?? {})) {
    const files = after.state.drafts[id]?.files.filter(file => file.name === name) ?? [];
    check(`${name}: original student file`, [hash], files.map(file => file.hash));
  }
  const edit = effects.filter(item => item.detail?.event === 'student-edit' && (item.detail.activityId ?? 'observation') === id).at(-1);
  if (edit) {
    const write = effects.find(item => item.sequence > edit.sequence && item.activityId === id && ['draft_saved', 'submission_committed'].includes(item.type));
    if (write) check('page re-read after student edit before next write', true, effects.some(item => item.sequence > edit.sequence && item.sequence < write.sequence && item.type === 'page_viewed' && item.detail.path === `/assignments/${id}`));
  }
  return report(checks);
}

export function gradeHomeworkDoesNotTeach(beforeLevels, afterLevels) {
  if (!Array.isArray(beforeLevels) || !beforeLevels.length || !Array.isArray(afterLevels)) throw new Error('Persisted topic-level snapshots required');
  const normalize = levels => levels.map(item => ({ topicId: item.topicId, level: item.level, evidence: item.evidence })).sort((a, b) => a.topicId.localeCompare(b.topicId));
  const checks = [], check = checker(checks);
  check('homework did not change mastery or evidence', normalize(beforeLevels), normalize(afterLevels));
  return report(checks);
}
