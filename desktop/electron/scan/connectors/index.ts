import { fetchCanvasConnector } from "./canvas.js";
import { fetchMoodleConnector } from "./moodle.js";

export type LmsKind = "moodle" | "canvas";

export type ConnectorSourceLabel =
  | "LMS detection"
  | "Moodle courses"
  | "Moodle calendar"
  | "Moodle calendar (iCal)"
  | "Canvas courses"
  | "Canvas planner"
  | "Canvas assignments";

export interface ConnectorCourseRow {
  readonly courseKey: string;
  readonly label: string;
  readonly code: string | null;
  readonly href: string;
  readonly sourceLabels: readonly ConnectorSourceLabel[];
}

export interface ConnectorAssignmentRow {
  readonly assignmentKey: string;
  readonly courseKey: string | null;
  readonly title: string;
  readonly href: string;
  readonly dueAt: string | null;
  readonly dueText: string | null;
  readonly statusText: string | null;
  readonly kind: string;
  /** Anything but work is saved as class context and kept out of the student's week. */
  readonly category?: "work" | "exam" | "meeting" | "resource" | "grade";
  readonly instructions: string | null;
  readonly sourceLabels: readonly ConnectorSourceLabel[];
}

export interface ConnectorFailure {
  readonly sourceLabel: ConnectorSourceLabel;
  readonly message: string;
}

export interface ConnectorSnapshot {
  readonly lms: LmsKind;
  readonly origin: string;
  readonly courses: readonly ConnectorCourseRow[];
  readonly assignments: readonly ConnectorAssignmentRow[];
  readonly failures: readonly ConnectorFailure[];
}

/**
 * The only browser capability a connector receives. The coordinator adapts
 * BrowserController.evaluateInPage to this interface, so fetch runs inside the
 * currently signed-in school page without exposing cookies to Electron main.
 */
export interface SchoolConnectorBrowser {
  evaluateInPage<T = unknown>(code: string): Promise<T>;
}

export interface LmsPageSignals {
  readonly url: string;
  readonly title?: string;
  readonly generator?: string;
  readonly bodyClass?: string;
  readonly hasMoodleConfig?: boolean;
  readonly hasMoodleTimeline?: boolean;
  readonly hasCanvasConfig?: boolean;
  readonly hasCanvasPlanner?: boolean;
}

export interface SchoolConnectorResult {
  readonly kind: LmsKind | null;
  readonly origin: string;
  readonly courses: readonly ConnectorCourseRow[];
  readonly rows: readonly ConnectorAssignmentRow[];
  readonly complete: boolean;
  readonly failures: readonly ConnectorFailure[];
}

export interface SchoolConnectorOptions {
  readonly kind?: LmsKind;
}

export function detectLmsFromSignals(signals: LmsPageSignals): LmsKind | null {
  const text = [signals.url, signals.title, signals.generator, signals.bodyClass]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  let moodle = 0;
  let canvas = 0;

  if (signals.hasMoodleConfig) moodle += 6;
  if (signals.hasMoodleTimeline) moodle += 4;
  if (/\bmoodle\b/.test(text)) moodle += 3;
  if (/\/(?:mod|course|calendar)\/(?:view\.php|index\.php|export\.php)/.test(text)) moodle += 2;

  if (signals.hasCanvasConfig) canvas += 6;
  if (signals.hasCanvasPlanner) canvas += 4;
  if (/\bcanvas\b/.test(text)) canvas += 3;
  if (/\/courses\/[^/]+(?:\/|$)/.test(text)) canvas += 2;

  if (moodle === 0 && canvas === 0) return null;
  if (moodle === canvas) return null;
  return moodle > canvas ? "moodle" : "canvas";
}

export async function detectLms(browser: SchoolConnectorBrowser): Promise<LmsKind | null> {
  const signals = await browser.evaluateInPage<LmsPageSignals>(`(() => ({
    url: location.href,
    title: document.title,
    generator: document.querySelector('meta[name="generator"]')?.getAttribute('content') || '',
    bodyClass: document.body?.className || '',
    hasMoodleConfig: Boolean(globalThis.M?.cfg),
    hasMoodleTimeline: Boolean(document.querySelector('.block_timeline, .block-timeline, [data-region="timeline"]')),
    hasCanvasConfig: Boolean(globalThis.ENV),
    hasCanvasPlanner: Boolean(document.querySelector('.planner-app, #planner-app, [data-testid="planner"]'))
  }))()`);
  return detectLmsFromSignals(signals);
}

export async function fetchSignedInLms(
  browser: SchoolConnectorBrowser,
  lms?: LmsKind,
): Promise<ConnectorSnapshot | null> {
  const detected = lms ?? (await detectLms(browser));
  if (detected === "moodle") return fetchMoodleConnector(browser);
  if (detected === "canvas") return fetchCanvasConnector(browser);
  return null;
}

/**
 * Reads the LMS through its signed-in page and returns coordinator-ready records.
 * `complete` means every returned row belongs to a returned course and no source
 * failed. Partial rows remain usable; the coordinator must continue browser
 * discovery for any gaps.
 */
export async function runSchoolConnector(
  browser: SchoolConnectorBrowser,
  schoolRoot: string,
  options: SchoolConnectorOptions = {},
): Promise<SchoolConnectorResult> {
  const root = new URL(schoolRoot);
  const snapshot = await fetchSignedInLms(browser, options.kind);
  if (!snapshot) {
    return {
      kind: null,
      origin: root.origin,
      courses: [],
      rows: [],
      complete: false,
      failures: [{
        sourceLabel: "LMS detection",
        message: "Could not detect Moodle or Canvas on the signed-in school page",
      }],
    };
  }
  if (snapshot.origin !== root.origin) {
    return {
      kind: snapshot.lms,
      origin: snapshot.origin,
      courses: [],
      rows: [],
      complete: false,
      failures: [{
        sourceLabel: "LMS detection",
        message: `The signed-in page is on ${snapshot.origin}, not the school origin ${root.origin}`,
      }],
    };
  }

  const courseKeys = new Set(snapshot.courses.map((course) => course.courseKey));
  return {
    kind: snapshot.lms,
    origin: snapshot.origin,
    courses: snapshot.courses,
    rows: snapshot.assignments,
    complete: snapshot.failures.length === 0 && snapshot.assignments.every(
      (assignment) => assignment.courseKey !== null && courseKeys.has(assignment.courseKey),
    ),
    failures: snapshot.failures,
  };
}

export { fetchCanvasConnector, parseCanvasConnectorPayload, parseCanvasJson } from "./canvas.js";
export { fetchMoodleConnector, parseMoodleConnectorPayload } from "./moodle.js";
export type { CanvasConnectorPayload } from "./canvas.js";
export type { MoodleConnectorPayload } from "./moodle.js";
