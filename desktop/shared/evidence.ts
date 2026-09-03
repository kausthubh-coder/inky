import { z } from "zod";

import { EvidenceIdSchema, SafeSourceTargetSchema } from "./ids.js";
import { IsoTimestampSchema, SchemaVersionSchema } from "./schema-version.js";

export const EvidenceKindSchema = z.enum([
  "screenshot",
  "text_snapshot",
  "document",
  "agent_observation",
]);

export const EvidenceReferenceSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  evidenceId: EvidenceIdSchema,
  reference: EvidenceIdSchema,
  kind: EvidenceKindSchema,
  sourceTarget: SafeSourceTargetSchema,
  capturedAt: IsoTimestampSchema,
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  summary: z.string().min(1).max(2_000).optional(),
});

export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;
