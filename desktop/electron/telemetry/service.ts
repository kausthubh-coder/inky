import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { PostHog } from "posthog-node";
import { z } from "zod";

import { AgentTraceEventSchema, type AgentTrace, type AgentTraceEvent } from "../../agent-system/index.js";
import {
  AgentReasoningEffortSchema,
  TelemetryAgentFactsSchema,
  TelemetryEventNameSchema,
  TelemetryInspectorEnvelopeSchema,
  TelemetryStateSchema,
  type TelemetryEventName,
  type TelemetryInspectorEnvelope,
  type TelemetryState,
} from "../../shared/index.js";

const OpaqueIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const agentFacts = TelemetryAgentFactsSchema.shape;
const PersonPropertySchema = z.union([z.string().max(2_000), z.number().finite(), z.boolean()]);
const PersonPropertiesSchema = z.object({
  email: z.string().max(320).optional(),
  name: z.string().max(200).optional(),
  student_name: z.string().max(100).optional(),
  school_root: z.string().max(2_000).optional(),
  selected_model: z.string().max(128).optional(),
  selected_reasoning: AgentReasoningEffortSchema.optional(),
  plan: z.string().max(128).optional(),
  credits: z.number().finite().nonnegative().optional(),
  device_id: z.string().max(256).optional(),
  os_version: z.string().max(256).optional(),
  locale: z.string().max(64).optional(),
  timezone: z.string().max(128).optional(),
  onboarding_state: z.string().max(128).optional(),
  connected_toolkits: z.string().max(20_000).optional(),
}).strict();

