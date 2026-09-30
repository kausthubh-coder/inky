import type { OnBeforeRequestListenerDetails, Session } from "electron";

import {
  mergeSchoolReadOnlyHosts,
  SchoolReadOnlyHostsSchema,
  type SchoolReadOnlyHosts,
  type SchoolReadOnlyHostsInput,
} from "../../shared/school-scan.js";

const READ_ONLY_MOODLE_METHODS = new Set([
  "core_course_check_updates",
  "core_session_time_remaining",
  "core_session_touch",
]);
const READ_ONLY_MOODLE_PREFIXES = ["core_calendar_get_", "core_course_get_"];
const HTTP_METHODS_WITHOUT_WRITES = new Set(["GET", "HEAD"]);

type GuardRequest = Pick<OnBeforeRequestListenerDetails, "method" | "uploadData" | "url"> & Partial<Pick<OnBeforeRequestListenerDetails, "resourceType">>;
/** How long a link click may take to turn into its page load. */
const LINK_NAVIGATION_MS = 5_000;

export type ScanRequestDecision =
  | { readonly action: "allow"; readonly reason: "assignment" | "read" | "sign_in" | "lti_launch" | "moodle_read" | "link_navigation" }
  | { readonly action: "block"; readonly reason: "scan_write" };

export interface ScanReadOnlyGuardOptions {
  /** Exact identity-provider hosts that the school is allowed to use while signing in. */
  readonly signInHosts?: readonly string[];
  /** Exact hosts discovered from verified course-page LTI launch forms. */
  readonly ltiLaunchHosts?: readonly string[];
  /** Every request during a scan that isn't a plain read, allowed or blocked, so a real-school run can prove it wrote nothing. */
  readonly onScanWrite?: (request: Readonly<Pick<OnBeforeRequestListenerDetails, "method" | "resourceType" | "url">>, decision: ScanRequestDecision) => void;
}

export interface ScanReadOnlyGuard {
  readonly scanActive: boolean;
  setAllowedHosts(hosts: SchoolReadOnlyHostsInput | undefined): void;
  setScanActive(active: boolean): void;
  /**
   * The agent clicked a plain link on this page, with nothing typed, ticked or attached on it. Some sites (WebAssign,
   * older portals) load their next page by posting a hidden form; the next such page load on the same site is allowed.
   */
  allowLinkNavigation(pageUrl: string): void;
  dispose(): void;
}

export interface LtiLaunchFormObservation {
  readonly pageUrl: string;
  readonly action: string;
  readonly method: string;
  /** Field names only. Form values can contain credentials and must not cross this boundary. */
  readonly fieldNames: readonly string[];
}

export interface SignInRedirectObservation {
  readonly schoolRoot: string;
  /** Main-frame navigation URLs in order, including the school start and return. */
  readonly redirectChain: readonly string[];
  readonly context: "onboarding" | "needs_you";
  readonly signedIn: boolean;
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
  let policy = compilePolicy(options);
  let scanActive = false;
  let disposed = false;
  let linkNavigation: { host: string; until: number } | null = null;

