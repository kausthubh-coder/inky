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
