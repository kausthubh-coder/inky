import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import { parseDocument, stringify } from "yaml";

import {
  NoteDocumentSchema,
  NoteFrontmatterSchema,
  NoteIdentitySchema,
  NoteIndexEntrySchema,
  type NoteAbout,
  type NoteDocument,
  type NoteIdentity,
  type NoteIndexEntry,
  type NoteScope,
} from "../../shared/index.js";
import type { StudiSqliteDatabase } from "./database.js";
import { StorageError, errorMessage, isStorageError } from "./errors.js";

const NOTE_BODY_LIMIT = 100_000;
const NOTE_SEARCH_LIMIT = 25;
const safeSegment = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;
const markdownFile = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})\.md$/;
const credentialCanaries = [
  /(?:^|\n)\s*(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+\S+/i,
  /(?:^|\n)\s*(?:cookie|set-cookie)\s*:\s*\S+/i,
  /\b(?:COMPOSIO_API_KEY|CLERK_SECRET_KEY|access_token|refresh_token|id_token)\b\s*[:=]/i,
  /\bak_[A-Za-z0-9_-]{12,}\b/,
] as const;

export interface NoteUpsertInput extends NoteIdentity {
  readonly title: string;
  readonly content: string;
  readonly updatedAt?: string;
}

export interface NoteListFilter {
  readonly scope?: NoteScope;
  readonly subjectId?: string;
  readonly about?: NoteAbout;
}

export class NoteStore {
  readonly rootDirectory: string;

  constructor(
    rootDirectory: string,
    private readonly database: StudiSqliteDatabase,
    options: { readonly reconcile?: boolean } = {},
  ) {
    this.rootDirectory = resolve(rootDirectory);
    if (options.reconcile !== false) this.reconcile();
  }

  reconcile(): number {
    mkdirSync(this.rootDirectory, { recursive: true });
    const indexed = this.#scanNotes();
    this.database.transaction(() => {
      this.database.handle.prepare("DELETE FROM note_index").run();
      for (const entry of indexed.sort(compareEntries)) this.#putIndex(entry);
    });
    return indexed.length;
  }

  validateAll(): number {
    const authoritative = this.#scanNotes().sort(compareEntries);
    const indexed = this.list().sort(compareEntries);
    if (JSON.stringify(authoritative) !== JSON.stringify(indexed)) {
      throw new StorageError("backup_invalid", "Note index does not match authoritative Markdown", {
        markdownCount: authoritative.length,
        indexCount: indexed.length,
      });
    }
    return authoritative.length;
  }

  async upsert(value: unknown): Promise<NoteDocument> {
    const input = parseUpsert(value);
    assertSafeContent(input.content);
    const prior = this.#findIdentity(input);
    const noteId = prior?.noteId ?? `note-${createHash("sha256").update(identityKey(input)).digest("hex").slice(0, 24)}`;
    const document = NoteDocumentSchema.parse({
      frontmatter: {
        schemaVersion: 1,
        noteId,
        scope: input.scope,
        subjectId: input.subjectId,
        about: input.about,
        key: input.key,
        title: input.title,
        revision: (prior?.revision ?? 0) + 1,
        updatedAt: input.updatedAt ?? new Date().toISOString(),
      },
      content: input.content.trim(),
    });
    const target = this.#pathFor(document.frontmatter);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(serializeNote(document), "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, target);
      this.database.injectFailure("note_after_rename_before_index");
      const entry = this.#entry(document, target);
      this.database.transaction(() => this.#putIndex(entry));
      return document;
    } catch (error) {
      try { await handle?.close(); } catch { /* preserve original error */ }
      try { await unlink(temporary); } catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") { /* repaired on startup */ }
      }
      if (isStorageError(error)) throw error;
      throw new StorageError("artifact_write_failed", `Atomic note write failed; startup reconciliation will repair committed Markdown: ${errorMessage(error)}`, { target }, { cause: error });
    }
  }

  async read(noteId: string): Promise<NoteDocument | null> {
    const entry = this.#getIndex(noteId);
    if (!entry) return null;
    const path = this.#resolveIndexedPath(entry.markdownPath);
    let source: string;
    try {
      source = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.database.handle.prepare("DELETE FROM note_index WHERE note_id = ?").run(noteId);
        return null;
      }
      throw error;
    }
    const document = parseNote(source, path);
    this.#assertPathIdentity(document, path);
    const actual = this.#entry(document, path);
    if (actual.noteId !== entry.noteId || actual.contentHash !== entry.contentHash || actual.revision !== entry.revision) {
      this.database.transaction(() => this.#putIndex(actual));
    }
    return document;
  }

  list(filter: NoteListFilter = {}): NoteIndexEntry[] {
    const clauses: string[] = [];
    const values: string[] = [];
    if (filter.scope) { clauses.push("scope = ?"); values.push(filter.scope); }
    if (filter.subjectId) { clauses.push("subject_id = ?"); values.push(filter.subjectId); }
    if (filter.about) { clauses.push("about = ?"); values.push(filter.about); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.database.handle.prepare(`SELECT record_json FROM note_index ${where} ORDER BY scope, subject_id, about, note_key, updated_at, note_id`).all(...values) as unknown as Array<{ record_json: string }>;
    return rows.map((row) => parseIndex(row.record_json));
  }

  async search(query: string, allowed: readonly NoteListFilter[], limit = NOTE_SEARCH_LIMIT): Promise<Array<{ entry: NoteIndexEntry; preview: string }>> {
    const terms = [...new Set(query.toLocaleLowerCase().split(/[^\p{L}\p{N}._-]+/u).filter((term) => term.length > 1))];
    if (terms.length === 0) return [];
    const candidates = uniqueEntries(allowed.flatMap((filter) => this.list(filter)));
    const matches: Array<{ entry: NoteIndexEntry; preview: string; score: number }> = [];
    for (const entry of candidates) {
      const document = await this.read(entry.noteId);
      if (!document) continue;
      const haystack = `${entry.title}\n${entry.key}\n${document.content}`.toLocaleLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      if (score) matches.push({ entry, preview: document.content.slice(0, 500), score });
    }
    return matches.sort((left, right) => right.score - left.score || compareEntries(left.entry, right.entry)).slice(0, Math.max(1, Math.min(limit, NOTE_SEARCH_LIMIT))).map(({ entry, preview }) => ({ entry, preview }));
  }

  #walk(directory: string, depth: number, entries: NoteIndexEntry[], noteIds: Set<string>): void {
    for (const child of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, child.name);
      const metadata = lstatSync(path);
      if (metadata.isSymbolicLink()) throw invalidTree("Note storage contains a symbolic link", path);
      if (child.isDirectory()) {
        if (depth >= 3 || !safeSegment.test(child.name)) throw invalidTree("Note storage contains an invalid directory", path);
        this.#walk(path, depth + 1, entries, noteIds);
        continue;
      }
      if (child.name.endsWith(".tmp")) { unlinkSync(path); continue; }
      if (!child.isFile() || depth !== 3 || !markdownFile.test(child.name)) throw invalidTree("Note storage contains an unexpected file", path);
      const document = parseNote(readFileSync(path, "utf8"), path);
      this.#assertPathIdentity(document, path);
      if (noteIds.has(document.frontmatter.noteId)) throw invalidTree("Two note files claim the same note id", path);
      noteIds.add(document.frontmatter.noteId);
      entries.push(this.#entry(document, path));
    }
  }

  #scanNotes(): NoteIndexEntry[] {
    if (!readdirSafe(this.rootDirectory)) return [];
    const entries: NoteIndexEntry[] = [];
    this.#walk(this.rootDirectory, 0, entries, new Set<string>());
    return entries;
  }

  #assertPathIdentity(document: NoteDocument, path: string): void {
    const parts = relative(this.rootDirectory, path).split(sep);
    const expected = [document.frontmatter.scope, document.frontmatter.subjectId, document.frontmatter.about, `${document.frontmatter.key}.md`];
    if (parts.length !== 4 || parts.some((part, index) => part !== expected[index])) throw invalidTree("Note frontmatter identity does not match its path", path);
  }

  #pathFor(identity: NoteIdentity): string {
    const parsed = parseIdentity(identity);
    const target = resolve(this.rootDirectory, parsed.scope, parsed.subjectId, parsed.about, `${parsed.key}.md`);
    if (!target.toLocaleLowerCase().startsWith(`${this.rootDirectory}${sep}`.toLocaleLowerCase())) throw invalidTree("Note path escaped its owned directory", target);
    return target;
  }

  #resolveIndexedPath(markdownPath: string): string {
    const target = resolve(this.rootDirectory, markdownPath);
    if (!target.toLocaleLowerCase().startsWith(`${this.rootDirectory}${sep}`.toLocaleLowerCase())) throw invalidTree("Indexed note path escaped its owned directory", target);
    return target;
  }

  #entry(document: NoteDocument, path: string): NoteIndexEntry {
    return NoteIndexEntrySchema.parse({ ...document.frontmatter, markdownPath: relative(this.rootDirectory, path).split(sep).join("/"), contentHash: createHash("sha256").update(document.content).digest("hex") });
  }

  #findIdentity(identity: NoteIdentity): NoteIndexEntry | null {
    const parsed = parseIdentity(identity);
    const row = this.database.handle.prepare("SELECT record_json FROM note_index WHERE scope = ? AND subject_id = ? AND about = ? AND note_key = ?").get(parsed.scope, parsed.subjectId, parsed.about, parsed.key) as { record_json: string } | undefined;
    return row ? parseIndex(row.record_json) : null;
  }

  #getIndex(noteId: string): NoteIndexEntry | null {
    const row = this.database.handle.prepare("SELECT record_json FROM note_index WHERE note_id = ?").get(noteId) as { record_json: string } | undefined;
    return row ? parseIndex(row.record_json) : null;
  }

  #putIndex(entry: NoteIndexEntry): void {
    const record = NoteIndexEntrySchema.parse(entry);
    this.database.handle.prepare(`INSERT INTO note_index(note_id, scope, subject_id, about, note_key, title, markdown_path, revision, content_hash, updated_at, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(scope, subject_id, about, note_key) DO UPDATE SET note_id = excluded.note_id, title = excluded.title, markdown_path = excluded.markdown_path, revision = excluded.revision, content_hash = excluded.content_hash, updated_at = excluded.updated_at, record_json = excluded.record_json`).run(record.noteId, record.scope, record.subjectId, record.about, record.key, record.title, record.markdownPath, record.revision, record.contentHash, record.updatedAt, JSON.stringify(record));
  }
}

