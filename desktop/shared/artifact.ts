import { z } from "zod";

import { OpaqueIdSchema } from "./ids.js";
import { IsoTimestampSchema, SchemaVersionSchema } from "./schema-version.js";

export const ArtifactKindSchema = z.enum(["preference", "memory", "workflow", "answer"]);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

const ArtifactFrontmatterBaseSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  artifactId: OpaqueIdSchema,
  updatedAt: IsoTimestampSchema,
});

export const PreferenceArtifactFrontmatterSchema = ArtifactFrontmatterBaseSchema.extend({
  kind: z.literal("preference"),
});

export const MemoryArtifactFrontmatterSchema = ArtifactFrontmatterBaseSchema.extend({
  kind: z.literal("memory"),
});

export const WorkflowArtifactFrontmatterSchema = ArtifactFrontmatterBaseSchema.extend({
  kind: z.literal("workflow"),
  revision: z.number().int().positive().optional(),
});

export const AnswerArtifactFrontmatterSchema = ArtifactFrontmatterBaseSchema.extend({
  kind: z.literal("answer"),
});

export const ArtifactFrontmatterSchema = z.discriminatedUnion("kind", [
  PreferenceArtifactFrontmatterSchema,
  MemoryArtifactFrontmatterSchema,
  WorkflowArtifactFrontmatterSchema,
  AnswerArtifactFrontmatterSchema,
]);

export const ArtifactDocumentSchema = z.strictObject({
  frontmatter: ArtifactFrontmatterSchema,
  content: z.string(),
});

export type ArtifactFrontmatter = z.infer<typeof ArtifactFrontmatterSchema>;
export type ArtifactDocument = z.infer<typeof ArtifactDocumentSchema>;
