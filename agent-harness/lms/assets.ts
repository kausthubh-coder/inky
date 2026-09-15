import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, rename, writeFile, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { Asset, Upload } from "./domain.js";

export function assetBytes(asset: Asset): Buffer {
  if (asset.format === "text") return Buffer.from(asset.text);
  // Deterministic, selectable-text one-page PDFs for portable synthetic fixtures.
  const lines = asset.text.split("\n").flatMap((line) => line.match(/.{1,85}(?:\s|$)|.{1,85}/g) ?? [""]);
  const content = `BT /F1 12 Tf 48 750 Td 17 TL\n${lines.map((line) => `(${line.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")}) Tj T*`).join("\n")}\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n",
    offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf);
}
const accepted = new Set([
  ".pdf",
  ".txt",
  ".md",
  ".csv",
  ".c",
  ".java",
  ".html",
  ".zip",
  ".docx",
  ".png",
  ".jpg",
  ".jpeg",
]);
export async function storeUpload(directory: string, file: File): Promise<Upload> {
  const name = basename(file.name.replaceAll("\\", "/")).replaceAll(/[\r\n\x00]/g, "");
  if (!name || !accepted.has(extname(name).toLowerCase())) throw new Error("Unsupported upload file type.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Each file must be smaller than 10 MB.");
  const bytes = Buffer.from(await file.arrayBuffer()),
    hash = createHash("sha256").update(bytes).digest("hex");
  const folder = join(directory, "uploads");
  await mkdir(folder, { recursive: true });
  const temporary = join(folder, `${hash}.${randomUUID()}.tmp`);
  await writeFile(temporary, bytes, { mode: 0o600 });
  await rename(temporary, join(folder, hash));
  return {
    id: hash,
    hash,
    name,
    bytes: bytes.length,
    mime: file.type || "application/octet-stream",
  };
}
export interface PrivateAsset {
  id: string;
  name: string;
  mime: string;
  sha256: string;
  relativePath: string;
  source: string;
}
export interface PrivatePack {
  schemaVersion: 1;
  assets: PrivateAsset[];
}
export async function importPrivateAssets(manifestPath: string, libraryRoot: string): Promise<PrivatePack> {
  const source: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!source || typeof source !== "object" || !("assets" in source) || !Array.isArray(source.assets))
    throw new Error("Manifest requires an assets array.");
  const assets: PrivateAsset[] = [];
  const destination = resolve(libraryRoot);
  await mkdir(join(destination, "blobs"), { recursive: true });
  for (const item of source.assets) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !/^[a-z0-9-]+$/.test(item.id) ||
      typeof item.path !== "string" ||
      typeof item.mime !== "string"
    )
      throw new Error("Invalid import entry.");
    if (assets.some((asset) => asset.id === item.id)) throw new Error("Duplicate import asset ID.");
    const path = resolve(resolve(manifestPath, ".."), item.path),
      name = basename(path);
    if (
      ![".pdf", ".txt", ".md", ".csv", ".zip", ".docx", ".png", ".jpg", ".jpeg", ".c", ".java"].includes(
        extname(name).toLowerCase(),
      )
    )
      throw new Error("Raw HTML is not imported. Rebuild pages using local simulator routes.");
    const bytes = await readFile(path);
    if (bytes.length > 25 * 1024 * 1024) throw new Error("Import exceeds 25 MB per file.");
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (item.sha256 && item.sha256 !== hash) throw new Error("Source hash mismatch.");
    await writeFile(join(destination, "blobs", hash), bytes, { mode: 0o600 });
    assets.push({
      id: item.id,
      name,
      mime: item.mime,
      sha256: hash,
      relativePath: `blobs/${hash}`,
      source: typeof item.source === "string" ? item.source : name,
    });
  }
  const pack: PrivatePack = { schemaVersion: 1, assets };
  await writeFile(join(destination, "pack.json"), JSON.stringify(pack, null, 2), { mode: 0o600 });
  return pack;
}
export async function readPrivateAsset(root: string, asset: PrivateAsset): Promise<Buffer> {
  const source = await realpath(root),
    target = await realpath(join(source, asset.relativePath));
  const child = relative(source, target);
  if (child.startsWith("..") || isAbsolute(child)) throw new Error("Private asset escapes its library.");
  const bytes = await readFile(target);
  if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256)
    throw new Error("Private asset hash mismatch.");
  return bytes;
}
