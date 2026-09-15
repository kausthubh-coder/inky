import { createHash } from "node:crypto";
import type { Effect } from "./domain.js";

export interface TelemetryExport {
  runId: string;
  scenarioId: string;
  scenarioVersion: number;
  events: Effect[];
}
export function telemetryBatch(input: TelemetryExport) {
  return input.events.map((event) => {
    const hash = createHash("sha256").update(`${input.runId}:${event.sequence}`).digest("hex").slice(0, 32);
    return {
      event: "studi_lms_effect",
      timestamp: event.at,
      uuid: `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`,
      properties: {
        distinct_id: `lms-${input.runId}`,
        environment: "fake-lms",
        lms_run_id: input.runId,
        scenario_id: input.scenarioId,
        scenario_version: input.scenarioVersion,
        effect_sequence: event.sequence,
        effect_type: event.type,
        activity_id: event.activityId ?? null,
        virtual_time: event.at,
        $geoip_disable: true,
      },
    };
  });
}
export async function exportTelemetry(
  input: TelemetryExport,
  options: {
    developmentProjectToken: string;
    host?: string;
    fetch?: typeof fetch;
  },
): Promise<{ exported: number }> {
  if (!options.developmentProjectToken.startsWith("phc_"))
    throw new Error("Configure a dedicated PostHog development project token.");
  const host = options.host ?? "https://us.i.posthog.com";
  if (!["https://us.i.posthog.com", "https://eu.i.posthog.com"].includes(host))
    throw new Error("Unsupported PostHog ingestion host.");
  const batch = telemetryBatch(input);
  for (let offset = 0; offset < batch.length; offset += 100) {
    const response = await (options.fetch ?? fetch)(`${host}/batch/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: options.developmentProjectToken,
        batch: batch.slice(offset, offset + 100),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(`PostHog export failed (${response.status}); the local journal remains available.`);
  }
  return { exported: batch.length };
}
