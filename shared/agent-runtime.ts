import { z } from "zod";

import { SchemaVersionSchema } from "./schema-version.js";

const AgentTextEventSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  type: z.literal("text"),
  delta: z.string().min(1),
});

const AgentToolStartedEventSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  type: z.literal("tool_started"),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
});

const AgentToolFinishedEventSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  type: z.literal("tool_finished"),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  outcome: z.enum(["succeeded", "failed"]),
});

const AgentRetryStartedEventSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  type: z.literal("retry"),
  phase: z.literal("started"),
  attempt: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  delayMs: z.number().int().nonnegative(),
  reason: z.string().min(1),
});

const AgentRetryFinishedEventSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  type: z.literal("retry"),
  phase: z.literal("finished"),
  attempt: z.number().int().positive(),
  outcome: z.enum(["succeeded", "failed"]),
  reason: z.string().min(1).optional(),
});

const AgentCompactionStartedEventSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  type: z.literal("compaction"),
  phase: z.literal("started"),
  reason: z.enum(["manual", "threshold", "overflow"]),
});

const AgentCompactionFinishedEventSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  type: z.literal("compaction"),
  phase: z.literal("finished"),
  reason: z.enum(["manual", "threshold", "overflow"]),
  outcome: z.enum(["completed", "aborted", "failed"]),
});

const AgentAbortedEventSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  type: z.literal("aborted"),
});

const AgentTerminalEventSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  type: z.literal("terminal"),
  outcome: z.enum(["completed", "failed", "aborted"]),
  reason: z.string().min(1).optional(),
});

export const AgentRunEventSchema = z.union([
  AgentTextEventSchema,
  AgentToolStartedEventSchema,
  AgentToolFinishedEventSchema,
  AgentRetryStartedEventSchema,
  AgentRetryFinishedEventSchema,
  AgentCompactionStartedEventSchema,
  AgentCompactionFinishedEventSchema,
  AgentAbortedEventSchema,
  AgentTerminalEventSchema,
]);

export const ProviderLoginMethodSchema = z.enum(["api_key", "oauth"]);

export const ProviderStatusSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  providerId: z.string().min(1),
  providerName: z.string().min(1),
  state: z.enum(["ready", "needs_login", "unavailable"]),
  loginMethods: z.array(ProviderLoginMethodSchema),
  reason: z.string().min(1),
});

export type AgentRunEvent = z.infer<typeof AgentRunEventSchema>;
export type ProviderLoginMethod = z.infer<typeof ProviderLoginMethodSchema>;
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;
