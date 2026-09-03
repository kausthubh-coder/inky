import { z } from "zod";

import { EvidenceReferenceSchema } from "./evidence.js";
import {
  IdempotencyKeySchema,
  RunIdSchema,
  TabIdSchema,
  TaskIdSchema,
  ToolCallIdSchema,
} from "./ids.js";
import { SchemaVersionSchema } from "./schema-version.js";

export const ToolMutationEnvelopeSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  toolCallId: ToolCallIdSchema,
  taskId: TaskIdSchema,
  runId: RunIdSchema,
  tabId: TabIdSchema,
  idempotencyKey: IdempotencyKeySchema,
  expectedPageRevision: z.number().int().nonnegative(),
});

export const ToolResultEnvelopeSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  toolCallId: ToolCallIdSchema,
  taskId: TaskIdSchema,
  runId: RunIdSchema,
  tabId: TabIdSchema,
  idempotencyKey: IdempotencyKeySchema,
  pageRevision: z.number().int().nonnegative(),
  outcome: z.enum(["succeeded", "rejected", "failed"]),
  evidence: z.array(EvidenceReferenceSchema),
});

export type ToolMutationEnvelope = z.infer<typeof ToolMutationEnvelopeSchema>;
export type ToolResultEnvelope = z.infer<typeof ToolResultEnvelopeSchema>;
