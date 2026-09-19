import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { LearnRepository } from "../storage/learn-records.js";

/** Call only with a main-process native chooser result, never a renderer-provided path. */
export async function importLearnFile(repository: LearnRepository, chosenPath: string, courseId: string | null, title = basename(chosenPath), assertActive?: () => void) {
  assertActive?.();
  const info = await stat(chosenPath);
  if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new Error("Choose a syllabus file smaller than 8 MB");
  const extension = extname(chosenPath).toLowerCase();
  if (![".pdf", ".txt", ".md", ".csv"].includes(extension)) throw new Error("Choose a PDF or text syllabus");
  const bytes = await readFile(chosenPath);
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error("The syllabus file is too large");
  let text: string;
  if (extension === ".pdf") {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = getDocument({ data: new Uint8Array(bytes), useWasm: false, useSystemFonts: false, disableFontFace: true });
    try {
      const pdf = await loading.promise;
      if (pdf.numPages > 80) throw new Error("This PDF is too long; choose the syllabus pages or paste their text");
      const pages: string[] = [];
      let length = 0;
      for (let index = 1; index <= pdf.numPages; index++) {
        const page = await pdf.getPage(index), content = await page.getTextContent();
        const pageText = content.items.map(item => "str" in item ? item.str : "").join(" ");
        length += pageText.length;
        if (length > 200000) throw new Error("This PDF has too much text; choose the syllabus pages");
        pages.push(pageText); page.cleanup();
      }
      text = pages.join("\n\n");
    } finally { await loading.destroy(); }
  } else text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!text.trim()) throw new Error("This file has no readable text. Paste the syllabus text to continue.");
  assertActive?.();
  return repository.importSource({ courseId, title, kind: "file", sourceTarget: null, text });
}
