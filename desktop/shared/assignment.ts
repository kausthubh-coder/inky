import { z } from "zod";

import { EvidenceReferenceSchema } from "./evidence.js";
import { AssignmentIdSchema, CourseIdSchema, SafeSourceTargetSchema } from "./ids.js";
import { IsoTimestampSchema, SchemaVersionSchema } from "./schema-version.js";

export const AssignmentSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  assignmentId: AssignmentIdSchema,
  courseId: CourseIdSchema,
  title: z.string().min(1).max(500),
  sourceTarget: SafeSourceTargetSchema,
  sourceIdentity: z.string().min(1).max(4096).optional(),
  dueAt: IsoTimestampSchema.optional(),
  dueText: z.string().min(1).max(200).optional(),
  instructions: z.string().min(1).max(8000).optional(),
  discoveredAt: IsoTimestampSchema,
  lastVerifiedScanId: z.string().min(1).max(256).optional(),
  evidence: z.array(EvidenceReferenceSchema),
});

export type Assignment = z.infer<typeof AssignmentSchema>;
