// What a school page says once work is handed in. Dot reads this itself after the student presses Submit.
const CONFIRMED = /\b(submitted for grading|submission received|successfully submitted|has been submitted|was submitted|submitted,? not yet graded|attempt submitted|turned in|finished attempt)\b/i;

/** The confirmation words on the page after hand-in, or null. Words already on the page before don't count. */
export function readSubmissionConfirmation(before: string, after: string): string | null {
  const match = CONFIRMED.exec(after);
  if (!match) return null;
  const lead = after.slice(Math.max(0, match.index - 8), match.index).toLowerCase();
  if (/\b(not|no|un)\s*\(?$/.test(lead)) return null;
  if (before.toLowerCase().includes(match[0].toLowerCase())) return null;
  return match[0];
}
