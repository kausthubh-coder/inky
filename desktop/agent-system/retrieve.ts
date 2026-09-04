import type { NoteIndexEntry } from "../shared/index.js";

export type NoteRetrievalContext =
  | Readonly<{ kind: "home"; studentId?: string }>
  | Readonly<{
      kind: "assignment";
      studentId?: string;
      assignmentId: string;
      courseId: string;
      confirmedPatternIds: readonly string[];
      courseAssignmentIds?: readonly string[];
    }>
  | Readonly<{ kind: "scan"; schoolId: string }>;

export function retrieveNoteIndex(
  entries: readonly NoteIndexEntry[],
  context: NoteRetrievalContext,
  mode: "automatic" | "search" = "automatic",
  limit = 32,
): NoteIndexEntry[] {
  const allowed = entries.filter((entry) => noteIsAllowed(entry, context, mode));
  return [...allowed].sort(compareNotes).slice(0, Math.max(0, Math.min(limit, 64)));
}

export function noteIsAllowed(
  note: NoteIndexEntry,
  context: NoteRetrievalContext,
  mode: "automatic" | "search" = "automatic",
): boolean {
  if (context.kind === "home") {
    if (mode === "search") return true;
    return note.scope === "student" && note.subjectId === (context.studentId ?? "primary") && note.about === "preference";
  }
  if (context.kind === "scan") {
    return note.scope === "school" && note.subjectId === context.schoolId && note.about === "scan";
  }
  if (note.scope === "student") {
    return note.subjectId === (context.studentId ?? "primary") && note.about === "preference";
  }
  if (note.scope === "course") return note.subjectId === context.courseId;
  if (note.scope === "pattern") return context.confirmedPatternIds.includes(note.subjectId);
  if (note.scope !== "assignment") return false;
  if (note.subjectId === context.assignmentId) return true;
  return mode === "search" && (context.courseAssignmentIds ?? []).includes(note.subjectId);
}

function compareNotes(left: NoteIndexEntry, right: NoteIndexEntry): number {
  const scopeOrder = ["student", "school", "course", "pattern", "assignment"];
  return scopeOrder.indexOf(left.scope) - scopeOrder.indexOf(right.scope)
    || left.subjectId.localeCompare(right.subjectId)
    || left.about.localeCompare(right.about)
    || left.key.localeCompare(right.key)
    || left.updatedAt.localeCompare(right.updatedAt)
    || left.noteId.localeCompare(right.noteId);
}
