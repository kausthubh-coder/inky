import type { OnBeforeRequestListenerDetails, Session } from "electron";

const READ_ONLY_MOODLE_METHODS = new Set([
  "core_course_check_updates",
  "core_session_time_remaining",
  "core_session_touch",
]);
const READ_ONLY_MOODLE_PREFIXES = ["core_calendar_get_", "core_course_get_"];
const HTTP_METHODS_WITHOUT_WRITES = new Set(["GET", "HEAD"]);

type GuardRequest = Pick<OnBeforeRequestListenerDetails, "method" | "uploadData" | "url">;

export type ScanRequestDecision =
  | { readonly action: "allow"; readonly reason: "assignment" | "read" | "sign_in" | "lti_launch" | "moodle_read" }
  | { readonly action: "block"; readonly reason: "scan_write" };

export interface ScanReadOnlyGuardOptions {
  /** Exact identity-provider hosts that the school is allowed to use while signing in. */
  readonly signInHosts?: readonly string[];
  /** Exact hosts discovered from verified course-page LTI launch forms. */
  readonly ltiLaunchHosts?: readonly string[];
  readonly onBlocked?: (request: Readonly<Pick<OnBeforeRequestListenerDetails, "method" | "resourceType" | "url">>) => void;
}

export interface ScanReadOnlyGuard {
  readonly scanActive: boolean;
  setScanActive(active: boolean): void;
  dispose(): void;
}

interface CompiledPolicy {
  readonly signInHosts: ReadonlySet<string>;
  readonly ltiLaunchHosts: ReadonlySet<string>;
}

/**
 * Installs one request guard for the lifetime of a school session. The guard is
 * deliberately inactive until scan ownership is acquired, so assignment work
 * in the same session keeps its normal write behavior.
 */
export function installScanReadOnlyGuard(
  session: Pick<Session, "webRequest">,
  options: ScanReadOnlyGuardOptions = {},
): ScanReadOnlyGuard {
  const policy = compilePolicy(options);
  let scanActive = false;
  let disposed = false;

  session.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (details, callback) => {
      const decision = classifyScanRequestWithPolicy(details, policy, scanActive);
      callback(decision.action === "block" ? { cancel: true } : {});
      if (decision.action === "block") {
        try {
          options.onBlocked?.({ method: details.method, resourceType: details.resourceType, url: details.url });
        } catch {
          // Observability must never change enforcement at the request boundary.
        }
      }
    },
  );

  return {
    get scanActive() { return scanActive; },
    setScanActive(active) {
      if (disposed) {
        if (active) throw new Error("The scan read-only guard has been disposed");
        return;
      }
      scanActive = active;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scanActive = false;
      session.webRequest.onBeforeRequest(null);
    },
  };
}

export function classifyScanRequest(
  request: GuardRequest,
  options: Pick<ScanReadOnlyGuardOptions, "signInHosts" | "ltiLaunchHosts"> = {},
  scanActive = true,
): ScanRequestDecision {
  return classifyScanRequestWithPolicy(request, compilePolicy(options), scanActive);
}

function classifyScanRequestWithPolicy(
  request: GuardRequest,
  policy: CompiledPolicy,
  scanActive: boolean,
): ScanRequestDecision {
  if (!scanActive) return { action: "allow", reason: "assignment" };

  const method = request.method.toUpperCase();
  if (HTTP_METHODS_WITHOUT_WRITES.has(method)) return { action: "allow", reason: "read" };

  const url = parseHttpUrl(request.url);
  if (!url) return { action: "block", reason: "scan_write" };
  if (policy.signInHosts.has(normalizeHostname(url.host))) return { action: "allow", reason: "sign_in" };

  const fields = requestFields(request.uploadData);
  if (
    method === "POST" &&
    policy.ltiLaunchHosts.has(normalizeHostname(url.host)) &&
    (fields.names.has("lti_message_type") || fields.names.has("id_token"))
  ) {
    return { action: "allow", reason: "lti_launch" };
  }

  if (
    method === "POST" &&
    url.pathname.toLowerCase().endsWith("/lib/ajax/service.php") &&
    fields.methodNames.length > 0 &&
    fields.methodNames.every(isReadOnlyMoodleMethod)
  ) {
    return { action: "allow", reason: "moodle_read" };
  }

  return { action: "block", reason: "scan_write" };
}

function compilePolicy(options: Pick<ScanReadOnlyGuardOptions, "signInHosts" | "ltiLaunchHosts">): CompiledPolicy {
  return {
    signInHosts: new Set((options.signInHosts ?? []).map(normalizeConfiguredHost)),
    ltiLaunchHosts: new Set((options.ltiLaunchHosts ?? []).map(normalizeConfiguredHost)),
  };
}

function normalizeConfiguredHost(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("*")) throw new Error(`Invalid read-only guard host: ${value}`);
  const url = parseHttpUrl(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  if (!url || url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new Error(`Read-only guard hosts must be exact HTTP(S) host names: ${value}`);
  }
  return normalizeHostname(url.host);
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.(?=:|$)/, "");
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function isReadOnlyMoodleMethod(method: string): boolean {
  return READ_ONLY_MOODLE_METHODS.has(method) || READ_ONLY_MOODLE_PREFIXES.some(prefix => method.startsWith(prefix));
}

function requestFields(uploadData: OnBeforeRequestListenerDetails["uploadData"]): {
  readonly names: ReadonlySet<string>;
  readonly methodNames: readonly string[];
} {
  if (!uploadData?.length || uploadData.some(item => item.file || item.blobUUID)) {
    return { names: new Set(), methodNames: [] };
  }

  const body = Buffer.concat(uploadData.map(item => item.bytes)).toString("utf8");
  const names = new Set<string>();
  const methodNames: string[] = [];
  collectJsonFields(parseJson(body), names, methodNames);

  const parameters = new URLSearchParams(body);
  for (const [name, value] of parameters) {
    collectField(name, value, names, methodNames);
    collectJsonFields(parseJson(value), names, methodNames);
  }
  return { names, methodNames };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function collectJsonFields(value: unknown, names: Set<string>, methodNames: string[], depth = 0): void {
  if (depth > 12 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonFields(item, names, methodNames, depth + 1);
    return;
  }
  for (const [name, fieldValue] of Object.entries(value)) {
    if (typeof fieldValue === "string") collectField(name, fieldValue, names, methodNames);
    collectJsonFields(fieldValue, names, methodNames, depth + 1);
  }
}

function collectField(name: string, value: string, names: Set<string>, methodNames: string[]): void {
  const normalizedName = name.toLowerCase();
  names.add(normalizedName);
  if (normalizedName === "methodname") methodNames.push(value);
}
