import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const protectedFiles = new Map([
  [".openai/hosting.json", "D532ABB65CF9AE20634B464D954CB4A08A0DE9F3CD3CDF7F9C3EC8948826D947"],
  ["worker/index.js", "2DD0615A445143933D88D4271F54F5D63EE951421FCD08C5A7617BB09C564389"],
  ["scripts/prepare-sites-build.mjs", "B6A6ADAA4FAB3234676116DD1C9CB6611275AB9D92DD26F5BF402393E3744BF6"],
  ["tests/sites-worker.test.mjs", "96AF7B48906C6460C793356D7B6952F7D5026DBF5A502BEC0D9297FF04201C26"],
]);

for (const [relativePath, expectedHash] of protectedFiles) {
  test(`protected file is byte-identical: ${relativePath}`, async () => {
    const bytes = await readFile(new URL(`../${relativePath}`, import.meta.url));
    const actualHash = createHash("sha256").update(bytes).digest("hex").toUpperCase();
    assert.equal(actualHash, expectedHash);
  });
}