function parseUpsert(value: unknown): NoteUpsertInput {
  const input = value as Partial<NoteUpsertInput>;
  const identity = parseIdentity(input);
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const content = typeof input.content === "string" ? escapeHtmlTags(input.content.trim()) : "";
  if (!title || title.length > 200) throw new TypeError("Note title must be between 1 and 200 characters");
  if (!content || content.length > NOTE_BODY_LIMIT) throw new TypeError(`Note content must be between 1 and ${NOTE_BODY_LIMIT} characters`);
  if (input.updatedAt !== undefined && Number.isNaN(Date.parse(input.updatedAt))) throw new TypeError("Note updatedAt must be an ISO timestamp");
  return { ...identity, title, content, ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}) };
}

function assertSafeContent(content: string): void {
  if (/<\/?[A-Za-z][^>]*>/.test(content)) throw new TypeError("Notes may contain Markdown but not HTML");
  if (credentialCanaries.some((pattern) => pattern.test(content))) throw new TypeError("Credential-bearing values cannot be saved in notes");
}

function escapeHtmlTags(content: string): string {
  return content.replace(/<\/?[A-Za-z][^>]*>/g, (tag) => tag.replaceAll("<", "&lt;").replaceAll(">", "&gt;"));
}

function serializeNote(document: NoteDocument): string { return `---\n${stringify(document.frontmatter, { lineWidth: 0 })}---\n${document.content.trim()}\n`; }

