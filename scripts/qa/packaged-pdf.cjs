// Exercise production PDF tools and their dependencies from the actual package.
const { app } = require("electron");
const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const { pathToFileURL } = require("node:url");

const root = mkdtempSync(join(tmpdir(), "studi-packaged-pdf-"));
app.setPath("userData", join(root, "profile"));
app
  .whenReady()
  .then(async () => {
    assert.ok(process.argv[2], "Supply the packaged app.asar path");
    const archive = resolve(process.argv[2]);
    const load = (path) => import(pathToFileURL(join(archive, path)).href);
    const { HomeworkFiles } = await load("dist/electron/files/homework-files.js");
    const { createPdfReadTool } = await load("dist/electron/files/pdf-tool.js");
    const { schoolPdf } = await import(pathToFileURL(resolve("scripts/qa/school-pdf.mjs")).href);
    writeFileSync(join(root, "assignment.pdf"), schoolPdf());
    const reader = createPdfReadTool(await HomeworkFiles.open(root));
    const first = await reader.execute("text", { path: "assignment.pdf", page: 1 });
    assert.equal(first.details.pages, 2);
    assert.match(first.content[0].text, /Add 2 and 3/);
    const second = await reader.execute("scan", { path: "assignment.pdf", page: 2 });
    assert.match(second.content[0].text, /No extractable text/);
    for (const page of [first, second]) {
      assert.ok(page.content.some((item) => item.type === "image" && item.data.length > 1000));
    }
    console.log(
      JSON.stringify({
        status: "passed",
        archive,
        architecture: process.arch,
        electron: process.versions.electron,
        checks: [
          "packaged production PDF tool",
          "text page",
          "scanned page image",
          "worker, fonts and native canvas",
        ],
      }),
    );
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
