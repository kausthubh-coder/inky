import type {
  ConnectorAssignmentRow,
  ConnectorCourseRow,
  ConnectorFailure,
  ConnectorSnapshot,
  ConnectorSourceLabel,
  SchoolConnectorBrowser,
} from "./index.js";

export interface CanvasConnectorPayload {
  readonly origin: string;
  readonly courses: readonly unknown[];
  readonly planner: readonly unknown[];
  readonly assignmentsByCourse: Readonly<Record<string, readonly unknown[]>>;
  readonly failures?: readonly ConnectorFailure[];
}

const CANVAS_FETCH_SCRIPT = `(async () => {
  const origin = location.origin;
  const failures = [];
  const sameOrigin = (value) => {
    const url = new URL(value, origin);
    if (url.origin !== origin) throw new Error('Canvas pagination left the signed-in origin');
    return url.href;
  };
  const parseJson = (value) => JSON.parse(value.replace(/^\\s*while\\s*\\(\\s*1\\s*\\)\\s*;\\s*/, ''));
  const nextLink = (header) => {
    if (!header) return null;
    for (const part of header.split(',')) {
      const match = /<([^>]+)>\\s*;\\s*rel=["']?next["']?/i.exec(part);
      if (match) return match[1];
    }
    return null;
  };
  const pages = async (path) => {
    const rows = [];
    let next = sameOrigin(path);
    for (let page = 0; next && page < 100; page += 1) {
      const response = await fetch(next, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { 'accept': 'application/json' }
      });
      if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + response.statusText);
      const body = parseJson(await response.text());
      if (!Array.isArray(body)) throw new Error('Canvas list endpoint returned a non-array response');
      rows.push(...body);
      const linked = nextLink(response.headers.get('link'));
      next = linked ? sameOrigin(linked) : null;
    }
    if (next) throw new Error('Canvas pagination exceeded 100 pages');
    return rows;
  };
  const read = async (path, sourceLabel) => {
    try {
      return await pages(path);
    } catch (error) {
      failures.push({ sourceLabel, message: error instanceof Error ? error.message : String(error) });
      return [];
    }
  };

  const courses = await read('/api/v1/courses?enrollment_state=active&per_page=100', 'Canvas courses');
  const planner = await read('/api/v1/planner/items?per_page=100', 'Canvas planner');
  const assignmentsByCourse = {};
  for (const course of courses) {
    const id = course && (typeof course.id === 'string' || typeof course.id === 'number') ? String(course.id) : '';
    if (!id) continue;
    assignmentsByCourse[id] = await read(
      '/api/v1/courses/' + encodeURIComponent(id) + '/assignments?include%5B%5D=submission&per_page=100',
      'Canvas assignments'
    );
  }
  return { origin, courses, planner, assignmentsByCourse, failures };
})()`;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function identifier(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function absoluteHref(value: unknown, origin: string): string | null {
  const href = text(value);
  if (!href) return null;
  try {
    return new URL(href, origin).href;
  } catch {
    return null;
  }
}

function dueAt(value: unknown): string | null {
  const date = text(value);
  return date && Number.isFinite(Date.parse(date)) ? date : null;
}

function statusFrom(value: Record<string, unknown> | null): string | null {
  if (!value) return null;
  const direct = text(value.statusText) ?? text(value.status_text) ?? text(value.workflow_state);
  if (direct) return direct;
  const activeFlags = ["missing", "late", "excused", "graded", "needs_grading", "with_feedback"]
    .filter((key) => value[key] === true);
  return activeFlags.length ? activeFlags.join(", ") : null;
}

function canvasStatus(item: Record<string, unknown>, plannable: Record<string, unknown>): string | null {
  const submission = record(plannable.submission) ?? record(item.submission);
  const submissions = record(item.submissions);
  const status = statusFrom(submission) ?? statusFrom(submissions);
  if (status) return status;
  const override = record(item.planner_override);
  return override?.marked_complete === true ? "marked_complete" : null;
}

function courseHref(course: Record<string, unknown>, courseKey: string, origin: string): string {
  return absoluteHref(course.html_url, origin) ?? new URL(`/courses/${encodeURIComponent(courseKey)}`, origin).href;
}

function parseCourses(payload: CanvasConnectorPayload): ConnectorCourseRow[] {
  const rows: ConnectorCourseRow[] = [];
  for (const value of payload.courses) {
    const course = record(value);
    const courseKey = identifier(course?.id);
    const label = text(course?.name) ?? text(course?.course_code);
    if (!course || !courseKey || !label) continue;
    rows.push({
      courseKey,
      label,
      code: text(course.course_code),
      href: courseHref(course, courseKey, payload.origin),
      sourceLabels: ["Canvas courses"],
    });
  }
  return rows;
}

function assignmentEndpointRows(payload: CanvasConnectorPayload): Map<string, ConnectorAssignmentRow> {
  const rows = new Map<string, ConnectorAssignmentRow>();
  for (const [courseKey, values] of Object.entries(payload.assignmentsByCourse)) {
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      const assignment = record(value);
      const assignmentKey = identifier(assignment?.id);
      const title = text(assignment?.name) ?? text(assignment?.title);
      const href = absoluteHref(assignment?.html_url, payload.origin);
      if (!assignment || !assignmentKey || !title || !href) continue;
      const submission = record(assignment.submission);
      const statusText = statusFrom(submission) ?? text(assignment.status_text) ?? text(assignment.status);
      rows.set(`${courseKey}\u0000${assignmentKey}`, {
        assignmentKey,
        courseKey,
        title,
        href,
        dueAt: dueAt(assignment.due_at),
        dueText: text(assignment.due_text),
        statusText,
        kind: Array.isArray(assignment.submission_types) && assignment.submission_types.includes("online_quiz")
          ? "quiz"
          : "assignment",
        instructions: text(assignment.description),
        sourceLabels: ["Canvas assignments"],
      });
    }
  }
  return rows;
}

