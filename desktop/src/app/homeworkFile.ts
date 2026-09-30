/** Delimited files can contain quoted separators, escaped quotes, and multiline cells. */
export function parseDelimited(text: string, delimiter: "," | "\t"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (char === '"' && (quoted || cell === "")) {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && input[i + 1] === "\n") i++;
      rows.push([...row, cell]);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell || row.length || input.length && !/[\r\n]$/.test(input)) rows.push([...row, cell]);
  return rows;
}
