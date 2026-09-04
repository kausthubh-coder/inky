import { writeFile } from "node:fs/promises";

import {
  TelemetryInspectorEnvelopeSchema,
  type TelemetryInspectorEnvelope,
} from "../shared/index.js";
import type { StorageHealth } from "./storage/index.js";
import { stripSecrets } from "./telemetry/service.js";

const safePropertyKeys = new Set([
  "action",
  "app_version",
  "assignment_count",
  "assignment_title",
  "beta_debug",
  "boundary",
  "cache_read_tokens",
  "cache_write_tokens",
  "cadence",
  "channel",
  "code",
  "configured",
  "cost_usd",
  "course_count",
  "course_label",
  "course_titles",
  "current_step",
  "debug_summary",
  "duration_ms",
  "email",
  "enabled",
  "failure_count",
  "input_tokens",
  "kind",
  "launch",
  "linked_system_count",
  "message",
  "mode",
  "model",
  "name",
  "operation",
  "output_tokens",
  "phase",
  "platform",
  "reason",
  "reasoning_effort",
  "replay_enabled",
  "scan_id",
  "school_root",
  "section",
  "setting",
  "state",
  "status",
  "step",
  "student_name",
  "task_id",
  "tool_calls",
]);

export interface DiagnosticsSnapshotInput {
  readonly appVersion: string;
  readonly electronVersion: string;
  readonly chromeVersion: string;
  readonly nodeVersion: string;
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
  readonly packaged: boolean;
  readonly storage: StorageHealth;
  readonly telemetryConfigured: boolean;
  readonly telemetryEnabled: boolean;
  readonly replayEnabled: boolean;
  readonly diagnostics: readonly TelemetryInspectorEnvelope[];
  readonly now?: Date;
}

export function buildDiagnosticsSnapshot(input: DiagnosticsSnapshotInput) {
  const exportedAt = (input.now ?? new Date()).toISOString();
  return {
    manifest: {
      format: "studi-diagnostics",
      formatVersion: 1,
      exportedAt,
      policy: "typed-agent-trace-v2",
      includes: ["runtime versions", "storage health", "recent non-secret product and agent events"],
      excludes: [
        "credentials and tokens",
        "cookies and authorization headers",
        "OAuth and device codes",
        "provider credentials and secure-storage bytes",
      ],
    },
    runtime: {
      app: input.appVersion,
      electron: input.electronVersion,
      chrome: input.chromeVersion,
      node: input.nodeVersion,
      platform: input.platform,
      architecture: input.architecture,
      packaged: input.packaged,
    },
    storage: {
      status: input.storage.status,
      schemaVersion: input.storage.schemaVersion,
      integrity: input.storage.integrity,
    },
    telemetry: {
      configured: input.telemetryConfigured,
      enabled: input.telemetryEnabled,
      replayEnabled: input.replayEnabled,
    },
    diagnostics: input.diagnostics.slice(-30).map(sanitizeDiagnostic),
  } as const;
}

export async function writeDiagnosticsSnapshot(
  destination: string,
  snapshot: ReturnType<typeof buildDiagnosticsSnapshot>,
): Promise<void> {
  await writeFile(destination, `${JSON.stringify(snapshot, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function sanitizeDiagnostic(rawEnvelope: TelemetryInspectorEnvelope) {
  const envelope = TelemetryInspectorEnvelopeSchema.parse(rawEnvelope);
  const properties = envelope.event === "studi_agent_trace"
    ? JSON.parse(stripSecrets(JSON.stringify(envelope.properties)))
    : Object.fromEntries(
        Object.entries(envelope.properties)
          .filter(([key]) => safePropertyKeys.has(key))
          .map(([key, value]) => [key, typeof value === "string" ? stripSecrets(value) : value]),
      );
  return {
    capturedAt: envelope.capturedAt,
    event: envelope.event,
    properties,
  };
}