  session.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (details, callback) => {
      let decision = classifyScanRequestWithPolicy(details, policy, scanActive);
      if (decision.action === "block" && linkNavigation && isLinkNavigation(details, linkNavigation)) {
        linkNavigation = null;
        decision = { action: "allow", reason: "link_navigation" };
      }
      callback(decision.action === "block" ? { cancel: true } : {});
      if (scanActive && decision.reason !== "read") {
        try {
          options.onScanWrite?.({ method: details.method, resourceType: details.resourceType, url: details.url }, decision);
        } catch {
          // Observability must never change enforcement at the request boundary.
        }
      }
    },
  );

  return {
    get scanActive() { return scanActive; },
    setAllowedHosts(hosts) {
      if (disposed) throw new Error("The scan read-only guard has been disposed");
      policy = compilePolicy(hosts ?? {});
    },
    setScanActive(active) {
      if (disposed) {
        if (active) throw new Error("The scan read-only guard has been disposed");
        return;
      }
      scanActive = active;
      linkNavigation = null;
    },
    allowLinkNavigation(pageUrl) {
      const url = parseHttpUrl(pageUrl);
      linkNavigation = url && scanActive ? { host: normalizeHostname(url.host), until: Date.now() + LINK_NAVIGATION_MS } : null;
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

/**
 * Adds an LTI host only when a verified course page contains the launch form.
 * Callers should collect only the form action, method, and field names from the
 * page; form values are intentionally unnecessary.
 */
export function autofillLtiLaunchHost(
  current: SchoolReadOnlyHostsInput | undefined,
  observation: LtiLaunchFormObservation,
  verifiedCoursePageUrls: readonly string[],
): SchoolReadOnlyHosts {
  const page = parseCredentialFreeHttpUrl(observation.pageUrl, "LTI course page");
  const verifiedPages = new Set(verifiedCoursePageUrls.map(url => comparablePageUrl(parseCredentialFreeHttpUrl(url, "verified course page"))));
  if (!verifiedPages.has(comparablePageUrl(page))) {
    throw new Error("An LTI launch host can be learned only from a verified course page");
  }
  if (observation.method.trim().toUpperCase() !== "POST") {
    throw new Error("An LTI launch form must use POST");
  }
  const names = new Set(observation.fieldNames.map(name => name.trim().toLowerCase()).filter(Boolean));
  if (!isLtiLaunchFieldSet(names)) {
    throw new Error("The verified course-page form is not an LTI launch form");
  }
  const action = parseCredentialFreeHttpUrl(new URL(observation.action, page).toString(), "LTI form action");
  return mergeSchoolReadOnlyHosts(current, { ltiLaunchHosts: [action.host] });
}

/**
 * Adds exact IdP hosts after a student completes a sign-in handoff. Only a
 * main-frame chain that starts at the school, visits another host, returns to
 * the same school host, and is followed by a signed-in observation qualifies.
 */
export function autofillSignInHosts(
  current: SchoolReadOnlyHostsInput | undefined,
  observation: SignInRedirectObservation,
): SchoolReadOnlyHosts {
  if (!observation.signedIn) throw new Error("Sign-in hosts require a verified signed-in school state");
  if (observation.context !== "onboarding" && observation.context !== "needs_you") {
    throw new Error("Sign-in hosts can be learned only during onboarding or a needs-you handoff");
  }
  const root = parseCredentialFreeHttpUrl(observation.schoolRoot, "school root");
  const chain = observation.redirectChain.map(url => parseCredentialFreeHttpUrl(url, "sign-in redirect"));
  if (chain.length < 2 || chain.at(-1)?.host !== root.host) {
    throw new Error("Sign-in redirects must end back on the school host");
  }
  // From the school and back, every host in between is sign-in. From another entry link (a portal), the
  // entry page isn't sign-in, so only pages that look like one count.
  const fromSchool = chain[0]?.host === root.host;
  const signInHosts = [...new Set((fromSchool ? chain.slice(1, -1) : chain.slice(0, -1).filter(looksLikeSignIn))
    .map(url => url.host).filter(host => host !== root.host))];
  if (signInHosts.length === 0) throw new Error("The sign-in redirect chain did not visit an identity-provider host");
  return mergeSchoolReadOnlyHosts(current, { signInHosts });
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
  // Signing in is not school work: SAML sign-in messages, and posts to sign-in pages (Shibboleth, CAS, ADFS, Okta,
  // Microsoft, Google, a school's own login form), as long as nothing is uploaded.
  if (method === "POST" && !hasUpload(request.uploadData) && (fields.names.has("samlrequest") || fields.names.has("samlresponse") || isSignInEndpoint(url))) {
    return { action: "allow", reason: "sign_in" };
  }
  if (
    method === "POST" &&
    policy.ltiLaunchHosts.has(normalizeHostname(url.host)) &&
    isLtiLaunchFieldSet(fields.names)
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
  const parsed = SchoolReadOnlyHostsSchema.parse({
    signInHosts: options.signInHosts,
    ltiLaunchHosts: options.ltiLaunchHosts,
  });
  return {
    signInHosts: new Set(parsed.signInHosts),
    ltiLaunchHosts: new Set(parsed.ltiLaunchHosts),
  };
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

/** A page load posted by a link click just made on the same site, carrying no file. */
function isLinkNavigation(request: GuardRequest, allowance: { host: string; until: number }): boolean {
  const url = parseHttpUrl(request.url);
  return Date.now() <= allowance.until && request.method.toUpperCase() === "POST" && request.resourceType === "mainFrame"
    && !!url && normalizeHostname(url.host) === allowance.host && !hasUpload(request.uploadData);
}

function hasUpload(uploadData: GuardRequest["uploadData"]): boolean {
  return !!uploadData?.some(item => item.file || item.blobUUID || /filename=/i.test(item.bytes?.subarray(0, 64_000).toString("latin1") ?? ""));
}

/**
 * Where a sign-in form posts: a sign-in path (/idp/, /saml2/, /cas/, /login, /oauth2/, /adfs/...) on any host, or a
 * hosted identity provider. Stricter than looksLikeSignIn, which also trusts host names like "auth.".
 */
function isSignInEndpoint(url: URL): boolean {
  return /(^|\.)(duosecurity\.com|okta\.com|microsoftonline\.com|accounts\.google\.com)$/i.test(url.hostname)
    || /\/(idp|saml2?|sso|cas|login|signin|oauth2?|adfs)(\/|$)/i.test(url.pathname);
}

/** Identity-provider pages: Shibboleth/SAML, CAS, OAuth/OIDC, ADFS, Duo and the big hosted providers. */
export function looksLikeSignIn(url: URL): boolean {
  return /(^|\.)(login|sso|idp|auth|shib|cas|adfs|duosecurity\.com|okta\.com|microsoftonline\.com|accounts\.google\.com)(\.|$)/i.test(url.host)
    || /\/(idp|saml2?|sso|cas|login|signin|oauth2?|authorize|adfs)(\/|$)/i.test(url.pathname);
}

function parseCredentialFreeHttpUrl(value: string, label: string): URL {
  const url = parseHttpUrl(value);
  if (!url || url.username || url.password) throw new Error(`${label} must be a credential-free HTTP(S) URL`);
  return url;
}

function comparablePageUrl(url: URL): string {
  const copy = new URL(url);
  copy.hash = "";
  return copy.toString();
}

function isLtiLaunchFieldSet(names: ReadonlySet<string>): boolean {
  return (
    (names.has("lti_message_type") && names.has("resource_link_id"))
    || (names.has("id_token") && names.has("state"))
    // LTI 1.3 starts with a third-party login initiation before the id_token launch.
    || (names.has("iss") && names.has("login_hint") && names.has("target_link_uri"))
  );
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
