import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  initializeHomeworkWorkspace,
  openAssignmentWorkspace,
  syncHomeworkClassFolders,
} from "../../dist/electron/files/workspace.js";

test("Studi accepts only an empty dedicated homework folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-workspace-empty-"));
  const occupied = await mkdtemp(join(tmpdir(), "studi-workspace-occupied-"));
  try {
    await writeFile(join(occupied, "taxes.txt"), "not homework");
    await assert.rejects(initializeHomeworkWorkspace(occupied), /empty folder made just for Studi/);

    const selected = await initializeHomeworkWorkspace(root);
    assert.equal(selected, root);
    assert.deepEqual((await readdir(root)).sort(), [".studi-sandbox", ".studi-workspace.json"]);
    const marker = JSON.parse(await readFile(join(root, ".studi-workspace.json"), "utf8"));
    assert.equal(marker.kind, "studi-homework-workspace");
    assert.equal(await initializeHomeworkWorkspace(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(occupied, { recursive: true, force: true });
  }
});

test("Studi creates cross-platform class and assignment workspaces", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-workspace-layout-"));
  try {
    await initializeHomeworkWorkspace(root);
    await syncHomeworkClassFolders(root, [
      { courseId: "course-calc", label: "CALC 1" },
      { courseId: "course-bad", label: "CON" },
    ]);
    const workspace = await openAssignmentWorkspace(root, {
      courseId: "course-calc",
      courseLabel: "CALC 1",
      assignmentId: "assignment-related-rates",
      assignmentTitle: "Problem set 4: Related rates",
    });
    assert.equal(workspace.classDirectory, join(root, "CALC 1"));
    assert.match(workspace.assignmentDirectory, /CALC 1[\\/]Problem set 4 Related rates \[[a-f0-9]{6}\]$/);
    assert.match(workspace.sandboxDirectory, /\.studi-sandbox[\\/][a-f0-9]{6}$/);
    assert.ok((await readdir(root)).includes("_CON"));
    assert.equal(JSON.parse(await readFile(join(workspace.assignmentDirectory, ".studi-assignment.json"), "utf8")).assignmentId, "assignment-related-rates");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Studi refuses a class path replaced with a non-directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-workspace-collision-"));
  try {
    await initializeHomeworkWorkspace(root);
    await writeFile(join(root, "BIO 150"), "collision");
    await assert.rejects(
      syncHomeworkClassFolders(root, [{ courseId: "bio", label: "BIO 150" }]),
      /EEXIST|plain directories/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("classes with the same display name keep separate stable folders", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-workspace-duplicate-"));
  try {
    await initializeHomeworkWorkspace(root);
    const directories = await syncHomeworkClassFolders(root, [
      { courseId: "course-a", label: "Seminar" },
      { courseId: "course-b", label: "Seminar" },
    ]);
    assert.equal(directories[0], join(root, "Seminar"));
    assert.match(directories[1], /Seminar \[[a-f0-9]{6}\]$/);
    assert.notEqual(directories[0], directories[1]);
    assert.deepEqual(await syncHomeworkClassFolders(root, [
      { courseId: "course-a", label: "Seminar" },
      { courseId: "course-b", label: "Seminar" },
    ]), directories);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
