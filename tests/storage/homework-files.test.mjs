import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { HomeworkFiles } from "../../dist/electron/files/homework-files.js";

test("homework files list, read, and atomically write only below the selected root", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-homework-files-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "Main.java"), "class Main {}\n");
    const files = await HomeworkFiles.open(root);
    assert.deepEqual((await files.list()).map(({ path, kind }) => ({ path, kind })), [
      { path: "src", kind: "directory" },
      { path: "src/Main.java", kind: "file" },
    ]);
    assert.equal((await files.read("src/Main.java")).content, "class Main {}\n");
    const receipt = await files.write("src/Main.java", "class Main { int answer = 42; }\n");
    assert.equal(receipt.path, "src/Main.java");
    assert.equal(await readFile(join(root, "src", "Main.java"), "utf8"), "class Main { int answer = 42; }\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("homework files reject traversal, absolute paths, oversized content, and link escapes", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-homework-jail-"));
  const outside = await mkdtemp(join(tmpdir(), "studi-homework-outside-"));
  try {
    const files = await HomeworkFiles.open(root);
    await assert.rejects(files.read("../outside.txt"), /escaped the selected root/);
    await assert.rejects(files.write(join(outside, "absolute.txt"), "no"), /must be relative/);
    await assert.rejects(files.write("large.txt", "x".repeat(1_000_001)), /limited/);
    await writeFile(join(outside, "secret.txt"), "outside");
    await symlink(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(files.read("escape/secret.txt"), /Symbolic links/);
    assert.equal(await readFile(join(outside, "secret.txt"), "utf8"), "outside");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("adding materials preserves originals and same-name files, rejects oversized files and link escapes", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-materials-"));
  const source = await mkdtemp(join(tmpdir(), "studi-material-source-"));
  try {
    const files = await HomeworkFiles.open(root);
    const note = join(source, "notes.txt");
    await writeFile(note, "first");
    assert.equal(await files.importFile(note), "materials/notes.txt");
    await writeFile(note, "second");
    assert.equal(await files.importFile(note), "materials/notes (1).txt");
    assert.equal((await files.read("materials/notes.txt")).content, "first");
    assert.equal((await files.read("materials/notes (1).txt")).content, "second");
    assert.equal(await readFile(note, "utf8"), "second");
    assert.equal(await files.revealPath("materials/notes.txt"), join(root, "materials", "notes.txt"));
    await assert.rejects(files.revealPath("../notes.txt"), /escaped/);
    await truncate(note, 50_000_001);
    await assert.rejects(files.importFile(note), /50 MB/);
    await assert.rejects(files.importFile(source), /regular file/);
    await rm(join(root, "materials"), { recursive: true });
    await symlink(source, join(root, "materials"), process.platform === "win32" ? "junction" : "dir");
    await writeFile(note, "untouched");
    await assert.rejects(files.importFile(note), /Symbolic links/);
    assert.equal(await readFile(note, "utf8"), "untouched");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
});
