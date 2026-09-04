import { z } from "zod";

import { SchemaVersionSchema, STUDI_SCHEMA_VERSION } from "./schema-version.js";

export const UsageDaySchema = z.strictObject({
  date: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/),
  tokens: z.number().int().nonnegative(),
});

export const UsageStateSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  plan: z.enum(["beta", "supporter"]),
  tokenAllowance: z.number().int().positive(),
  totalTokens: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedTokens: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  inkyTurns: z.number().int().nonnegative(),
  assignmentsWorked: z.number().int().nonnegative(),
  days: z.array(UsageDaySchema).max(31),
  updatedAt: z.string().datetime().nullable(),
});

export const UsageEventKindSchema = z.enum([
  "conversation",
  "scan",
  "assignment_turn",
  "assignment_worked",
]);

export const UsageRecordInputSchema = z.strictObject({
  eventId: z.string().trim().min(1).max(256),
  occurredAt: z.string().datetime(),
  kind: UsageEventKindSchema,
  inputTokens: z.number().int().nonnegative().max(100_000_000),
  outputTokens: z.number().int().nonnegative().max(100_000_000),
  cacheReadTokens: z.number().int().nonnegative().max(100_000_000),
  cacheWriteTokens: z.number().int().nonnegative().max(100_000_000),
  toolCalls: z.number().int().nonnegative().max(100_000),
});

export type UsageDay = z.infer<typeof UsageDaySchema>;
export type UsageState = z.infer<typeof UsageStateSchema>;
export type UsageEventKind = z.infer<typeof UsageEventKindSchema>;
export type UsageRecordInput = z.infer<typeof UsageRecordInputSchema>;

export function emptyUsageState(period: string, plan: "beta" | "supporter"): UsageState {
  return UsageStateSchema.parse({
    schemaVersion: STUDI_SCHEMA_VERSION,
    period,
    plan,
    tokenAllowance: plan === "supporter" ? 5_000_000 : 1_000_000,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    toolCalls: 0,
    inkyTurns: 0,
    assignmentsWorked: 0,
    days: [],
    updatedAt: null,
  });
}
