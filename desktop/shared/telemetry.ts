import { z } from "zod";

import { AgentReasoningEffortSchema } from "./agent-runtime.js";

export const TelemetryEventNameSchema = z.enum([
  "studi_app_started",
  "studi_auth_gate",
  "studi_onboarding_step",
  "studi_scan_started",
  "studi_scan_finished",
  "studi_dashboard_viewed",
  "studi_queue_transition",
  "studi_assignment_finished",
  "studi_model_selected",
  "studi_handoff",
  "studi_review",
  "studi_fallback",
  "studi_setting_changed",
  "studi_feedback_sent",
  "studi_connected_app",
  "studi_error",
  "studi_agent_trace",
]);

export const TelemetryPropertyValueSchema = z.json();

export const TelemetryInspectorEnvelopeSchema = z.strictObject({
  capturedAt: z.string().datetime(),
  event: TelemetryEventNameSchema,
  distinctId: z.string().min(1).max(256),
  properties: z.record(z.string().min(1).max(128), TelemetryPropertyValueSchema),
});

export const TelemetryStateSchema = z.strictObject({
  configured: z.boolean(),
  enabled: z.boolean(),
  replayEnabled: z.boolean(),
  identity: z.enum(["anonymous", "clerk"]),
  distinctId: z.string().min(1).max(256),
  debugUntil: z.string().datetime().nullable(),
  rendererConfig: z.strictObject({
    projectToken: z.string().startsWith("phc_").max(256),
    host: z.enum(["https://us.i.posthog.com", "https://eu.i.posthog.com"]),
  }).nullable(),
  inspector: z.array(TelemetryInspectorEnvelopeSchema).max(30),
});

export const TelemetryPreferencesInputSchema = z.strictObject({
  enabled: z.boolean(),
  replayEnabled: z.boolean(),
});

export const TelemetryDebugInputSchema = z.strictObject({
  durationMinutes: z.union([z.literal(0), z.literal(30)]),
});

export const UiTelemetryInputSchema = z.discriminatedUnion("event", [
  z.strictObject({
    event: z.literal("dashboard_viewed"),
    section: z.enum(["auth_gate", "workspace"]),
  }),
]);

export const TelemetryAgentFactsSchema = z.strictObject({
  model: z.string().min(1).max(128).optional(),
  reasoning_effort: AgentReasoningEffortSchema.optional(),
  duration_ms: z.number().int().nonnegative().optional(),
  input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  cache_read_tokens: z.number().int().nonnegative().optional(),
  cache_write_tokens: z.number().int().nonnegative().optional(),
  total_tokens: z.number().int().nonnegative().optional(),
  cost_usd: z.number().finite().nonnegative().optional(),
  tool_calls: z.number().int().nonnegative().optional(),
  first_token_ms: z.number().int().nonnegative().nullable().optional(),
  model_duration_ms: z.number().int().nonnegative().optional(),
  tool_duration_ms: z.number().int().nonnegative().optional(),
  total_duration_ms: z.number().int().nonnegative().optional(),
  error_count: z.number().int().nonnegative().optional(),
});

export type TelemetryEventName = z.infer<typeof TelemetryEventNameSchema>;
export type TelemetryInspectorEnvelope = z.infer<typeof TelemetryInspectorEnvelopeSchema>;
export type TelemetryState = z.infer<typeof TelemetryStateSchema>;
export type TelemetryPreferencesInput = z.infer<typeof TelemetryPreferencesInputSchema>;
export type TelemetryDebugInput = z.infer<typeof TelemetryDebugInputSchema>;
export type UiTelemetryInput = z.infer<typeof UiTelemetryInputSchema>;
export type TelemetryAgentFacts = z.infer<typeof TelemetryAgentFactsSchema>;
