import { crc32, deflateSync } from "node:zlib";

// Small deterministic documents, without requiring Office or a PDF renderer.
export function documentFixture(
  format: "docx" | "image-pdf",
  text: string,
): Buffer {
  if (format === "docx") {
    const escape = (s: string) =>
      s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    return zip({
      "[Content_Types].xml":
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      "_rels/.rels":
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text
        .split("\n")
        .map((line) => `<w:p><w:r><w:t>${escape(line)}</w:t></w:r></w:p>`)
        .join("")}<w:sectPr/></w:body></w:document>`,
    });
  }
  // Rasterize a compact 5x7 uppercase font; the PDF contains no text operators.
  const glyphs: Record<string, string> = {
    A: "01110100011000111111100011000110001",
    B: "11110100011000111110100011000111110",
    C: "01111100001000010000100001000001111",
    D: "11110100011000110001100011000111110",
    E: "11111100001000011110100001000011111",
    G: "01111100001000010111100011000101111",
    H: "10001100011000111111100011000110001",
    I: "11111001000010000100001000010011111",
    K: "10001100101010011000101001001010001",
    L: "10000100001000010000100001000011111",
    N: "10001110011010110011100011000110001",
    O: "01110100011000110001100011000101110",
    P: "11110100011000111110100001000010000",
    Q: "01110100011000110001101011001001101",
    R: "11110100011000111110101001001010001",
    S: "01111100001000001110000010000111110",
    T: "11111001000010000100001000010000100",
    U: "10001100011000110001100011000101110",
    V: "10001100011000110001100010101000100",
    W: "10001100011000110101101011101110001",
    Z: "11111000010001000100010001000011111",
    "0": "01110100011001110101110011000101110",
    "7": "11111000010001000100010000100001000",
  };
  const lines = text.toUpperCase().split("\n"),
    width = Math.max(...lines.map((line) => line.length)) * 6,
    height = lines.length * 10;
  const pixels = Buffer.alloc(width * height, 255);
  lines.forEach((line, y) =>
    [...line].forEach((char, x) =>
      [...(glyphs[char] ?? "")].forEach((bit, i) => {
        if (bit === "1")
          pixels[(y * 10 + Math.floor(i / 5)) * width + x * 6 + (i % 5)] = 0;
      }),
    ),
  );
  const raster = deflateSync(pixels),
    content = Buffer.from(
      `q ${width * 3} 0 0 ${height * 3} 48 ${750 - height * 3} cm /Im0 Do Q`,
    );
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
    ),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${raster.length} >>\nstream\n`,
      ),
      raster,
      Buffer.from("\nendstream"),
    ]),
    Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
      content,
      Buffer.from("\nendstream"),
    ]),
  ];
  const chunks = [Buffer.from("%PDF-1.4\n")],
    offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(chunks.reduce((n, b) => n + b.length, 0));
    chunks.push(
      Buffer.from(`${i + 1} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n"),
    );
  }
  const start = chunks.reduce((n, b) => n + b.length, 0);
  chunks.push(
    Buffer.from(
      `xref\n0 6\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}

function zip(files: Record<string, string>): Buffer {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [path, text] of Object.entries(files)) {
    const name = Buffer.from(path),
      body = Buffer.from(text),
      crc = crc32(body);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(body.length, 22);
    header.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(body.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    local.push(header, name, body);
    central.push(entry, name);
    offset += header.length + name.length + body.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(
    central.reduce((n, b) => n + b.length, 0),
    12,
  );
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
