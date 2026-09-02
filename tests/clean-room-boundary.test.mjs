import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const discardedFiles = [
  "src/App.jsx",
  "src/Onboarding.jsx",
  "src/data.js",
  "src/main.jsx",
  "src/styles.css",
  "electron/main.cjs",
  "electron/preload.cjs",
  "electron/moodle-adapter.cjs",
  "electron/school-workflow.cjs",
  "public/assets/studi-mascot.png",
  "public/demo/assignment.html",
  "public/demo/external.html",
  "public/demo/lms.html",
  "public/demo/moodle.html",
  "public/qa/compare-focus.html",
  "public/qa/compare.html",
  "public/qa/implementation.png",
  "public/qa/reference.png",
];
const forbiddenReferences = [
  /(?:^|[/\\])App\.jsx\b/m,
  /Onboarding\.jsx\b/,
  /moodle-adapter/,
  /school-workflow/,
  /(?:^|[/\\])demo[/\\](?:moodle|lms|assignment|external)\.html\b/im,
  /Demo\s+(?:Moodle|Canvas|WebAssign)/i,
  /(?:seeded|demo)\s*(?:assignment|course|school)\s*data/i,
  /data-(?:assignment|course)(?:=|\b)/i,
  /studidemo/i,
  /scripted\s*(?:agent|task)\s*stage/i,
  /(?:spawn|execFile)\s*\([^)]*["']codex["']/s,
];

test("discarded prototype modules are absent", async () => {
  for (const relativePath of discardedFiles) {
    await assert.rejects(access(new URL(relativePath, root)), { code: "ENOENT" });
  }
});

test("active runtime source does not reference discarded behavior", async () => {
  const sourceFiles = await collectFiles(["src", "electron", "shared", "public"]);
  const activeFiles = [join(rootPath, "package.json"), ...sourceFiles];
  const violations = [];

  for (const file of activeFiles) {
    const source = await readFile(file, "utf8");
    for (const pattern of forbiddenReferences) {
      const match = source.match(pattern);
      if (match) {
        violations.push({ file: file.slice(rootPath.length), match: match[0], pattern: String(pattern) });
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("clean-room scan rejects injected LMS, seeded-data, and direct-Codex failures", () => {
  const injectedFailures = [
    '<title>Demo Moodle</title><article data-assignment="seed-1"></article>',
    'const seededSchoolData = [{ course: "BIO 150" }];',
    'spawn("codex", ["exec", "scan-school"]);',
  ];

  const injectedPatterns = [
    /Demo\s+(?:Moodle|Canvas|WebAssign)/i,
    /(?:seeded|demo)\s*(?:assignment|course|school)\s*data/i,
    /(?:spawn|execFile)\s*\([^)]*["']codex["']/s,
  ];

  for (const [index, source] of injectedFailures.entries()) {
    assert.match(source, injectedPatterns[index]);
  }
});

async function collectFiles(directories) {
  const files = [];
  for (const directory of directories) {
    await collectDirectory(join(rootPath, directory), files);
  }
  return files;
}

async function collectDirectory(directory, files) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectDirectory(entryPath, files);
    } else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|html|css|json)$/i.test(entry.name)) {
      files.push(entryPath);
    }
  }
}
