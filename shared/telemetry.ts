import { z } from "zod";

export const TelemetryEventNameSchema = z.enum([
  "studi_app_started",
  "studi_auth_gate",
  "studi_onboarding_step",
  "studi_scan_started",
  "studi_scan_finished",
  "studi_dashboard_viewed",
  "studi_queue_transition",
  "studi_handoff",
  "studi_review",
  "studi_fallback",
  "studi_setting_changed",
  "studi_feedback_sent",
  "studi_error",
]);

export const TelemetryPropertyValueSchema = z.union([
  z.string().max(256),
  z.number().finite(),
  z.boolean(),
]);

export const TelemetryInspectorEnvelopeSchema = z.strictObject({
  capturedAt: z.string().datetime(),
  event: TelemetryEventNameSchema,
  distinctId: z.string().min(1).max(256),
  properties: z.record(z.string().min(1).max(64), TelemetryPropertyValueSchema),
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

export type TelemetryEventName = z.infer<typeof TelemetryEventNameSchema>;
export type TelemetryInspectorEnvelope = z.infer<typeof TelemetryInspectorEnvelopeSchema>;
export type TelemetryState = z.infer<typeof TelemetryStateSchema>;
export type TelemetryPreferencesInput = z.infer<typeof TelemetryPreferencesInputSchema>;
export type TelemetryDebugInput = z.infer<typeof TelemetryDebugInputSchema>;
export type UiTelemetryInput = z.infer<typeof UiTelemetryInputSchema>;
