import { z } from "zod";

import { IsoTimestampSchema, SchemaVersionSchema } from "./schema-version.js";

export const NoteScopeSchema = z.enum(["student", "school", "course", "pattern", "assignment"]);
export const NoteAboutSchema = z.enum(["preference", "scan", "how-to", "knowledge", "work"]);
export const NoteSegmentSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/);

export const NoteFrontmatterSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  noteId: NoteSegmentSchema,
  scope: NoteScopeSchema,
  subjectId: NoteSegmentSchema,
  about: NoteAboutSchema,
  key: NoteSegmentSchema,
  title: z.string().trim().min(1).max(200),
  revision: z.number().int().positive(),
  updatedAt: IsoTimestampSchema,
});

export const NoteDocumentSchema = z.strictObject({
  frontmatter: NoteFrontmatterSchema,
  content: z.string().trim().min(1).max(100_000),
});

export const NoteIndexEntrySchema = NoteFrontmatterSchema.extend({
  markdownPath: z.string().trim().min(1).max(1_024),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const NoteIdentitySchema = NoteFrontmatterSchema.pick({
  scope: true,
  subjectId: true,
  about: true,
  key: true,
});

export type NoteScope = z.infer<typeof NoteScopeSchema>;
export type NoteAbout = z.infer<typeof NoteAboutSchema>;
export type NoteFrontmatter = z.infer<typeof NoteFrontmatterSchema>;
export type NoteDocument = z.infer<typeof NoteDocumentSchema>;
export type NoteIndexEntry = z.infer<typeof NoteIndexEntrySchema>;
export type NoteIdentity = z.infer<typeof NoteIdentitySchema>;
