import type { NoteIndexEntry } from "../shared/index.js";

export type NoteRetrievalContext =
  | Readonly<{ kind: "home"; studentId?: string }>
  | Readonly<{
      kind: "assignment";
      studentId?: string;
      /** How this school works, written while scanning; homework needs it too. */
      schoolId?: string;
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
    return !!context.studentId && note.scope === "student" && note.subjectId === context.studentId && note.about === "preference";
  }
  if (context.kind === "scan") {
    return note.scope === "school" && note.subjectId === context.schoolId && note.about === "scan";
  }
  if (note.scope === "student") {
    return note.subjectId === (context.studentId ?? "primary") && note.about === "preference";
  }
  if (note.scope === "school") return !!context.schoolId && note.subjectId === context.schoolId;
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

export type NoteMatch = { noteId: string; scope: string; subjectId: string; about: string; title: string; preview: string };

/** Notes this context may see, ranked by how many query words their title, key and text contain. */
export async function searchNotes(
  notes: { list(): readonly NoteIndexEntry[]; read(noteId: string): Promise<{ content: string } | null> },
  context: NoteRetrievalContext,
  query: string,
): Promise<NoteMatch[]> {
  const terms = query.trim().toLocaleLowerCase().split(/[^\p{L}\p{N}._-]+/u).filter((term) => term.length > 1);
  const matches: Array<NoteMatch & { score: number }> = [];
  for (const entry of retrieveNoteIndex(notes.list(), context, "search", 64)) {
    const document = await notes.read(entry.noteId);
    if (!document) continue;
    const haystack = `${entry.title}\n${entry.key}\n${document.content}`.toLocaleLowerCase();
    const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
    if (score) matches.push({ noteId: entry.noteId, scope: entry.scope, subjectId: entry.subjectId, about: entry.about, title: entry.title, preview: document.content.slice(0, 500), score });
  }
  return matches
    .sort((left, right) => right.score - left.score || left.noteId.localeCompare(right.noteId))
    .slice(0, 25)
    .map(({ score: _score, ...match }) => match);
}
