import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HomeworkFiles } from "../../dist/electron/files/homework-files.js";
import { createBrowserDownloadTool } from "../../dist/electron/browser/downloads.js";
import { createPdfReadTool } from "../../dist/electron/files/pdf-tool.js";
import { schoolPdf } from "../../scripts/qa/school-pdf.mjs";

test("download preserves exact bytes and duplicate names, then reads text and image-only PDF pages", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-materials-"));
  try {
    const files = await HomeworkFiles.open(root);
    const browser = {
      downloadSource: async (ref) => {
        assert.equal(ref, "fresh-link");
        return "https://school.test/download.php";
      },
      fetchDownload: async () =>
        new Response(schoolPdf(), {
          headers: {
            "content-type": "application/pdf",
            "content-disposition": "attachment; filename*=UTF-8''Exercise%206.pdf",
          },
        }),
    };
    const download = createBrowserDownloadTool(browser, files);
    const first = await download.execute("1", { ref: "fresh-link" });
    const second = await download.execute("2", { ref: "fresh-link" });
    assert.equal(first.details.path, "materials/Exercise 6.pdf");
    assert.equal(second.details.path, "materials/Exercise 6 (1).pdf");
    assert.deepEqual(await readFile(join(root, first.details.path)), schoolPdf());
    const read = createPdfReadTool(files);
    const page1 = await read.execute("3", { path: first.details.path });
    assert.equal(page1.details.pages, 2);
    assert.match(page1.content[0].text, /Add 2 and 3/);
    assert.ok(page1.content.some((item) => item.type === "image" && item.data.length > 1000));
    const page2 = await read.execute("4", { path: first.details.path, page: 2 });
    assert.match(page2.content[0].text, /No extractable text/);
    assert.ok(page2.content.some((item) => item.type === "image" && item.data.length > 1000));
    await assert.rejects(read.execute("5", { path: first.details.path, page: 3 }), /has 2 pages/);
    await assert.rejects(read.execute("6", { path: "../outside.pdf" }), /escaped/);
    await writeFile(join(root, "login.pdf"), "<html>Sign in</html>");
    await assert.rejects(read.execute("7", { path: "login.pdf" }), /not a PDF/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("HTML login, HTTP errors, oversized and interrupted streams leave no files; a later download succeeds", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-material-failures-"));
  try {
    const files = await HomeworkFiles.open(root);
    for (const [response, message] of [
      [() => new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } }), /web page/],
      [() => new Response("", { status: 403 }), /HTTP 403/],
      [() => new Response("large", { headers: { "content-length": "50000001" } }), /50 MB/],
      [
        () =>
          new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new Uint8Array(50_000_001));
                c.close();
              },
            }),
          ),
        /50 MB/,
      ],
      [
        () =>
          new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new Uint8Array([1]));
                c.error(new Error("connection interrupted"));
              },
            }),
          ),
        /interrupted/,
      ],
    ]) {
      const browser = {
        downloadSource: async () => "https://school.test/file",
        fetchDownload: async () => response(),
      };
      await assert.rejects(createBrowserDownloadTool(browser, files).execute("bad", {}), message);
      assert.deepEqual(await files.list(), []);
    }
    const abort = new AbortController();
    abort.abort();
    const blocked = {
      downloadSource: async () => "https://school.test/file",
      fetchDownload: async () => {
        throw new Error("must not fetch");
      },
    };
    await assert.rejects(
      createBrowserDownloadTool(blocked, files).execute("cancel", {}, abort.signal),
      /abort/i,
    );
    const redirected = {
      downloadSource: async () => "https://school.test/actual.txt",
      fetchDownload: async () => new Response("starter code", { headers: { "content-type": "text/plain" } }),
    };
    const result = await createBrowserDownloadTool(redirected, files).execute("ok", {});
    assert.equal((await files.read(result.details.path)).content, "starter code");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("material filenames and symlinks cannot write outside the assignment", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-material-paths-"));
  const outside = await mkdtemp(join(tmpdir(), "studi-material-outside-"));
  try {
    const files = await HomeworkFiles.open(root);
    await assert.rejects(files.saveMaterial("../escape.pdf", new Uint8Array([1])), /invalid filename/);
    await assert.rejects(files.saveMaterial("CON.pdf", new Uint8Array([1])), /invalid filename/);
    await symlink(outside, join(root, "materials"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(files.saveMaterial("file.pdf", new Uint8Array([1])), /Symbolic links/);
    assert.deepEqual(await (await HomeworkFiles.open(outside)).list(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
