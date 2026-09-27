import type {
  ConnectorAssignmentRow,
  ConnectorCourseRow,
  ConnectorFailure,
  ConnectorSnapshot,
  ConnectorSourceLabel,
  SchoolConnectorBrowser,
} from "./index.js";

export interface MoodleConnectorPayload {
  readonly origin: string;
  readonly calendar: unknown | null;
  readonly courses: unknown | null;
  readonly ical: string | null;
  readonly failures?: readonly ConnectorFailure[];
}

/**
 * Page-side function source: school HTML to plain Markdown (links, lists, paragraphs), dropping
 * screen-reader-only labels and icons. Runs in the school page, where DOMParser is available.
 */
export const MOODLE_MARKDOWN_FUNCTION = `((html) => {
  const root = new DOMParser().parseFromString(html, 'text/html').body;
  root.querySelectorAll('script, style, .accesshide, .sr-only, .visually-hidden, i.fa, i.icon, img').forEach(node => node.remove());
  const walk = node => {
    if (node.nodeType === 3) return node.textContent.replace(/\\s+/g, ' ');
    if (node.nodeType !== 1) return '';
    const inner = [...node.childNodes].map(walk).join('');
    const tag = node.tagName.toLowerCase();
    if (tag === 'a') {
      const label = inner.trim();
      const href = node.getAttribute('href');
      return href && !href.startsWith('#') && label && label !== href ? '[' + label + '](' + new URL(href, location.href).href + ')' : label;
    }
    if (tag === 'br') return '\\n';
    if (tag === 'li') return '\\n- ' + inner.trim();
    if (/^(p|div|h[1-6]|ul|ol|table|tr|blockquote|section)$/.test(tag)) return '\\n\\n' + inner.trim() + '\\n\\n';
    return inner;
  };
  return walk(root).replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
})`;