function parseNote(source: string, path: string): NoteDocument {
  try {
    if (!source.startsWith("---\n")) throw new Error("Missing opening frontmatter delimiter");
    const closingOffset = source.indexOf("\n---\n", 4);
    if (closingOffset === -1) throw new Error("Missing closing frontmatter delimiter");
    const parsed = parseDocument(source.slice(4, closingOffset), { schema: "core", uniqueKeys: true });
    if (parsed.errors.length) throw new Error(parsed.errors.map((error) => error.message).join("; "));
    const frontmatter = NoteFrontmatterSchema.parse(parsed.toJS({ maxAliasCount: 0 }));
    const content = source.slice(closingOffset + 5).trim();
    assertSafeContent(content);
    return NoteDocumentSchema.parse({ frontmatter, content });
  } catch (error) {
    throw new StorageError("malformed_frontmatter", `Malformed note in ${path}: ${errorMessage(error)}`, { path }, { cause: error });
  }
}

function parseIndex(source: string): NoteIndexEntry {
  try { return NoteIndexEntrySchema.parse(JSON.parse(source)); }
  catch (error) { throw new StorageError("record_validation_failed", `Stored note index failed validation: ${errorMessage(error)}`, {}, { cause: error }); }
}

function identityKey(identity: NoteIdentity): string { return `${identity.scope}/${identity.subjectId}/${identity.about}/${identity.key}`; }
function parseIdentity(identity: Partial<NoteIdentity>): NoteIdentity {
  return NoteIdentitySchema.parse({ scope: identity.scope, subjectId: identity.subjectId, about: identity.about, key: identity.key });
}
function compareEntries(left: NoteIndexEntry, right: NoteIndexEntry): number { return identityKey(left).localeCompare(identityKey(right)) || left.noteId.localeCompare(right.noteId); }
function uniqueEntries(entries: readonly NoteIndexEntry[]): NoteIndexEntry[] { return [...new Map(entries.map((entry) => [entry.noteId, entry])).values()]; }
function invalidTree(message: string, path: string): StorageError { return new StorageError("backup_invalid", message, { path }); }
function readdirSafe(path: string): boolean {
  try { return lstatSync(path).isDirectory(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
