import { MemoryDeleteInputSchema, MemoryListSchema, MemoryUpdateInputSchema } from "../../shared/memory.js";
import { OpaqueIdSchema } from "../../shared/ids.js";
import type { NoteFrontmatter, NoteIndexEntry } from "../../shared/note.js";
import type { NoteStore } from "../storage/notes.js";

/** Trusted scoped ownership must come from main-process account data, never IPC args. */
export interface MemoryScopeAccess { scope: "school" | "course" | "pattern" | "assignment"; subjectId: string }
export class MemoryCoordinator {
  readonly #ownerSubject: string;
  #disposed = false;
  readonly #pending = new Set<Promise<unknown>>();
  constructor(private readonly notes: NoteStore, ownerSubject: string,
    private readonly ownedScopes: () => readonly MemoryScopeAccess[] = () => []) {
    this.#ownerSubject = OpaqueIdSchema.parse(ownerSubject);
  }
  list() {
    this.#assertUsable();
    return MemoryListSchema.parse(this.notes.list().filter(entry => this.#allowed(entry)).map(({ markdownPath: _path, contentHash: _hash, ...summary }) => summary));
  }
  async read(noteId: string) {
    return this.#track(async () => {
      this.#requireOwned(noteId);
      const note = await this.notes.read(noteId);
      this.#assertUsable();
      if (note && !this.#allowed(note.frontmatter)) throw new Error("Memory is not available for this account");
      return note;
    });
  }
  async update(value: unknown) {
    return this.#track(async () => {
      const input = MemoryUpdateInputSchema.parse(value), entry = this.#requireOwned(input.noteId);
      return this.notes.upsert({ scope: entry.scope, subjectId: entry.subjectId, about: entry.about, key: entry.key, title: input.title, content: input.content },
        { expectedRevision: input.expectedRevision, assertAuthorized: () => this.#requireOwned(input.noteId) });
    });
  }
  async delete(value: unknown) {
    return this.#track(async () => {
      const input = MemoryDeleteInputSchema.parse(value);
      this.#requireOwned(input.noteId);
      await this.notes.delete(input.noteId, input.expectedRevision, () => this.#requireOwned(input.noteId));
      return { noteId: input.noteId, deleted: true as const };
    });
  }
  async dispose(): Promise<void> {
    this.#disposed = true;
    await Promise.allSettled([...this.#pending]);
    await this.notes.drain();
  }
  #track<T>(operation: () => Promise<T>): Promise<T> {
    this.#assertUsable();
    const pending = Promise.resolve().then(operation);
    this.#pending.add(pending);
    void pending.then(() => this.#pending.delete(pending), () => this.#pending.delete(pending));
    return pending;
  }
  #allowed(note: NoteFrontmatter): boolean {
    if (note.scope === "student") return note.subjectId === this.#ownerSubject && note.about === "preference";
    return this.ownedScopes().some(scope => scope.scope === note.scope && scope.subjectId === note.subjectId);
  }
  #requireOwned(noteId: string): NoteIndexEntry {
    this.#assertUsable();
    const entry = this.notes.list().find(note => note.noteId === noteId && this.#allowed(note));
    if (!entry) throw new Error("Memory is not available for this account");
    return entry;
  }
  #assertUsable(): void { if (this.#disposed) throw new Error("Memory coordinator is disposed"); }
}
