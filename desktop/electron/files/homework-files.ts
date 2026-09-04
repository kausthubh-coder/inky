import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const READ_LIMIT = 250_000;
const WRITE_LIMIT = 1_000_000;
const LIST_LIMIT = 500;
const UPLOAD_LIMIT = 12;
const UPLOAD_FILE_LIMIT = 50_000_000;

export type HomeworkFileEntry = Readonly<{
  path: string;
  kind: "file" | "directory";
  size: number;
  modifiedAt: string;
}>;

export class HomeworkFiles {
  readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  static async open(root: string): Promise<HomeworkFiles> {
    const absolute = resolve(root);
    const metadata = await stat(absolute);
    if (!metadata.isDirectory()) throw new TypeError("The homework root must be a directory");
    return new HomeworkFiles(await realpath(absolute));
  }

  async list(rawPath = "."): Promise<HomeworkFileEntry[]> {
    const directory = await this.#existing(rawPath);
    if (!(await stat(directory)).isDirectory()) throw new TypeError("The requested homework path is not a directory");
    const entries: HomeworkFileEntry[] = [];
    await this.#walk(directory, entries);
    return entries.sort((a, b) => a.path.localeCompare(b.path)).slice(0, LIST_LIMIT);
  }

  async read(rawPath: string): Promise<{ path: string; content: string; modifiedAt: string }> {
    const path = await this.#existing(rawPath);
    const metadata = await stat(path);
    if (!metadata.isFile()) throw new TypeError("The requested homework path is not a file");
    if (metadata.size > READ_LIMIT) throw new TypeError(`Homework files larger than ${READ_LIMIT} bytes are not readable`);
    const content = await readFile(path, "utf8");
    if (content.includes("\u0000")) throw new TypeError("Binary homework files are not readable as text");
    return { path: this.#relative(path), content, modifiedAt: metadata.mtime.toISOString() };
  }

  async write(rawPath: string, content: string): Promise<{ path: string; size: number; modifiedAt: string }> {
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > WRITE_LIMIT) throw new TypeError(`Homework file writes are limited to ${WRITE_LIMIT} bytes`);
    const target = this.#resolve(rawPath);
    await this.#assertNoLinks(dirname(target));
    await mkdir(dirname(target), { recursive: true });
    await this.#assertNoLinks(dirname(target));
    try {
      const existing = await lstat(target);
      if (existing.isSymbolicLink() || !existing.isFile()) throw new TypeError("Homework writes may replace only regular files");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(content, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, target);
    } catch (error) {
      try { await handle?.close(); } catch { /* keep original */ }
      try { await unlink(temporary); } catch { /* best effort */ }
      throw error;
    }
    const metadata = await stat(target);
    return { path: this.#relative(target), size: metadata.size, modifiedAt: metadata.mtime.toISOString() };
  }

  async resolveUploads(rawPaths: readonly string[]): Promise<string[]> {
    if (rawPaths.length < 1 || rawPaths.length > UPLOAD_LIMIT) {
      throw new TypeError(`Choose between 1 and ${UPLOAD_LIMIT} workspace files to upload`);
    }
    const resolved: string[] = [];
    for (const rawPath of rawPaths) {
      const path = await this.#existing(rawPath);
      const metadata = await stat(path);
      if (!metadata.isFile()) throw new TypeError("Only regular workspace files can be uploaded");
      if (metadata.size > UPLOAD_FILE_LIMIT) {
        throw new TypeError(`Workspace uploads are limited to ${UPLOAD_FILE_LIMIT} bytes per file`);
      }
      resolved.push(path);
    }
    return resolved;
  }

  async #walk(directory: string, output: HomeworkFileEntry[]): Promise<void> {
    for (const child of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (output.length >= LIST_LIMIT) return;
      const path = resolve(directory, child.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) throw new TypeError(`Homework folder contains a symbolic link: ${this.#relative(path)}`);
      if (!metadata.isFile() && !metadata.isDirectory()) continue;
      output.push({
        path: this.#relative(path),
        kind: metadata.isDirectory() ? "directory" : "file",
        size: metadata.size,
        modifiedAt: metadata.mtime.toISOString(),
      });
      if (metadata.isDirectory()) await this.#walk(path, output);
    }
  }

  async #existing(rawPath: string): Promise<string> {
    const target = this.#resolve(rawPath);
    await this.#assertNoLinks(target);
    const canonical = await realpath(target);
    this.#assertInside(canonical);
    return canonical;
  }

  #resolve(rawPath: string): string {
    if (!rawPath || isAbsolute(rawPath)) throw new TypeError("Homework paths must be relative");
    const target = resolve(this.root, rawPath);
    this.#assertInside(target);
    return target;
  }

  async #assertNoLinks(target: string): Promise<void> {
    this.#assertInside(target);
    const relativePath = relative(this.root, target);
    let cursor = this.root;
    for (const segment of relativePath.split(sep).filter(Boolean)) {
      cursor = resolve(cursor, segment);
      try {
        if ((await lstat(cursor)).isSymbolicLink()) throw new TypeError("Symbolic links are not allowed in the homework root");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
    }
  }

  #assertInside(target: string): void {
    const normalizedRoot = process.platform === "win32" ? this.root.toLocaleLowerCase() : this.root;
    const absolute = resolve(target);
    const normalized = process.platform === "win32" ? absolute.toLocaleLowerCase() : absolute;
    if (normalized !== normalizedRoot && !normalized.startsWith(`${normalizedRoot}${sep}`)) {
      throw new TypeError("Homework path escaped the selected root");
    }
  }

  #relative(path: string): string {
    const value = relative(this.root, path).split(sep).join("/");
    return value || ".";
  }
}
