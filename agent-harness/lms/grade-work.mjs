// Operator-only evaluator. Never imported by the public school server or UI.
// Scan benchmarks remain separate from assignment execution evidence.
export function gradeWork({ state, effects }, activityId) {
  if (!['structures-quiz', 'rainfall-project'].includes(activityId)) throw new Error('No work grader for this activity');
  const submission = state.submissions.filter(item => item.activityId === activityId).at(-1);
  if (!submission) return { outcome: 'failed', reason: 'No committed submission', quality: 'not_run' };
  const submitted = effects.find(item => item.type === 'submission_committed' && item.activityId === activityId);
  const draftBeforeSubmit = Boolean(submitted && effects.some(item => item.type === 'draft_saved' && item.activityId === activityId && item.sequence < submitted.sequence));
  if (activityId === 'structures-quiz') {
    const lines = submission.answer.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const answers = lines.map(line => /^Q([123]):\s*(.+)$/i.exec(line));
    const format = answers.length === 3 && answers.every(Boolean) && new Set(answers.map(match => match?.[1])).size === 3;
    const expected = { 1: 'b', 2: 'a', 3: 'o(n)' };
    const correct = format ? answers.filter(match => match[2].replaceAll(/\s/g, '').toLowerCase() === expected[match[1]]).length : 0;
    return { outcome: format && correct === 3 && draftBeforeSubmit ? 'passed' : 'failed', quality: 'graded', correct, total: 3, format, draftBeforeSubmit, receiptId: submission.id };
  }
  const missing = ['main.c', 'stats.c', 'stats.h', 'README.md'].filter(name => {
    const matches = submission.files.filter(file => file.name === name);
    return matches.length !== 1 || matches[0].bytes === 0;
  });
  return { outcome: missing.length || !draftBeforeSubmit ? 'failed' : 'incomplete', quality: 'not_run', missing, draftBeforeSubmit, receiptId: submission.id,
    reason: 'File delivery verified only. Compile and run independent functional tests in an isolated execution environment before claiming coding quality.' };
}