export const telemetryEventSchemas = {
  studi_app_started: z.strictObject({ launch: z.literal("desktop") }),
  studi_auth_gate: z.strictObject({
    status: z.enum(["checking", "signed_out", "signing_in", "approved", "offline", "denied", "error"]),
    reason: z.enum(["waitlist", "device_conflict", "unavailable", "none"]).optional(),
    email: z.string().max(320).optional(),
    name: z.string().max(200).optional(),
  }),
  studi_onboarding_step: z.strictObject({
    step: z.enum(["profile_saved", "school_browser_opened", "feedback_recorded"]),
    cadence: z.enum(["manual", "daily", "weekly"]).optional(),
    student_name: z.string().max(100).optional(),
    school_root: z.string().max(100_000).optional(),
  }),
  studi_scan_started: z.strictObject({
    mode: z.enum(["start", "resume", "replay", "scheduled"]),
    model: agentFacts.model,
    reasoning_effort: agentFacts.reasoning_effort,
    student_name: z.string().max(100).optional(),
    school_root: z.string().max(2_000).optional(),
  }),
  studi_scan_finished: z.strictObject({
    mode: z.enum(["start", "resume", "replay", "scheduled"]),
    state: z.enum(["running", "needs_user", "succeeded", "partial", "failed"]),
    duration_ms: z.number().int().nonnegative(),
    course_count: z.number().int().nonnegative(),
    assignment_count: z.number().int().nonnegative(),
    linked_system_count: z.number().int().nonnegative(),
    model: agentFacts.model,
    reasoning_effort: agentFacts.reasoning_effort,
    input_tokens: agentFacts.input_tokens,
    output_tokens: agentFacts.output_tokens,
    cache_read_tokens: agentFacts.cache_read_tokens,
    cache_write_tokens: agentFacts.cache_write_tokens,
    total_tokens: agentFacts.total_tokens,
    cost_usd: agentFacts.cost_usd,
    tool_calls: agentFacts.tool_calls,
    first_token_ms: agentFacts.first_token_ms,
    model_duration_ms: agentFacts.model_duration_ms,
    tool_duration_ms: agentFacts.tool_duration_ms,
    total_duration_ms: agentFacts.total_duration_ms,
    error_count: agentFacts.error_count,
    student_name: z.string().max(100).optional(),
    school_root: z.string().max(100_000).optional(),
    course_titles: z.string().max(100_000).optional(),
    scan_id: OpaqueIdSchema.optional(),
    failure_count: z.number().int().nonnegative().optional(),
    current_step: z.string().max(100_000).optional(),
  }),
  studi_dashboard_viewed: z.strictObject({ section: z.enum(["auth_gate", "workspace"]) }),
  studi_queue_transition: z.strictObject({
    action: z.enum(["manager_turn", "assignment_start", "assignment_resume", "submission_verify", "schedule_pause", "schedule_resume"]),
    phase: z.enum(["idle", "working", "needs_user", "ready_review", "submitting", "submitted", "preserved", "failed"]),
    task_id: OpaqueIdSchema.optional(),
    model: agentFacts.model,
    reasoning_effort: agentFacts.reasoning_effort,
    assignment_title: z.string().max(500).optional(),
    course_label: z.string().max(300).optional(),
  }),
  studi_assignment_finished: z.strictObject({
    task_id: OpaqueIdSchema,
    phase: z.enum(["needs_user", "ready_review", "submitted", "preserved", "failed"]),
    assignment_title: z.string().max(500).optional(),
    course_label: z.string().max(300).optional(),
    model: agentFacts.model,
    reasoning_effort: agentFacts.reasoning_effort,
    duration_ms: agentFacts.duration_ms,
    input_tokens: agentFacts.input_tokens,
    output_tokens: agentFacts.output_tokens,
    cache_read_tokens: agentFacts.cache_read_tokens,
    cache_write_tokens: agentFacts.cache_write_tokens,
    total_tokens: agentFacts.total_tokens,
    cost_usd: agentFacts.cost_usd,
    tool_calls: agentFacts.tool_calls,
    first_token_ms: agentFacts.first_token_ms,
    model_duration_ms: agentFacts.model_duration_ms,
    tool_duration_ms: agentFacts.tool_duration_ms,
    total_duration_ms: agentFacts.total_duration_ms,
    error_count: agentFacts.error_count,
  }),
  studi_model_selected: z.strictObject({
    model: z.string().min(1).max(128),
    reasoning_effort: AgentReasoningEffortSchema,
  }),
  studi_handoff: z.strictObject({ kind: z.enum(["scan", "assignment"]), state: z.literal("needs_user") }),
  studi_review: z.strictObject({ state: z.enum(["ready_review", "submitted"]) }),
  studi_fallback: z.strictObject({ kind: z.literal("answer_markdown"), task_id: OpaqueIdSchema }),
  studi_setting_changed: z.strictObject({
    setting: z.enum(["analytics", "replay", "beta_debug"]),
    enabled: z.boolean(),
  }),
  studi_feedback_sent: z.strictObject({ channel: z.enum(["beta_gate", "school_scan"]) }),
  studi_connected_app: z.strictObject({
    toolkit: z.string().min(1).max(128),
    operation: z.enum(["connect", "refresh"]),
    status: z.string().min(1).max(128),
    connected_account_id: z.string().min(1).max(256).optional(),
    duration_ms: z.number().int().nonnegative(),
  }),
  studi_error: z.strictObject({
    boundary: z.enum(["startup", "auth", "ipc", "scan", "queue", "renderer"]),
    operation: z.enum([
      "app_start",
      "sign_in",
      "sign_out",
      "entitlement_retry",
      "school_scan",
      "assignment",
      "manager",
      "ipc_request",
      "renderer_action",
    ]),
    code: z.enum([
      "auth_unavailable",
      "provider_not_ready",
      "needs_user",
      "invalid_input",
      "network_unavailable",
      "operation_failed",
    ]),
    message: z.string().max(100_000).optional(),
    debug_summary: z.string().max(1_000).optional(),
    model: agentFacts.model,
    reasoning_effort: agentFacts.reasoning_effort,
  }),
  studi_agent_trace: AgentTraceEventSchema,
} satisfies Record<TelemetryEventName, z.ZodType>;

type EventProperties<Name extends TelemetryEventName> = z.input<(typeof telemetryEventSchemas)[Name]>;
export type TelemetryPersonProperties = z.input<typeof PersonPropertiesSchema>;

const PersistedSettingsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  enabled: z.boolean(),
  replayEnabled: z.boolean(),
  anonymousId: z.string().uuid(),
  debugUntil: z.string().datetime().nullable(),
});