function plannerRows(
  payload: CanvasConnectorPayload,
  rows: Map<string, ConnectorAssignmentRow>,
): void {
  for (const value of payload.planner) {
    const item = record(value);
    const plannable = record(item?.plannable);
    const courseKey = identifier(item?.course_id) ?? identifier(plannable?.course_id);
    const assignmentKey = identifier(plannable?.id) ?? identifier(item?.plannable_id);
    const title = text(plannable?.title) ?? text(plannable?.name);
    const href = absoluteHref(item?.html_url ?? plannable?.html_url, payload.origin);
    if (!item || !plannable || !assignmentKey || !title || !href) continue;
    const mapKey = `${courseKey ?? ""}\u0000${assignmentKey}`;
    const existing = courseKey ? rows.get(mapKey) : undefined;
    const plannerStatus = canvasStatus(item, plannable);
    const plannerDueAt = dueAt(plannable.due_at ?? item.due_at);
    const plannerDueText = text(plannable.due_text) ?? text(item.due_text);
    const plannerKind = text(item.plannable_type) ?? text(plannable.type);
    if (existing) {
      rows.set(mapKey, {
        ...existing,
        dueAt: existing.dueAt ?? plannerDueAt,
        dueText: existing.dueText ?? plannerDueText,
        statusText: existing.statusText ?? plannerStatus,
        kind: plannerKind?.toLowerCase() ?? existing.kind,
        instructions: existing.instructions ?? text(plannable.description),
        sourceLabels: ["Canvas assignments", "Canvas planner"],
      });
      continue;
    }
    rows.set(mapKey, {
      assignmentKey,
      courseKey,
      title,
      href,
      dueAt: plannerDueAt,
      dueText: plannerDueText,
      statusText: plannerStatus,
      kind: (plannerKind ?? "assignment").toLowerCase(),
      instructions: text(plannable.description),
      sourceLabels: ["Canvas planner"],
    });
  }
}

export function parseCanvasJson(value: string): unknown {
  return JSON.parse(value.replace(/^\s*while\s*\(\s*1\s*\)\s*;\s*/, ""));
}

export function parseCanvasConnectorPayload(payload: CanvasConnectorPayload): ConnectorSnapshot {
  const assignments = assignmentEndpointRows(payload);
  plannerRows(payload, assignments);
  return {
    lms: "canvas",
    origin: new URL(payload.origin).origin,
    courses: parseCourses(payload),
    assignments: [...assignments.values()],
    failures: [...(payload.failures ?? [])],
  };
}

export async function fetchCanvasConnector(browser: SchoolConnectorBrowser): Promise<ConnectorSnapshot> {
  const payload = await browser.evaluateInPage<CanvasConnectorPayload>(CANVAS_FETCH_SCRIPT);
  return parseCanvasConnectorPayload(payload);
}

export const canvasConnectorSourceLabels = {
  courses: "Canvas courses",
  planner: "Canvas planner",
  assignments: "Canvas assignments",
} as const satisfies Record<string, ConnectorSourceLabel>;
