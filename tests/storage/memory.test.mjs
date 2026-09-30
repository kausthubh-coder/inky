import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { openLocalStore } from "../../dist/electron/storage/index.js";
import { MemoryCoordinator } from "../../dist/electron/agent/memory-coordinator.js";

test("memory lists only the account's preferences, uses revision checks, and forget survives restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-memory-"));
  let store = await openLocalStore(root);
  try {
    const own = await store.notes.upsert({ scope: "student", subjectId: "student-a", about: "preference", key: "writing", title: "My style", content: "Use short sentences." });
    const other = await store.notes.upsert({ scope: "student", subjectId: "student-b", about: "preference", key: "writing", title: "Other style", content: "Use long sentences." });
    await store.notes.upsert({ scope: "student", subjectId: "primary", about: "preference", key: "legacy", title: "Legacy", content: "Unattributed memory" });
    const memory = new MemoryCoordinator(store.notes, "student-a");
    assert.deepEqual(memory.list().map(note => note.noteId), [own.frontmatter.noteId]);
    assert.equal("markdownPath" in memory.list()[0], false);
    await assert.rejects(memory.read(other.frontmatter.noteId), /not available/);
    await assert.rejects(memory.delete({ noteId: other.frontmatter.noteId, expectedRevision: 1 }), /not available/);
    const updated = await memory.update({ noteId: own.frontmatter.noteId, expectedRevision: 1, title: "Style", content: "Use concrete examples." });
    assert.equal(updated.frontmatter.revision, 2);
    await assert.rejects(memory.update({ noteId: own.frontmatter.noteId, expectedRevision: 1, title: "Old", content: "Stale edit" }), /changed/);
    await assert.rejects(memory.delete({ noteId: own.frontmatter.noteId, expectedRevision: 1 }), /changed/);
    await memory.delete({ noteId: own.frontmatter.noteId, expectedRevision: 2 });
    store.close(); store = await openLocalStore(root);
    assert.equal(store.notes.list().some(note => note.noteId === own.frontmatter.noteId), false);
    assert.equal((await store.notes.read(other.frontmatter.noteId)).content, "Use long sentences.");
    assert.equal(store.notes.validateAll(), 2);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test("concurrent edits serialize revision checks and disposed memory cannot publish queued effects", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-memory-race-")), store = await openLocalStore(root);
  try {
    const note = await store.notes.upsert({ scope: "student", subjectId: "student-a", about: "preference", key: "style", title: "Style", content: "Original" });
    const memory = new MemoryCoordinator(store.notes, "student-a");
    const results = await Promise.allSettled(["First", "Second"].map(content => memory.update({ noteId: note.frontmatter.noteId, expectedRevision: 1, title: "Style", content })));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected").length, 1);
    await memory.dispose();
    await assert.rejects(memory.update({ noteId: note.frontmatter.noteId, expectedRevision: 2, title: "Style", content: "Late" }), /disposed/);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test("a crash after forgetting Markdown cannot resurrect the stale index on restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-memory-delete-"));
  let store = await openLocalStore(root, { failureInjector(point) { if (point === "note_after_unlink_before_index") throw new Error("injected delete crash"); } });
  try {
    const note = await store.notes.upsert({ scope: "student", subjectId: "student-a", about: "preference", key: "style", title: "Style", content: "Forget me" });
    await assert.rejects(store.notes.delete(note.frontmatter.noteId, 1), /injected delete crash/);
    store.close(); store = await openLocalStore(root);
    assert.deepEqual(store.notes.list(), []);
    assert.equal(store.notes.validateAll(), 0);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

for (const operation of ["upsert", "delete"]) test(`dispose immediately denies new operations and drains ${operation} already in flight`, async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-memory-dispose-")), store = await openLocalStore(root);
  try {
    const note = await store.notes.upsert({ scope: "student", subjectId: "student-a", about: "preference", key: "style", title: "Style", content: "Original" });
    const memory = new MemoryCoordinator(store.notes, "student-a");
    const original = store.notes[operation].bind(store.notes);
    let release, entered;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    store.notes[operation] = async (...args) => { entered(); await gate; return original(...args); };
    const pending = operation === "upsert"
      ? memory.update({ noteId: note.frontmatter.noteId, expectedRevision: 1, title: "Style", content: "Too late" })
      : memory.delete({ noteId: note.frontmatter.noteId, expectedRevision: 1 });
    const observed = pending.catch(error => error);
    await started;
    let disposed = false;
    const closing = memory.dispose().then(() => { disposed = true; });
    await assert.rejects(memory.read(note.frontmatter.noteId), /disposed/);
    assert.equal(disposed, false);
    release();
    assert.match((await observed).message, /disposed/);
    await closing;
    assert.equal(disposed, true);
    assert.equal((await store.notes.read(note.frontmatter.noteId)).content, "Original");
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});
