import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initializeHomeworkWorkspace, suggestHomeworkRoot } from "../../dist/electron/files/workspace.js";

test("the suggested homework folder skips a folder with someone else's files and reuses a Studi one", async () => {
  const documents = await mkdtemp(join(tmpdir(), "studi-documents-"));
  try {
    assert.equal(await suggestHomeworkRoot(documents), join(documents, "Studi"));
    await mkdir(join(documents, "Studi"));
    await writeFile(join(documents, "Studi", "notes.txt"), "mine");
    assert.equal(await suggestHomeworkRoot(documents), join(documents, "Studi 2"));
    await mkdir(join(documents, "Studi 2"));
    await initializeHomeworkWorkspace(join(documents, "Studi 2"));
    assert.equal(await suggestHomeworkRoot(documents), join(documents, "Studi 2"));
  } finally {
    await rm(documents, { recursive: true, force: true });
  }
});
