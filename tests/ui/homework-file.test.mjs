import assert from "node:assert/strict";
import test from "node:test";
import { parseDelimited } from "../../desktop/src/app/homeworkFile.ts";

test("CSV keeps quoted separators, escaped quotes, and multiline cells", () => {
  assert.deepEqual(parseDelimited('Name,Note\r\n"Lee, A","Said ""yes""\nthen left"\r\n', ","), [
    ["Name", "Note"], ["Lee, A", 'Said "yes"\nthen left'],
  ]);
});

test("TSV preserves empty cells and handles a BOM and trailing row", () => {
  assert.deepEqual(parseDelimited("\uFEFFA\tB\t\n1\t\t3", "\t"), [["A", "B", ""], ["1", "", "3"]]);
  assert.deepEqual(parseDelimited("", ","), []);
  assert.deepEqual(parseDelimited("a,b\n", ","), [["a", "b"]]);
});
