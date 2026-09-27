import assert from "node:assert/strict";
import { test } from "node:test";

import { compactBrowserSnapshotContext } from "../../dist/electron/browser/context.js";

test("browser context keeps the last two snapshots and preserves transcript evidence", () => {
  const snapshot = (id) => ({ role: "toolResult", toolName: "browser_snapshot", toolCallId: id,
    content: [{ type: "text", text: `Page ${id} with detailed content` }], isError: false, timestamp: id });
  const original = [snapshot(1), snapshot(2), { ...snapshot(3), toolName: "browser_rows" }, snapshot(4)];
  const compact = compactBrowserSnapshotContext(original);
  assert.match(compact[0].content[0].text, /Earlier browser snapshot omitted/);
  assert.equal(compact[1].content[0].text, original[1].content[0].text);
  assert.equal(compact[2].content[0].text, original[2].content[0].text);
  assert.equal(compact[3].content[0].text, original[3].content[0].text);
  assert.equal(original[0].content[0].text, "Page 1 with detailed content");
  assert.equal(compact[0].toolCallId, original[0].toolCallId);
});

test("older large results keep their opening as a note and older images are dropped", () => {
  const page = (id, size) => ({ role: "toolResult", toolName: "read_document", toolCallId: id, isError: false, timestamp: id,
    content: [{ type: "text", text: `Page ${id} `.padEnd(size, "x") }] });
  const image = { role: "toolResult", toolName: "browser_screenshot", toolCallId: "shot", isError: false, timestamp: 0,
    content: [{ type: "image", mimeType: "image/png", data: "AAAA" }] };
  const original = [image, page(1, 6000), page(2, 6000), page(3, 6000), page(4, 6000), page(5, 100), page(6, 100)];
  const compact = compactBrowserSnapshotContext(original);
  assert.match(compact[0].content[0].text, /Earlier image omitted/);
  assert.match(compact[1].content[0].text, /^Page 1 x+\n\[Earlier result shortened/);
  assert.ok(compact[1].content[0].text.length < 1_000);
  for (const index of [2, 3, 4]) assert.equal(compact[index].content[0].text, original[index].content[0].text, "the three latest large results stay whole");
  assert.equal(compact[5].content[0].text, original[5].content[0].text, "small results are never shortened");
  assert.equal(original[1].content[0].text.length, 6000, "the transcript itself is untouched");
});
