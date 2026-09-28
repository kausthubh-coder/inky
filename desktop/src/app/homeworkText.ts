import type { Assignment } from "../../shared/index.js";

export function assignmentDue(assignment: Pick<Assignment, "dueAt">): number | null {
  // School date text can omit the year or time; parsing it invents a deadline.
  const value = Date.parse(assignment.dueAt ?? "");
  return Number.isFinite(value) ? value : null;
}

/** "CSC 316 Data Structures" → "CSC 316". Schools don't give a short code, so it comes from the label. */
export function shortCourse(label: string): string {
  const code = /^([A-Z]{2,5})\s*-?\s*(\d{2,4}[A-Z]?)\b/.exec(label.trim());
  if (code) return `${code[1]} ${code[2]}`;
  const words = label.trim().split(/\s+/).slice(0, 2).join(" ");
  return words.length > 16 ? `${words.slice(0, 15)}…` : words;
}
