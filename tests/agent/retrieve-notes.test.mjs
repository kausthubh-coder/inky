import assert from "node:assert/strict";
import test from "node:test";

import { retrieveNoteIndex } from "../../dist/agent-system/retrieve.js";

const base = { schemaVersion: 1, markdownPath: "x.md", contentHash: "a".repeat(64), revision: 1, updatedAt: "2026-09-03T12:00:00.000Z" };
const note = (noteId, scope, subjectId, about, key) => ({ ...base, noteId, scope, subjectId, about, key, title: key });

test("assignment retrieval is deterministic and does not leak unrelated courses or unconfirmed patterns", () => {
  const entries = [
    note("note-z", "course", "csc-999", "work", "foreign"),
    note("note-c", "course", "csc-316", "work", "current-project"),
    note("note-p", "pattern", "webassign-weekly", "how-to", "execution"),
    note("note-u", "pattern", "unconfirmed", "how-to", "execution"),
    note("note-a", "assignment", "assignment-2", "work", "leftover"),
    note("note-self", "assignment", "assignment-3", "work", "current"),
    note("note-pref", "student", "primary", "preference", "writing-style"),
  ];
  const context = { kind: "assignment", assignmentId: "assignment-3", courseId: "csc-316", confirmedPatternIds: ["webassign-weekly"], courseAssignmentIds: ["assignment-2", "assignment-3"] };
  assert.deepEqual(retrieveNoteIndex(entries, context, "automatic").map((entry) => entry.noteId), ["note-pref", "note-c", "note-p", "note-self"]);
  assert.deepEqual(retrieveNoteIndex(entries, context, "search").map((entry) => entry.noteId), ["note-pref", "note-c", "note-p", "note-a", "note-self"]);
});

test("scan retrieval accepts only evidence-independent scan hints for its school", () => {
  const entries = [
    note("right", "school", "primary-school", "scan", "navigation"),
    note("wrong-school", "school", "other", "scan", "navigation"),
    note("wrong-about", "school", "primary-school", "knowledge", "deadlines"),
  ];
  assert.deepEqual(retrieveNoteIndex(entries, { kind: "scan", schoolId: "primary-school" }).map((entry) => entry.noteId), ["right"]);
});