interface TelemetryClient {
  capture(message: {
    distinctId: string;
    event: string;
    properties: Record<string, unknown>;
    disableGeoip?: boolean;
  }): void;
  identify?(message: {
    distinctId: string;
    properties: Record<string, string | number | boolean | Record<string, string | number | boolean>>;
    disableGeoip?: boolean;
  }): void;
  shutdown(timeoutMs?: number): Promise<void>;
}

export interface TelemetryServiceOptions {
  readonly projectToken?: string;
  readonly host: "https://us.i.posthog.com" | "https://eu.i.posthog.com";
  readonly appVersion: string;
  readonly platform: NodeJS.Platform;
  readonly settingsPath: string;
  readonly now?: () => Date;
  readonly client?: TelemetryClient;
}

export class TelemetryService {
  readonly #projectToken: string | null;
  readonly #host: TelemetryServiceOptions["host"];
  readonly #appVersion: string;
  readonly #platform: NodeJS.Platform;
  readonly #settingsPath: string;
  readonly #now: () => Date;
  readonly #client: TelemetryClient | null;
  readonly #inspector: TelemetryInspectorEnvelope[] = [];
  #settings: z.infer<typeof PersistedSettingsSchema>;
  #distinctId: string;
  #identity: "anonymous" | "clerk" = "anonymous";
  #shutdown: Promise<void> | null = null;

