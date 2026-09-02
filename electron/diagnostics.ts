import { writeFile } from "node:fs/promises";

import {
  TelemetryInspectorEnvelopeSchema,
  type TelemetryInspectorEnvelope,
} from "../shared/index.js";
import type { StorageHealth } from "./storage/index.js";

const safePropertyKeys = new Set([
  "action",
  "app_version",
  "assignment_count",
  "beta_debug",
  "boundary",
  "cadence",
  "channel",
  "code",
  "configured",
  "course_count",
  "debug_summary",
  "duration_ms",
  "enabled",
  "kind",
  "launch",
  "linked_system_count",
  "mode",
  "operation",
  "phase",
  "platform",
  "reason",
  "replay_enabled",
  "section",
  "setting",
  "state",
  "status",
  "step",
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
      policy: "main-process-allowlist-v1",
      includes: ["runtime versions", "storage health", "redacted recent diagnostic events"],
      excludes: [
        "credentials and tokens",
        "school URLs and page content",
        "prompts and answer artifacts",
        "cookies and OAuth state",
        "filesystem paths and account identifiers",
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
    diagnostics: input.diagnostics.slice(-30).map(redactDiagnostic),
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

function redactDiagnostic(rawEnvelope: TelemetryInspectorEnvelope) {
  const envelope = TelemetryInspectorEnvelopeSchema.parse(rawEnvelope);
  const properties = Object.fromEntries(
    Object.entries(envelope.properties)
      .filter(([key]) => safePropertyKeys.has(key))
      .map(([key, value]) => [key, typeof value === "string" ? redactString(value) : value]),
  );
  return {
    capturedAt: envelope.capturedAt,
    event: envelope.event,
    properties,
  };
}

function redactString(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/[A-Z]:\\[^\s]+/gi, "[redacted-path]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(/\b(?:bearer|token|password|cookie|client_secret|oauth|authorization)\b(?:\s*[:=]?\s*\S+)?/gi, "[redacted]")
    .slice(0, 120);
}
