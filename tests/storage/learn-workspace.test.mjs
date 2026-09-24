import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initializeHomeworkWorkspace } from "../../dist/electron/files/workspace.js";
import { addCheatsheetLines, goalFolder, readGoalNotes, recordSessionNote, saveStudyPage } from "../../dist/electron/files/learn-workspace.js";
import { studyPageDocument } from "../../dist/shared/study-page.js";

test("a goal folder keeps progress, a deduplicated cheat sheet and locked-down study pages", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-learn-folder-"));
  try {
    await initializeHomeworkWorkspace(root);
    const folder = await goalFolder(root, { title: "Exam 1", classLabel: "CSC 316 Data Structures" });
    assert.equal(folder, join(root, "Learn", "CSC 316 Exam 1"));
    assert.deepEqual(await readGoalNotes(folder), { progress: "", cheatsheet: "" });
    await recordSessionNote(folder, { date: "2026-09-24", topic: "Sorting", summary: "Traced insertion sort.", levelBefore: "Shaky", levelAfter: "Getting there", missing: ["Stability"], next: "Radix sort" });
    await addCheatsheetLines(folder, ["Insertion sort is stable", "Insertion sort is stable"]);
    await addCheatsheetLines(folder, ["Insertion sort is stable"]);
    const notes = await readGoalNotes(folder);
    assert.match(notes.progress, /## 2026-09-24 · Sorting[\s\S]*Shaky → Getting there[\s\S]*Still to practise: Stability[\s\S]*Next: Radix sort/);
    assert.equal(notes.cheatsheet, "- Insertion sort is stable\n");
    const name = await saveStudyPage(folder, "2026-09-24", "Shifts: one/step?", studyPageDocument("<p>hi</p>"));
    assert.deepEqual(await readdir(join(folder, "pages")), [name]);
    assert.doesNotMatch(name, /[/?:]/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a folder that isn't a Studi homework folder is refused", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-learn-folder-"));
  try {
    await mkdir(join(root, "other"));
    await assert.rejects(goalFolder(root, { title: "Exam", classLabel: null }), /not a Studi homework folder/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("study pages carry a no-network policy ahead of any page markup", () => {
  const document = studyPageDocument("<meta http-equiv=\"Content-Security-Policy\" content=\"default-src *\"><script>fetch('https://example.com')</script>");
  const policy = document.indexOf("default-src 'none'"), page = document.indexOf("default-src *");
  assert.ok(policy > 0 && policy < page);
  assert.match(document, /form-action 'none'/);
  assert.match(document, /window\.studi=\{explore:/);
});