const MOODLE_FETCH_SCRIPT = `(async () => {
  const origin = location.origin;
  const failures = [];
  const call = async (methodname, args, sourceLabel) => {
    try {
      const endpoint = new URL('/lib/ajax/service.php', origin);
      const sesskey = globalThis.M?.cfg?.sesskey;
      if (sesskey) endpoint.searchParams.set('sesskey', String(sesskey));
      const response = await fetch(endpoint.href, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'accept': 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify([{ methodname, args }])
      });
      if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + response.statusText);
      const batch = await response.json();
      const reply = Array.isArray(batch) ? batch[0] : null;
      if (!reply || reply.error) throw new Error(reply?.exception?.message || reply?.message || 'Invalid Moodle response');
      return reply;
    } catch (error) {
      failures.push({ sourceLabel, message: error instanceof Error ? error.message : String(error) });
      return null;
    }
  };

  const calendar = await call(
    'core_calendar_get_action_events_by_timesort',
    { timesortfrom: 0, limitnum: 50 },
    'Moodle calendar'
  );
  // Moodle sends descriptions as HTML; the page's own parser turns them into readable Markdown.
  for (const event of calendar?.data?.events ?? []) {
    if (typeof event.description === 'string') event.description = ${MOODLE_MARKDOWN_FUNCTION}(event.description);
  }
  const courses = await call(
    'core_course_get_enrolled_courses_by_timeline_classification',
    { classification: 'all', limit: 0, offset: 0, sort: 'fullname' },
    'Moodle courses'
  );

  let ical = null;
  if (!calendar) {
    try {
      const endpoint = new URL('/calendar/export.php', origin);
      const response = await fetch(endpoint.href, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { 'accept': 'text/calendar' }
      });
      if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + response.statusText);
      ical = await response.text();
      if (!/BEGIN:VCALENDAR/i.test(ical)) throw new Error('Moodle calendar export did not return iCal');
    } catch (error) {
      failures.push({ sourceLabel: 'Moodle calendar (iCal)', message: error instanceof Error ? error.message : String(error) });
      ical = null;
    }
  }
  return { origin, calendar, courses, ical, failures };
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

function unixDate(value: unknown): string | null {
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

const MEETING_MODULES = new Set(["zoom", "bigbluebuttonbn", "webex", "msteams", "googlemeet", "jitsi", "attendance", "scheduler"]);

function moduleKind(event: Record<string, unknown>): string {
  const raw = text(event.modulename) ?? text(event.eventtype) ?? text(event.kind);
  if (!raw) return "assignment";
  const normalized = raw.toLowerCase();
  if (normalized === "assign") return "assignment";
  if (normalized === "forum") return "discussion";
  return normalized;
}

function assignmentKey(href: string, fallback: unknown): string {
  try {
    const id = new URL(href).searchParams.get("id");
    if (id) return id;
  } catch {
    // The href was already validated; use the event identifier if URL parsing ever changes.
  }
  return identifier(fallback) ?? href;
}

function parseMoodleCourses(payload: MoodleConnectorPayload): ConnectorCourseRow[] {
  const reply = record(payload.courses);
  const data = record(reply?.data);
  const rawCourses = Array.isArray(data?.courses) ? data.courses : [];
  const rows: ConnectorCourseRow[] = [];
  for (const value of rawCourses) {
    const course = record(value);
    const courseKey = identifier(course?.id);
    const label = text(course?.fullname) ?? text(course?.displayname) ?? text(course?.shortname);
    const href = absoluteHref(course?.viewurl, payload.origin);
    if (!courseKey || !label || !href) continue;
    rows.push({
      courseKey,
      label,
      code: text(course?.shortname),
      href,
      sourceLabels: ["Moodle courses"],
    });
  }
  return rows;
}

function parseMoodleEvents(payload: MoodleConnectorPayload): ConnectorAssignmentRow[] | null {
  const reply = record(payload.calendar);
  const data = record(reply?.data);
  if (!Array.isArray(data?.events)) return null;
  const rows: ConnectorAssignmentRow[] = [];
  for (const value of data.events) {
    const event = record(value);
    const href = absoluteHref(event?.url, payload.origin);
    const title = text(event?.name) ?? text(event?.title);
    if (!event || !href || !title) continue;
    const course = record(event.course);
    const action = record(event.action);
    // Meetings and office hours share the calendar with homework; they're kept as class context, not work.
    const meeting = MEETING_MODULES.has(text(event.modulename)?.toLowerCase() ?? "") || /^(join|attend)\b/i.test(text(action?.name) ?? "");
    rows.push({
      ...(meeting ? { category: "meeting" as const } : {}),
      assignmentKey: assignmentKey(href, event.instance ?? event.id),
      courseKey: identifier(course?.id) ?? identifier(event.courseid),
      title,
      href,
      dueAt: unixDate(event.timesort ?? event.timestart),
      dueText: text(event.formattedtime) ?? text(event.dueText),
      statusText: text(event.statusText) ?? text(event.status) ?? text(action?.status),
      kind: moduleKind(event),
      instructions: text(event.description),
      sourceLabels: ["Moodle calendar"],
    });
  }
  return rows;
}

function unescapeIcal(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\([,;\\])/g, "$1");
}

function parseIcalDate(value: string): string | null {
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
    return Number.isFinite(Date.parse(iso)) ? iso : null;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))) return value;
  return null;
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function courseKeyFromCategory(
  category: string | undefined,
  courses: readonly ConnectorCourseRow[],
): string | null {
  if (!category) return null;
  const wanted = normalized(unescapeIcal(category));
  const matches = courses.filter((course) =>
    normalized(course.label) === wanted || (course.code !== null && normalized(course.code) === wanted),
  );
  return matches.length === 1 ? matches[0]!.courseKey : null;
}

function parseIcalAssignments(
  ical: string,
  origin: string,
  courses: readonly ConnectorCourseRow[],
): ConnectorAssignmentRow[] {
  const unfolded = ical.replace(/\r?\n[ \t]/g, "");
  const events = unfolded.match(/BEGIN:VEVENT\r?\n[\s\S]*?\r?\nEND:VEVENT/gi) ?? [];
  const rows: ConnectorAssignmentRow[] = [];
  for (const block of events) {
    const fields = new Map<string, string>();
    for (const line of block.split(/\r?\n/)) {
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      const key = line.slice(0, separator).split(";", 1)[0]?.toUpperCase();
      if (key) fields.set(key, line.slice(separator + 1));
    }
    const title = fields.get("SUMMARY");
    const rawHref = fields.get("URL");
    const rawDue = fields.get("DTSTART");
    const href = absoluteHref(rawHref ? unescapeIcal(rawHref) : null, origin);
    if (!title || !href || !rawDue) continue;
    rows.push({
      assignmentKey: assignmentKey(href, fields.get("UID")),
      courseKey: courseKeyFromCategory(fields.get("CATEGORIES"), courses),
      title: unescapeIcal(title),
      href,
      dueAt: parseIcalDate(rawDue),
      dueText: rawDue,
      statusText: fields.get("STATUS") ? unescapeIcal(fields.get("STATUS")!) : null,
      kind: "assignment",
      instructions: fields.get("DESCRIPTION") ? unescapeIcal(fields.get("DESCRIPTION")!) : null,
      sourceLabels: ["Moodle calendar (iCal)"],
    });
  }
  return rows;
}

function uniqueAssignments(rows: readonly ConnectorAssignmentRow[]): ConnectorAssignmentRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.assignmentKey}\u0000${row.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseMoodleConnectorPayload(payload: MoodleConnectorPayload): ConnectorSnapshot {
  const failures = [...(payload.failures ?? [])];
  const courses = parseMoodleCourses(payload);
  const eventRows = parseMoodleEvents(payload);
  let assignments = eventRows ?? [];
  if (eventRows === null && payload.ical) {
    assignments = parseIcalAssignments(payload.ical, payload.origin, courses);
  }
  if (eventRows === null && !payload.ical && !failures.some((failure) => failure.sourceLabel === "Moodle calendar")) {
    failures.push({ sourceLabel: "Moodle calendar", message: "Moodle returned no calendar event list" });
  }
  return {
    lms: "moodle",
    origin: new URL(payload.origin).origin,
    courses,
    assignments: uniqueAssignments(assignments),
    failures,
  };
}

export async function fetchMoodleConnector(browser: SchoolConnectorBrowser): Promise<ConnectorSnapshot> {
  const payload = await browser.evaluateInPage<MoodleConnectorPayload>(MOODLE_FETCH_SCRIPT);
  return parseMoodleConnectorPayload(payload);
}

export const moodleConnectorSourceLabels = {
  courses: "Moodle courses",
  calendar: "Moodle calendar",
  ical: "Moodle calendar (iCal)",
} as const satisfies Record<string, ConnectorSourceLabel>;
