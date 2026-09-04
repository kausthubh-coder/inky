import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openLocalStore } from "../../dist/electron/storage/index.js";

const now = "2026-09-03T12:00:00.000Z";

test("scoped note upserts have a stable identity, revision, order, and searchable body", async () => {
  const root = join(tmpdir(), `studi-notes-${process.pid}-${Date.now()}`);
  const store = await openLocalStore(root);
  try {
    const first = await store.notes.upsert({ scope: "course", subjectId: "csc-316", about: "work", key: "current-project", title: "Current project", content: "Week one tree notes", updatedAt: now });
    const second = await store.notes.upsert({ scope: "course", subjectId: "csc-316", about: "work", key: "current-project", title: "Current project", content: "Week two Huffman coding project", updatedAt: "2026-09-03T12:01:00.000Z" });
    assert.equal(second.frontmatter.noteId, first.frontmatter.noteId);
    assert.equal(second.frontmatter.revision, 2);
    assert.equal(store.notes.list().length, 1);
    const found = await store.notes.search("huffman", [{ scope: "course", subjectId: "csc-316" }]);
    assert.equal(found[0]?.entry.noteId, first.frontmatter.noteId);
    assert.match(found[0]?.preview ?? "", /Week two Huffman/);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("note paths and credential-bearing bodies fail closed while HTML is stored as inert Markdown text", async () => {
  const root = join(tmpdir(), `studi-notes-policy-${process.pid}-${Date.now()}`);
  const store = await openLocalStore(root);
  try {
    await assert.rejects(() => store.notes.upsert({ scope: "course", subjectId: "..", about: "work", key: "escape", title: "No", content: "No" }));
    const html = await store.notes.upsert({ scope: "course", subjectId: "csc-316", about: "work", key: "html", title: "No", content: "Open <strong>Assignments</strong>." });
    assert.equal(html.content, "Open &lt;strong&gt;Assignments&lt;/strong&gt;.");
    await assert.rejects(() => store.notes.upsert({ scope: "course", subjectId: "csc-316", about: "work", key: "secret", title: "No", content: "Authorization: Bearer secret-canary" }), /Credential-bearing/);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("startup reconciliation repairs a Markdown rename that committed before index update", async () => {
  const root = join(tmpdir(), `studi-notes-repair-${process.pid}-${Date.now()}`);
  const failing = await openLocalStore(root, { failureInjector: (point) => { if (point === "note_after_rename_before_index") throw new Error("injected note crash"); } });
  await assert.rejects(() => failing.notes.upsert({ scope: "school", subjectId: "primary-school", about: "scan", key: "navigation", title: "Navigation", content: "Labs are a second tab.", updatedAt: now }), /injected note crash/);
  failing.close();

  const recovered = await openLocalStore(root);
  try {
    assert.equal(recovered.notes.list().length, 1);
    assert.equal((await recovered.notes.read(recovered.notes.list()[0].noteId))?.content, "Labs are a second tab.");
  } finally {
    recovered.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a stale index row cannot return content and malformed authoritative Markdown blocks reopen", async () => {
  const root = join(tmpdir(), `studi-notes-stale-${process.pid}-${Date.now()}`);
  const store = await openLocalStore(root);
  const note = await store.notes.upsert({ scope: "assignment", subjectId: "assignment-1", about: "work", key: "leftover", title: "Leftover", content: "Check the Huffman edge case.", updatedAt: now });
  const path = join(store.notes.rootDirectory, "assignment", "assignment-1", "work", "leftover.md");
  await rm(path);
  assert.equal(await store.notes.read(note.frontmatter.noteId), null);
  assert.equal(store.notes.list().length, 0);
  store.close();

  const badDirectory = join(root, "notes", "course", "csc-316", "work");
  await mkdir(badDirectory, { recursive: true });
  await writeFile(join(badDirectory, "bad.md"), "---\nscope: course\n---\nbroken\n", "utf8");
  await assert.rejects(() => openLocalStore(root), /Malformed note/);
  await rm(root, { recursive: true, force: true });
});
