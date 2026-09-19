import { z } from "zod";
import { NoteDocumentSchema, NoteFrontmatterSchema, NoteSegmentSchema } from "./note.js";

export const MemorySummarySchema = NoteFrontmatterSchema;
export const MemoryListSchema = z.array(MemorySummarySchema);
export const MemoryReadSchema = NoteDocumentSchema.nullable();
export const MemoryUpdateInputSchema = z.strictObject({
  noteId: NoteSegmentSchema, expectedRevision: z.number().int().positive(),
  title: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(100000),
});
export const MemoryDeleteInputSchema = z.strictObject({ noteId: NoteSegmentSchema, expectedRevision: z.number().int().positive() });
export const MemoryDeleteResultSchema = z.strictObject({ noteId: NoteSegmentSchema, deleted: z.literal(true) });
export type MemorySummary = z.infer<typeof MemorySummarySchema>;
export type MemoryUpdateInput = z.infer<typeof MemoryUpdateInputSchema>;
export type MemoryDeleteInput = z.infer<typeof MemoryDeleteInputSchema>;
