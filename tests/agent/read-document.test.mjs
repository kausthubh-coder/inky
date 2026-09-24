import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createReadDocumentTool } from "../../dist/electron/browser/read-document.js";
import { schoolPdf } from "../fixtures/school-pdf.mjs";

test("read_document follows a Moodle resource redirect and reads text or scanned PDF pages", async (t) => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === "/mod/resource/view.php?id=42") {
      response.writeHead(303, { location: "/pluginfile.php/42/course/section/Exercise.pdf?forcedownload=1" });
      response.end();
      return;
    }
    if (request.url === "/pluginfile.php/42/course/section/Exercise.pdf?forcedownload=1") {
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": "attachment; filename=Exercise.pdf",
      });
      response.end(schoolPdf());
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise(resolve => server.close(resolve));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const seen = [];
  const browser = {
    downloadSource: async ref => {
      assert.equal(ref, "resource-link");
      return `${origin}/mod/resource/view.php?id=42`;
    },
    fetchDownload: async (url, signal) => {
      seen.push(url);
      return fetch(url, { redirect: "follow", signal });
    },
  };
  const read = createReadDocumentTool(browser);

  assert.equal(read.name, "read_document");
  const textPage = await read.execute("text", { ref: "resource-link", page: 1 });
  assert.equal(textPage.details.pages, 2);
  assert.match(textPage.details.url, /pluginfile\.php.*forcedownload=1/);
  assert.match(textPage.details.text, /Add 2 and 3/);
  assert.equal(textPage.details.imageProvided, false);
  assert.deepEqual(textPage.content.map(item => item.type), ["text"]);

  const scannedPage = await read.execute("scan", { ref: "resource-link", page: 2 });
  assert.equal(scannedPage.details.text, "");
  assert.equal(scannedPage.details.imageProvided, true);
  assert.match(scannedPage.content[0].text, /No extractable text/);
  assert.equal(scannedPage.content[1].type, "image");
  assert.equal(scannedPage.content[1].mimeType, "image/png");
  assert.ok(scannedPage.content[1].data.length > 1_000);

  assert.deepEqual(seen, [
    `${origin}/mod/resource/view.php?id=42`,
    `${origin}/mod/resource/view.php?id=42`,
  ]);
  assert.deepEqual(requests, [
    "/mod/resource/view.php?id=42",
    "/pluginfile.php/42/course/section/Exercise.pdf?forcedownload=1",
    "/mod/resource/view.php?id=42",
    "/pluginfile.php/42/course/section/Exercise.pdf?forcedownload=1",
  ]);
});

test("read_document rejects an HTML sign-in response and invalid page without returning misleading content", async () => {
  const htmlBrowser = {
    downloadSource: async () => "https://school.test/mod/resource/view.php?id=7",
    fetchDownload: async () => new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } }),
  };
  await assert.rejects(
    createReadDocumentTool(htmlBrowser).execute("login", {}),
    /web page or unsupported file, not a PDF/,
  );

  const pdfBrowser = {
    downloadSource: async () => "https://school.test/file.pdf",
    fetchDownload: async () => new Response(schoolPdf(), { headers: { "content-type": "application/pdf" } }),
  };
  await assert.rejects(
    createReadDocumentTool(pdfBrowser).execute("page", { page: 3 }),
    /has 2 pages/,
  );
});
