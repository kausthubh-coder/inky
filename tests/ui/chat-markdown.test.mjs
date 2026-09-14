import assert from "node:assert/strict";
import test from "node:test";
import { safeChatHref } from "../../desktop/src/app/chatMarkdown.ts";

test("chat links only keep http, https, and mailto", () => {
  assert.equal(safeChatHref("https://school.example.edu/hw"), "https://school.example.edu/hw");
  assert.equal(safeChatHref("http://example.com/a"), "http://example.com/a");
  assert.equal(safeChatHref("mailto:inky@studi.local"), "mailto:inky@studi.local");
  assert.equal(safeChatHref("javascript:alert(1)"), undefined);
  assert.equal(safeChatHref("file:///etc/passwd"), undefined);
  assert.equal(safeChatHref("/relative"), undefined);
  assert.equal(safeChatHref("not a url"), undefined);
});
