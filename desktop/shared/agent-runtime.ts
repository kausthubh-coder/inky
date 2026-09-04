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
  arguments: z.unknown().optional(),
});

const AgentToolFinishedEventSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  type: z.literal("tool_finished"),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  outcome: z.enum(["succeeded", "failed"]),
  result: z.unknown().optional(),
  durationMs: z.number().int().nonnegative().optional(),
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

export const AgentReasoningEffortSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]);
export const DEFAULT_AGENT_MODEL_ID = "gpt-5.6-sol";
export const DEFAULT_AGENT_REASONING_EFFORT = "high" as const;

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
export type AgentReasoningEffort = z.infer<typeof AgentReasoningEffortSchema>;
export type ProviderLoginMethod = z.infer<typeof ProviderLoginMethodSchema>;
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;
export type AgentRuntimeAttention = "none" | "needs_login" | "usage" | "unavailable";

const USAGE_MARKERS = [
  "quota",
  "rate limit",
  "ratelimit",
  "usage limit",
  "usage cap",
  "out of usage",
  "usage exhausted",
  "insufficient quota",
  "insufficient credit",
  "billing",
  "token limit",
  "monthly limit",
  "weekly limit",
  "limit reached",
  "ran out of",
  "429",
] as const;

const LOGIN_MARKERS = [
  "needs authentication",
  "unauthorized",
  "401",
  "invalid token",
  "expired token",
  "refresh token",
  "sign in to chatgpt",
  "sign in to openai",
  "codex needs",
  "re-auth",
  "reauth",
] as const;

export function classifyAgentRuntimeAttention(
  provider?: Pick<ProviderStatus, "state" | "reason"> | null,
  failureText?: string | null,
): AgentRuntimeAttention {
  const combined = [provider?.reason, failureText].filter((item): item is string => Boolean(item)).join("\n");
  const fact = combined.toLocaleLowerCase();
  if (USAGE_MARKERS.some((marker) => fact.includes(marker))) return "usage";
  if (provider?.state === "needs_login") return "needs_login";
  if (LOGIN_MARKERS.some((marker) => fact.includes(marker))) return "needs_login";
  if (provider?.state === "unavailable") return "unavailable";
  return "none";
}

export function agentRuntimeAttentionCopy(kind: AgentRuntimeAttention): { title: string; body: string } | null {
  if (kind === "usage") {
    return {
      title: "ChatGPT usage ran out.",
      body: "I can't type in the school browser until that plan has usage again. Wait a bit, or connect another ChatGPT.",
    };
  }
  if (kind === "needs_login") {
    return {
      title: "Codex needs you again.",
      body: "That ChatGPT login expired or switched. Open the page, enter this code. I never see your password.",
    };
  }
  if (kind === "unavailable") {
    return {
      title: "Codex isn't reachable.",
      body: "I couldn't check the ChatGPT connection. Try again in a moment, or reconnect Codex.",
    };
  }
  return null;
}
