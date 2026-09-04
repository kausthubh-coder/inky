import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const allowedHosts = new Set(["https://us.i.posthog.com", "https://eu.i.posthog.com"] as const);
const publicInkyProjectToken = "phc_r5ea5xTg6No4KuTaWKskB7gTRp9wWWwWgpeafJ77BU52";

export interface TelemetryPublicConfig {
  readonly projectToken?: string;
  readonly host: "https://us.i.posthog.com" | "https://eu.i.posthog.com";
}

export function loadTelemetryPublicConfig(isPackaged: boolean): TelemetryPublicConfig {
  const local = isPackaged ? {} : readLocalEnvironment(resolve(process.cwd(), ".env.local"));
  const projectToken = process.env.STUDI_POSTHOG_PROJECT_TOKEN ?? local.STUDI_POSTHOG_PROJECT_TOKEN ?? publicInkyProjectToken;
  const candidateHost = process.env.STUDI_POSTHOG_HOST ?? local.STUDI_POSTHOG_HOST ?? "https://us.i.posthog.com";
  const host = allowedHosts.has(candidateHost as TelemetryPublicConfig["host"])
    ? candidateHost as TelemetryPublicConfig["host"]
    : "https://us.i.posthog.com";
  if (!projectToken?.startsWith("phc_")) return { host };
  return { projectToken, host };
}

function readLocalEnvironment(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match?.[1] || match[2] === undefined) continue;
    values[match[1]] = match[2].replace(/^(?:"(.*)"|'(.*)')$/, "$1$2");
  }
  return values;
}
