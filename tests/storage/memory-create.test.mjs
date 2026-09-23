import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { openLocalStore } from "../../dist/electron/storage/index.js";
import { MemoryCoordinator } from "../../dist/electron/agent/memory-coordinator.js";
test("remember creates an owned preference, rejects caller-controlled ownership, and survives restart", async () => {
  const root = await mkdtemp(join(tmpdir(),"studi-remember-"));
  let store = await openLocalStore(root);
  try {
    const memory = new MemoryCoordinator(store.notes,"student-a");
    const note = await memory.create({ title:"  My examples ", content:" Explain with Python. " });
    assert.equal(note.frontmatter.scope,"student"); assert.equal(note.frontmatter.subjectId,"student-a"); assert.equal(note.frontmatter.about,"preference");
    assert.equal(note.frontmatter.title,"My examples"); assert.equal(note.content,"Explain with Python.");
    assert.equal(memory.list().length,1);
    await assert.rejects(new MemoryCoordinator(store.notes,"student-b").read(note.frontmatter.noteId),/not available/);
    for (const input of [{ title:"",content:"no" },{ title:"x",content:" " },{ title:"x",content:"x",subjectId:"student-b" }]) await assert.rejects(memory.create(input));
    await memory.dispose(); store.close(); store = await openLocalStore(root);
    assert.equal((await new MemoryCoordinator(store.notes,"student-a").read(note.frontmatter.noteId)).content,"Explain with Python.");
  } finally { store.close(); await rm(root,{recursive:true,force:true}); }
});
test("disposing denies a queued memory creation before it writes", async () => {
  const root = await mkdtemp(join(tmpdir(),"studi-remember-dispose-")), store = await openLocalStore(root);
  try {
    const memory = new MemoryCoordinator(store.notes,"student-a");
    const pending = memory.create({ title:"Late", content:"Must not write." });
    const rejected = assert.rejects(pending,/disposed/);
    await memory.dispose(); await rejected;
    assert.equal(store.notes.list().length,0);
    await assert.rejects(memory.create({title:"Later",content:"No."}),/disposed/);
  } finally { store.close(); await rm(root,{recursive:true,force:true}); }
});