  constructor(options: TelemetryServiceOptions) {
    this.#projectToken = options.projectToken?.trim() || null;
    this.#host = options.host;
    this.#appVersion = options.appVersion;
    this.#platform = options.platform;
    this.#settingsPath = options.settingsPath;
    this.#now = options.now ?? (() => new Date());
    this.#settings = readSettings(options.settingsPath);
    this.#distinctId = `anonymous-${this.#settings.anonymousId}`;
    this.#client = options.client ?? (this.#projectToken
      ? new PostHog(this.#projectToken, {
          host: this.#host,
          flushAt: 10,
          flushInterval: 5_000,
          privacyMode: false,
          enableExceptionAutocapture: false,
          before_send: (message) => sanitizeSdkMessage(message),
        })
      : null);
  }

  state(): TelemetryState {
    this.#expireDebug();
    return TelemetryStateSchema.parse({
      configured: this.#client !== null,
      enabled: this.#settings.enabled,
      replayEnabled: this.#settings.replayEnabled,
      identity: this.#identity,
      distinctId: this.#distinctId,
      debugUntil: this.#settings.debugUntil,
      rendererConfig: this.#client && this.#projectToken
        ? { projectToken: this.#projectToken, host: this.#host }
        : null,
      inspector: [...this.#inspector],
    });
  }

  capture<Name extends TelemetryEventName>(event: Name, input: EventProperties<Name>): boolean {
    try {
      const eventName = TelemetryEventNameSchema.parse(event);
      const properties = stripSecretProperties(
        telemetryEventSchemas[eventName].parse(input) as Record<string, unknown>,
      );
      this.#expireDebug();
      if (!this.#settings.enabled || !this.#client) return false;
      const envelope = TelemetryInspectorEnvelopeSchema.parse({
        capturedAt: this.#now().toISOString(),
        event: eventName,
        distinctId: this.#distinctId,
        properties: {
          app_version: this.#appVersion.slice(0, 64),
          platform: this.#platform,
          beta_debug: this.#settings.debugUntil !== null,
          ...properties,
        },
      });
      try {
        this.#client.capture({
          distinctId: envelope.distinctId,
          event: envelope.event,
          properties: envelope.properties,
          disableGeoip: true,
        });
      } catch {
        return false;
      }
      this.#inspector.push(envelope);
      if (this.#inspector.length > 30) this.#inspector.splice(0, this.#inspector.length - 30);
      return true;
    } catch {
      return false;
    }
  }

  captureTrace(event: AgentTraceEvent): boolean {
    return this.capture("studi_agent_trace", AgentTraceEventSchema.parse(event));
  }

  subscribeToTrace(trace: AgentTrace): () => void {
    return trace.subscribe((event) => {
      this.captureTrace(event);
    });
  }

  captureError(
    error: unknown,
    boundary: EventProperties<"studi_error">["boundary"],
    operation: EventProperties<"studi_error">["operation"],
    extras: Pick<EventProperties<"studi_error">, "model" | "reasoning_effort"> = {},
  ): boolean {
    const debugSummary = this.#isDebugActive() ? `${errorName(error)} stopped at ${boundary}` : undefined;
    return this.capture("studi_error", {
      boundary,
      operation,
      code: classifyError(error),
      message: stripSecrets(errorMessage(error)).slice(0, 100_000),
      ...(debugSummary ? { debug_summary: debugSummary } : {}),
      ...extras,
    });
  }

  identifyClerk(user: { readonly subject: string; readonly email?: string | null; readonly name?: string | null }): void {
    const previousId = this.#distinctId;
    this.#distinctId = z.string().min(1).max(256).regex(/^[A-Za-z0-9._:-]+$/).parse(user.subject);
    this.#identity = "clerk";
    this.setPerson({
      ...(user.email ? { email: user.email } : {}),
      ...(user.name ? { name: user.name } : {}),
      ...(previousId.startsWith("anonymous-") ? { $anon_distinct_id: previousId } : {}),
    });
  }

  setPerson(properties: TelemetryPersonProperties & { readonly $anon_distinct_id?: string }): void {
    if (!this.#settings.enabled || !this.#client?.identify) return;
    const { $anon_distinct_id, ...person } = properties;
    const parsed = PersonPropertiesSchema.parse(stripSecretProperties(person));
    const identifyProperties: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== undefined) identifyProperties[key] = value;
    }
    if ($anon_distinct_id) identifyProperties.$anon_distinct_id = $anon_distinct_id;
    try {
      this.#client.identify({
        distinctId: this.#distinctId,
        properties: identifyProperties,
        disableGeoip: true,
      });
    } catch {
      // Person updates must never block schoolwork.
    }
  }

  resetIdentity(): void {
    this.#settings = { ...this.#settings, anonymousId: randomUUID() };
    this.#distinctId = `anonymous-${this.#settings.anonymousId}`;
    this.#identity = "anonymous";
    this.#persist();
  }

  setPreferences(enabled: boolean, replayEnabled: boolean): TelemetryState {
    this.#settings = { ...this.#settings, enabled, replayEnabled };
    this.#persist();
    return this.state();
  }

  setDebug(durationMinutes: 0 | 30): TelemetryState {
    this.#settings = {
      ...this.#settings,
      debugUntil: durationMinutes === 0
        ? null
        : new Date(this.#now().getTime() + durationMinutes * 60_000).toISOString(),
    };
    this.#persist();
    return this.state();
  }

  shutdown(timeoutMs = 2_000): Promise<void> {
    if (!this.#client) return Promise.resolve();
    this.#shutdown ??= this.#client.shutdown(timeoutMs).catch(() => undefined);
    return this.#shutdown;
  }

  #isDebugActive(): boolean {
    this.#expireDebug();
    return this.#settings.debugUntil !== null;
  }

  #expireDebug(): void {
    if (!this.#settings.debugUntil || Date.parse(this.#settings.debugUntil) > this.#now().getTime()) return;
    this.#settings = { ...this.#settings, debugUntil: null };
    this.#persist();
  }

  #persist(): void {
    writeFileSync(this.#settingsPath, `${JSON.stringify(this.#settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}

function readSettings(path: string): z.infer<typeof PersistedSettingsSchema> {
  if (existsSync(path)) {
    try {
      return PersistedSettingsSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    } catch {
      // A malformed preference file falls back to privacy-preserving defaults.
    }
  }
  return {
    schemaVersion: 1,
    enabled: true,
    replayEnabled: true,
    anonymousId: randomUUID(),
    debugUntil: null,
  };
}

function classifyError(error: unknown): EventProperties<"studi_error">["code"] {
  const message = error instanceof Error ? error.message : "";
  if (/auth|clerk|sign.?in|entitlement/i.test(message)) return "auth_unavailable";
  if (/provider|codex subscription|model/i.test(message)) return "provider_not_ready";
  if (/needs? (?:the )?(?:student|user)|sign.?in required|waiting for/i.test(message)) return "needs_user";
  if (/invalid|malformed|parse|schema|expects?\s+\d/i.test(message) || error instanceof z.ZodError) return "invalid_input";
  if (/network|fetch|offline|unavailable|timed? out|ECONN/i.test(message)) return "network_unavailable";
  return "operation_failed";
}

function errorName(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown error";
  return /^[A-Za-z][A-Za-z0-9]*$/.test(error.name) ? error.name.slice(0, 48) : "Error";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Unknown error";
}

export function stripSecrets(value: string): string {
  return value
    .replace(/\bAuthorization\s*:\s*(?:Bearer|Basic)\s+\S+/gi, "Authorization: [secret]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[secret]")
    .replace(/\b(?:password|cookie|token|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|oauth[_-]?code|device[_-]?code)\s*[:=]\s*\S+/gi, "[secret]")
    .replace(/\b(?:sk|ak|pk)_[A-Za-z0-9_-]{8,}\b/g, "[secret]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[secret]");
}

function stripSecretProperties<T extends Record<string, unknown>>(properties: T): T {
  return sanitizeTelemetryValue(properties) as T;
}

const secretPropertyName = /^(?:authorization|password|cookie|set-cookie|token|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|oauth[_-]?code|device[_-]?code|clerk[_-]?token|provider[_-]?credential)$/i;

function sanitizeTelemetryValue(value: unknown): unknown {
  if (typeof value === "string") return stripSecrets(value);
  if (Array.isArray(value)) return value.map(sanitizeTelemetryValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      secretPropertyName.test(key) ? "[secret]" : sanitizeTelemetryValue(item),
    ]),
  );
}

