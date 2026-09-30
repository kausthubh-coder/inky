import assert from "node:assert/strict";
import { test } from "node:test";

import { createBrowserContextCompactor } from "../../dist/electron/browser/context.js";

const result = (id, toolName, text) => ({ role: "toolResult", toolName, toolCallId: String(id), isError: false, timestamp: id,
  content: [{ type: "text", text }] });
const texts = messages => messages.map(message => message.content[0].text ?? message.content[0].type);

test("nothing is shortened until recent results pass the budget", () => {
  const compact = createBrowserContextCompactor({ budget: 10_000 });
  const history = [result(1, "browser_snapshot", "Page 1".padEnd(3000, "x")), result(2, "read_document", "Doc".padEnd(3000, "y"))];
  assert.deepEqual(texts(compact(history)), texts(history));
});

test("older results are shortened in one batch and then sent identically, so the prompt cache holds", () => {
  const compact = createBrowserContextCompactor({ budget: 10_000 });
  const image = { role: "toolResult", toolName: "browser_screenshot", toolCallId: "shot", isError: false, timestamp: 0,
    content: [{ type: "image", mimeType: "image/png", data: "AAAA" }] };
  const history = [image, result(1, "browser_snapshot", "Page 1".padEnd(4000, "x")), result(2, "read_document", "Doc".padEnd(4000, "y")),
    result(3, "scan_status", "small"), result(4, "browser_snapshot", "Page 4".padEnd(4000, "z")), result(5, "scan_record_rows", "saved")];
  const first = compact(history);
  assert.match(first[0].content[0].text, /Earlier image omitted/);
  assert.match(first[1].content[0].text, /Earlier browser snapshot omitted/);
  assert.match(first[2].content[0].text, /^Docy+\n\[Earlier result shortened/);
  assert.equal(first[3].content[0].text, "small", "small results are never shortened");
  assert.equal(first[4].content[0].text, history[4].content[0].text, "the latest full snapshot stays");
  assert.equal(first[5].content[0].text, "saved");
  const next = compact([...history, result(6, "browser_click", "clicked"), result(7, "browser_snapshot", "Page 7".padEnd(3000, "w"))]);
  assert.deepEqual(texts(next.slice(0, first.length)), texts(first), "earlier messages are unchanged between batches");
  assert.equal(history[2].content[0].text.length, 4000, "the transcript itself is untouched");
});

test("a change-only read keeps its base until a newer full read replaces it", () => {
  const compact = createBrowserContextCompactor({ budget: 5_000 });
  const history = [result(1, "browser_snapshot", "Base page".padEnd(3000, "x")),
    result(2, "browser_snapshot", "Only what changed since your last read of this page".padEnd(3000, "d")), result(3, "scan_status", "ok"), result(4, "scan_status", "ok")];
  assert.equal(compact(history)[0].content[0].text, history[0].content[0].text);
  const later = compact([...history, result(5, "browser_snapshot", "New page".padEnd(6000, "n")), result(6, "scan_status", "ok"), result(7, "scan_status", "ok")]);
  assert.match(later[0].content[0].text, /Earlier browser snapshot omitted/);
  assert.equal(later[4].content[0].text, "New page".padEnd(6000, "n"));
});