function sanitizeSdkMessage(message: unknown) {
  if (!message || typeof message !== "object") return null;
  const record = message as Record<string, unknown>;
  const distinctIdResult = z.string().min(1).max(256).safeParse(record.distinctId);
  if (!distinctIdResult.success) return null;
  if (record.event === "$identify") {
    return sanitizeIdentifyMessage(distinctIdResult.data, record.properties);
  }
  const eventResult = TelemetryEventNameSchema.safeParse(record.event);
  if (!eventResult.success) return null;
  const properties = record.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return null;
  const propertyRecord = properties as Record<string, unknown>;
  const schema = telemetryEventSchemas[eventResult.data];
  const eventProperties = schema.safeParse(
    stripSecretProperties(pickSchemaProperties(eventResult.data, propertyRecord)),
  );
  const common = z.strictObject({
    app_version: z.string().max(64),
    platform: z.string().max(32),
    beta_debug: z.boolean(),
  }).safeParse({
    app_version: propertyRecord.app_version,
    platform: propertyRecord.platform,
    beta_debug: propertyRecord.beta_debug,
  });
  if (!eventProperties.success || !common.success) return null;
  return {
    distinctId: distinctIdResult.data,
    event: eventResult.data,
    properties: { ...common.data, ...eventProperties.data },
  };
}

function sanitizeIdentifyMessage(distinctId: string, properties: unknown) {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return null;
  const record = properties as Record<string, unknown>;
  const setSource = record.$set && typeof record.$set === "object" && !Array.isArray(record.$set)
    ? record.$set as Record<string, unknown>
    : record;
  const parsed = PersonPropertiesSchema.safeParse(stripSecretProperties({
    email: setSource.email,
    name: setSource.name,
    student_name: setSource.student_name,
    school_root: setSource.school_root,
    selected_model: setSource.selected_model,
    selected_reasoning: setSource.selected_reasoning,
    plan: setSource.plan,
    credits: setSource.credits,
    device_id: setSource.device_id,
    os_version: setSource.os_version,
    locale: setSource.locale,
    timezone: setSource.timezone,
    onboarding_state: setSource.onboarding_state,
    connected_toolkits: setSource.connected_toolkits,
  }));
  if (!parsed.success) return null;
  const anon = z.string().min(1).max(256).safeParse(record.$anon_distinct_id);
  return {
    distinctId,
    event: "$identify",
    properties: {
      $set: parsed.data,
      $set_once: {},
      ...(anon.success ? { $anon_distinct_id: anon.data } : {}),
    },
  };
}

function pickSchemaProperties(event: TelemetryEventName, properties: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys((telemetryEventSchemas[event] as z.ZodObject).shape);
  return Object.fromEntries(keys.map((key) => [key, properties[key]]).filter(([, value]) => value !== undefined));
}
