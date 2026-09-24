import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  SchoolError,
  activityById,
  type Activity,
  type Service,
  type SchoolState,
} from "./domain.js";
import { assetBytes } from "./assets.js";
import type { SchoolStore } from "./store.js";
import type { Origins } from "./web.js";

export type Surface = Service | "unity" | "university";
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const link = (href: string, label: string) =>
  `<a href="${esc(href)}">${esc(label)}</a>`;
export function themedHref(state: SchoolState, item: Activity): string {
  if (item.service !== "school") return `/assignments/${item.id}`;
  if (state.presentation?.theme === "unknown") return `/work/${item.id}`;
  return state.presentation?.theme === "moodle"
    ? `/mod/${item.moduleType === "label" || item.moduleType === "grade" ? "page" : (item.moduleType ?? "assign")}/view.php?id=${item.id}`
    : `/courses/${item.courseId}/assignments/${item.id}`;
}
const courseHref = (state: SchoolState, id: string) =>
  state.presentation?.theme === "unknown"
    ? `/classroom/${id}`
    : state.presentation?.theme === "moodle"
    ? `/course/view.php?id=${id}`
    : `/courses/${id}`;
const work = (state: SchoolState) =>
  state.activities.filter((item) => item.submissionChannel !== "none");
function rows(state: SchoolState, origins: Origins, items: Activity[]): string {
  return `<table><thead><tr><th>Activity</th><th>Due</th><th>Status</th></tr></thead><tbody>${items.map((item) => `<tr class="activity modtype_${item.moduleType ?? "assign"}" data-id="${esc(item.id)}"><td>${link(item.service === "statistics" ? `${origins.school}/mod/lti/view.php?id=${item.id}` : `${origins[item.service]}${themedHref(state, item)}`, item.title)}</td><td>${esc(item.dueText)}</td><td>${esc(item.status === "not_started" ? "Not submitted" : item.status)}</td></tr>`).join("")}</tbody></table>`;
}

function unknownRows(state: SchoolState, origins: Origins, items: Activity[], showMore = false): string {
  const renderRow = (item: Activity) => `<tr><td>${link(`${origins[item.service]}${themedHref(state, item)}`, item.title)}</td><td>${esc(item.dueText)}</td><td>${esc(item.status === "not_started" ? "Not submitted" : item.status)}</td></tr>`;
  const visible = showMore ? items.slice(0, 3) : items;
  const remainder = showMore ? items.slice(3) : [];
  return `<table><thead><tr><th>Work</th><th>Due</th><th>Status</th></tr></thead><tbody>${visible.map(renderRow).join("")}</tbody></table>${remainder.length
    ? `<template id="more-work">${remainder.map(renderRow).join("")}</template><button type="button" id="show-more" onclick="document.querySelector('tbody').append(document.querySelector('#more-work').content.cloneNode(true));this.remove()">Show more</button>`
    : ""}`;
}

function unknownShell(state: SchoolState, origins: Origins, title: string, content: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Lantern Learning</title><style>
    body{margin:0;background:#faf9f4;color:#253144;font:16px/1.5 system-ui}header{background:#25405b;color:white;padding:18px 28px}nav{display:flex;gap:22px;background:white;padding:12px 28px}main{max-width:1050px;margin:28px auto;padding:0 28px 50px}a{color:#205f91}table{width:100%;border-collapse:collapse;background:white}td,th{text-align:left;padding:11px 14px;border-bottom:1px solid #d9dedf}th{background:#f0f2f3}button{margin:14px 0;padding:8px 14px;cursor:pointer}small{color:#566170}section{margin:24px 0}footer{margin-top:35px;color:#566170;font-size:12px}</style></head><body>
    <header>Lantern Learning · Alex Morgan</header><nav>${link(origins.school, "Home")}${link("/classroom", "Classes")}${link("/schedule", "Schedule")}</nav><main><small>Fall 2026 · School time zone: America/New_York</small><h1>${esc(title)}</h1>${content}<footer>Local synthetic school. No real student data.</footer></main></body></html>`;
}
function shell(
  state: SchoolState,
  origins: Origins,
  title: string,
  content: string,
  script = "",
): string {
  const moodle = state.presentation?.theme === "moodle";
  const courses = state.courses
    .map((c) =>
      link(origins.school + courseHref(state, c.id), `${c.code} ${c.title}`),
    )
    .join(" ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | ${moodle ? "Moodle" : "Canvas"} · Cedar University</title><style>
  *{box-sizing:border-box}body{margin:0;color:#24313c;background:#f6f7f9;font:16px/1.5 system-ui}header{padding:18px 28px;background:${moodle ? "#173f63" : "#a62632"};color:white}header a{color:white}nav{padding:18px 28px;background:white;display:flex;gap:22px;flex-wrap:wrap}main{max-width:1150px;margin:30px auto;padding:0 28px 50px}a{color:#17649b}table{border-collapse:collapse;width:100%;background:white}td,th{text-align:left;padding:12px;border:1px solid #dde1e4}section{margin:18px 0}details{padding:12px;background:white;border:1px solid #dde1e4}summary,button{cursor:pointer}button{padding:8px 14px;margin:8px 8px 8px 0}iframe{width:100%;min-height:200px;border:1px solid #bcc6cd}small{color:#596675}.notice{padding:15px;background:#e9f2fa}pre{white-space:pre-wrap}footer{margin-top:30px;font-size:12px;color:#596675}</style></head><body>
  <header>Cedar University · ${moodle ? "Moodle 4" : "Canvas"} · Alex Morgan</header><nav>${link(origins.school, "Dashboard")}${link(moodle ? "/calendar/view.php?view=upcoming" : "/calendar", "Calendar")}${link(moodle ? "/grade/report/user/index.php" : "/grades", "Grades")}<button data-drawer aria-expanded="false">Course index</button></nav><aside id="drawer" hidden>${courses}</aside>
  <main id="region-main"><small>Fall 2026 · ${esc(state.clock)} · America/New_York (ET)</small><h1>${esc(title)}</h1>${content}<footer>Local synthetic school. No real student data.</footer></main><script>
  document.querySelector('[data-drawer]').onclick=function(){const old=document.querySelector('#drawer'),next=old.cloneNode(true);next.hidden=!old.hidden;old.replaceWith(next);this.setAttribute('aria-expanded',String(!next.hidden));};
  ${script}</script></body></html>`;
}

// Mounted by the existing server; shares its SQLite state, faults and write journal.
export function createSchoolTheme(
  store: SchoolStore,
  origins: Origins,
  sesskey: () => string,
) {
  const tickets = new Map<
    string,
    { approvedAt: number; remembered: boolean }
  >();
  const launches = new Map<string, string>();
  return async function handle(
    surface: Surface,
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const state = store.read(),
      config = state.presentation;
    if (!config) return false;
    const html = (title: string, body: string, script = "", status = 200) => {
      response.writeHead(status, {
        "content-type": "text/html; charset=utf-8",
      });
      response.end(
        request.method === "HEAD"
          ? undefined
          : config.theme === "unknown" ? unknownShell(state, origins, title, body) : shell(state, origins, title, body, script),
      );
    };
    const redirect = (location: string) => {
      response.writeHead(303, { location });
      response.end();
    };
    const json = (body: unknown, canvas = false) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end((canvas ? "while(1);" : "") + JSON.stringify(body));
    };
    const latency = Number(url.searchParams.get("latency") ?? 0);
    if (!Number.isFinite(latency) || latency < 0 || latency > 10000)
      throw new SchoolError(400, "Latency must be 0–10000 milliseconds.");
    if (latency) await new Promise((resolve) => setTimeout(resolve, latency));
    // Preserve Origin on cross-origin form POSTs so the LTI launch can validate it.
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; style-src 'unsafe-inline'; img-src 'self'; frame-src ${origins.school}; form-action ${Object.values(origins).join(" ")}; frame-ancestors ${Object.values(origins).join(" ")}; base-uri 'none'`,
    );
    store.record("page_viewed", { service: surface, path: url.pathname });
    if (surface === "unity") {
      if (url.pathname === "/sso/login") {
        const ticket = randomUUID();
        tickets.set(ticket, {
          approvedAt: Date.now() + config.duoDelayMs,
          remembered: config.remembered,
        });
        redirect(`/sso/duo?ticket=${ticket}`);
        return true;
      }
      const ticket = url.searchParams.get("ticket") ?? "",
        pending = tickets.get(ticket);
      if (!pending) throw new SchoolError(403, "This sign-in has expired.");
      if (url.pathname === "/sso/duo") {
        html(
          "Check your phone",
          `<p>${pending.remembered ? "Remembered device. Approving your school sign-in…" : "Approve the Duo-like push on your device. Waiting for you."}</p>`,
          pending.remembered
            ? `setTimeout(()=>location.href=${JSON.stringify(`/sso/approve?ticket=${ticket}`)},${Math.max(0, pending.approvedAt - Date.now())});`
            : "",
        );
        return true;
      }
      if (
        url.pathname === "/sso/approve" &&
        pending.remembered &&
        Date.now() >= pending.approvedAt
      ) {
        redirect(`${origins.school}/sso/callback?ticket=${ticket}`);
        return true;
      }
      throw new SchoolError(403, "Push approval is still required.");
    }
    if (surface === "school" && url.pathname === "/sso/callback") {
      const ticket = url.searchParams.get("ticket") ?? "",
        pending = tickets.get(ticket);
      if (!pending?.remembered || Date.now() < pending.approvedAt)
        throw new SchoolError(403, "Unapproved sign-in.");
      tickets.delete(ticket);
      store.change(
        "session_changed",
        { service: "school", signedIn: true },
        (s) => {
          s.sessions.school = true;
        },
      );
      redirect(origins.school);
      return true;
    }
    if (
      surface !== "university" &&
      !state.sessions[surface] &&
      !(surface === "statistics" && url.pathname === "/lti/launch")
    ) {
      if (surface === "school") {
        redirect(`${origins.unity}/sso/login`);
        return true;
      }
      return false; // Existing vendor login form and CSRF handling.
    }
    if (surface === "statistics" && url.pathname === "/lti/launch") {
      if (
        request.method !== "POST" ||
        request.headers.origin !== origins.school
      )
        throw new SchoolError(403, "Launch this tool from your course.");
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 8192) throw new SchoolError(413, "Launch too large.");
      }
      const token = new URLSearchParams(body).get("launch") ?? "",
        id = launches.get(token);
      if (!id || !state.sessions.school)
        throw new SchoolError(403, "Launch expired.");
      launches.delete(token);
      store.change(
        "session_changed",
        { service: "statistics", signedIn: true, via: "lti" },
        (s) => {
          s.sessions.statistics = true;
        },
      );
      redirect(`/assignments/${id}`);
      return true;
    }
    if (surface === "school" && config.theme === "unknown" &&
      (/^\/courses?(?:\/|$)/.test(url.pathname) || /^\/mod\//.test(url.pathname) ||
        /^\/calendar\//.test(url.pathname))) {
      throw new SchoolError(404, "This school does not use that route.");
    }
    if (surface === "school" && url.pathname === "/mod/lti/view.php") {
      const item = activityById(state, url.searchParams.get("id") ?? "");
      if (item.service !== "statistics") {
        redirect(`${origins[item.service]}${themedHref(state, item)}`);
        return true;
      }
      const token = randomUUID();
      launches.set(token, item.id);
      html(
        item.title,
        `<p>Open the course tool. Due dates and submissions are managed by WebAssign-like.</p><form method="post" action="${origins.statistics}/lti/launch"><input type="hidden" name="lti_message_type" value="LtiResourceLinkRequest"><input type="hidden" name="resource_link_id" value="${esc(item.id)}"><input type="hidden" name="launch" value="${token}"><button>Open WebAssign</button></form>`,
      );
      return true;
    }
    if (
      url.pathname.startsWith("/api/v1/") ||
      url.pathname === "/lib/ajax/service.php"
    ) {
      if (!config.connectorApis)
        throw new SchoolError(404, "Connector API unavailable.");
      if (state.faults.courseFailurePending) {
        store.change(
          "fault_triggered",
          { fault: "connector-unavailable" },
          (s) => {
            s.faults.courseFailurePending = false;
          },
        );
        throw new SchoolError(
          503,
          "Course service temporarily unavailable. Retry.",
        );
      }
      const assignment = (item: Activity) => ({
        id: item.id,
        course_id: item.courseId,
        name: item.title,
        due_at: item.dueAt,
        due_text: item.dueText,
        html_url: `${origins[item.service]}${themedHref(state, item)}`,
        submission_types: [item.submissionChannel],
        description: item.instructions,
      });
      if (url.pathname === "/lib/ajax/service.php") {
        if (url.searchParams.get("sesskey") !== sesskey())
          throw new SchoolError(403, "Invalid sesskey.");
        let raw = "";
        for await (const chunk of request) {
          raw += chunk;
          if (raw.length > 100000)
            throw new SchoolError(413, "Request too large.");
        }
        let calls: { methodname: string; args?: Record<string, unknown> }[];
        try {
          calls = JSON.parse(raw);
        } catch {
          throw new SchoolError(400, "Invalid JSON.");
        }
        if (!Array.isArray(calls) || !calls.length || calls.length > 20)
          throw new SchoolError(400, "Invalid batch.");
        const replies = calls.map((call) => {
          const id = String(call.args?.courseid ?? "programming");
          switch (call.methodname) {
            case "core_calendar_get_action_events_by_timesort":
              return {
                data: {
                  events: work(state)
                    .filter((a) => a.service === "school")
                    .map((a) => ({
                      id: a.id,
                      name: a.title,
                      course: { id: a.courseId },
                      timestart: a.dueAt ? Date.parse(a.dueAt) / 1000 : null,
                      formattedtime: a.dueText,
                      url: origins.school + themedHref(state, a),
                    })),
                },
                error: false,
              };
            case "core_course_get_enrolled_courses_by_timeline_classification":
              return {
                data: {
                  courses: state.courses.map((c) => ({
                    id: c.id,
                    fullname: c.title,
                    shortname: c.code,
                    viewurl: origins.school + courseHref(state, c.id),
                  })),
                },
                error: false,
              };
            case "core_course_get_contents":
              return {
                data: [
                  {
                    id: 1,
                    name: "Course activities",
                    modules: state.activities
                      .filter((a) => a.courseId === id)
                      .map((a) => ({
                        id: a.id,
                        name: a.title,
                        modname: a.moduleType,
                        url: origins[a.service] + themedHref(state, a),
                        dates: a.dueAt
                          ? [
                              {
                                label: "Due",
                                timestamp: Date.parse(a.dueAt) / 1000,
                              },
                            ]
                          : [],
                        description: a.instructions,
                      })),
                  },
                ],
                error: false,
              };
            default:
              throw new SchoolError(
                403,
                "This fixture exposes only named read-only methods.",
              );
          }
        });
        json(replies);
        return true;
      }
      if (request.method !== "GET")
        throw new SchoolError(405, "Read-only API.");
      const course =
        /^\/api\/v1\/courses\/([^/]+)\/(assignments|modules)$/.exec(
          url.pathname,
        );
      if (url.pathname === "/api/v1/courses")
        json(
          state.courses.map((c) => ({
            id: c.id,
            name: c.title,
            course_code: c.code,
            syllabus_body: `<a href="${origins.university}/classes/${c.id}">Syllabus</a>`,
          })),
          true,
        );
      else if (url.pathname === "/api/v1/planner/items")
        json(
          work(state)
            .filter((a) => a.service === "school")
            .map((a) => ({
              course_id: a.courseId,
              plannable_type: a.kind,
              plannable: {
                id: a.id,
                title: a.title,
                due_at: a.dueAt,
                due_text: a.dueText,
              },
              html_url: themedHref(state, a),
            })),
          true,
        );
      else if (course)
        json(
          course[2] === "assignments"
            ? work(state)
                .filter(
                  (a) => a.courseId === course[1] && a.service === "school",
                )
                .map(assignment)
            : [
                {
                  id: "week-3",
                  name: "Week 3",
                  items: state.activities
                    .filter((a) => a.courseId === course[1])
                    .map((a) => ({
                      id: a.id,
                      title: a.title,
                      type:
                        a.submissionChannel === "none" ? "Page" : "Assignment",
                      html_url: themedHref(state, a),
                    })),
                },
              ],
          true,
        );
      else throw new SchoolError(404, "Unknown API.");
      return true;
    }
    const file = /^\/(?:files|download|file-shim)\/([a-z0-9-]+)$/.exec(
      url.pathname,
    );
    if (file) {
      const asset = state.assets.find((a) => a.id === file[1]);
      if (!asset) throw new SchoolError(404, "File not found.");
      if (url.pathname.startsWith("/file-shim/")) {
        html(
          "Course file",
          `<p>Your file is ready.</p>${link(`/download/${asset.id}`, `Download ${asset.name}`)}`,
        );
        return true;
      }
      if (state.faults.downloadFailurePending) {
        store.change(
          "fault_triggered",
          { fault: "download-unavailable" },
          (s) => {
            s.faults.downloadFailurePending = false;
          },
        );
        throw new SchoolError(503, "Download unavailable. Retry.");
      }
      const bytes = assetBytes(asset);
      store.record("file_downloaded", {
        assetId: asset.id,
        bytes: bytes.length,
        service: surface,
      });
      response.writeHead(200, {
        "content-type": asset.mime,
        "content-disposition": `${url.pathname.startsWith("/download/") ? "attachment" : "inline"}; filename="${asset.name}"`,
        "content-length": bytes.length,
      });
      response.end(request.method === "HEAD" ? undefined : bytes);
      return true;
    }
    if (surface === "university") {
      const id = /^\/classes\/([^/]+)$/.exec(url.pathname)?.[1],
        course = state.courses.find((c) => c.id === id),
        syllabus = state.assets.find((a) => a.id === `${id}-syllabus`);
      if (!course || !syllabus)
        throw new SchoolError(404, "Class homepage not found.");
      html(
        `${course.code}: syllabus`,
        `<pre>${esc(syllabus.text)}</pre>${link(`/download/${id}-syllabus`, "Download syllabus PDF")}`,
      );
      return true;
    }
    if (request.method === "POST") return false; // Existing work forms preserve the journal.
    if (surface === "statistics" || surface === "feedback") {
      if (
        url.pathname === "/" ||
        url.pathname === "/courses" ||
        /^\/courses\/[^/]+$/.test(url.pathname)
      ) {
        html(
          surface === "statistics"
            ? "WebAssign-like · ET"
            : "Gradescope-like · Your courses",
          state.courses
            .map(
              (c) =>
                `<h2>${link(`/courses/${c.id}`, c.title)}</h2>${rows(
                  state,
                  origins,
                  state.activities.filter(
                    (a) => a.courseId === c.id && a.service === surface,
                  ),
                )}`,
            )
            .join(""),
        );
        return true;
      }
      return false;
    }
    if (surface !== "school") return false;
    if (config.theme === "unknown") {
      if (request.method === "POST") return false;
      const listed = work(state).filter(item => item.id !== "design-doc");
      if (url.pathname === "/" || url.pathname === "/schedule") {
        html(url.pathname === "/" ? "My schoolwork" : "Schedule",
          `<p>Check your classes for work that does not appear here.</p><section><h2>Upcoming work</h2>${unknownRows(state, origins, listed, true)}</section><section><h2>Classes</h2>${state.courses.map(course => `<p>${link(courseHref(state, course.id), `${course.code} ${course.title}`)}</p>`).join("")}</section>`);
        return true;
      }
      if (url.pathname === "/classroom") {
        html("Classes", state.courses.map(course => `<p>${link(courseHref(state, course.id), `${course.code} ${course.title}`)}</p>`).join(""));
        return true;
      }
      const classroom = /^\/classroom\/([^/]+)$/.exec(url.pathname);
      if (classroom) {
        const course = state.courses.find(item => item.id === classroom[1]);
        if (!course) throw new SchoolError(404, "Class not found.");
        const items = work(state).filter(item => item.courseId === course.id);
        html(`${course.code} ${course.title}`, `<p>Class work and deadlines</p>${items.length ? unknownRows(state, origins, items) : "<p>No current work listed.</p>"}<section><h2>Materials</h2><p>${link(`${origins.university}/classes/${course.id}`, "Syllabus and class information")}</p></section>`);
        return true;
      }
      const assignment = /^\/work\/([^/]+)$/.exec(url.pathname);
      if (assignment) {
        const item = activityById(state, assignment[1]!);
        if (item.service !== "school") { redirect(`${origins[item.service]}${themedHref(state, item)}`); return true; }
        html(item.title, `<p>Class: ${esc(state.courses.find(course => course.id === item.courseId)?.title)}</p><p>Due: ${esc(item.dueText)}</p><p>${esc(item.instructions)}</p>${link(`/assignments/${item.id}`, "Open assignment")}`);
        return true;
      }
      return false;
    }
    const moodle = config.theme === "moodle";
    if (moodle && url.pathname === "/calendar/export.php") {
      const escapeCalendar = (value: string) => value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (char) => `\\${char}`);
      const events = work(state).filter((item) => item.dueAt).map((item) => {
        const start = new Date(item.dueAt!).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
        return `BEGIN:VEVENT\r\nUID:${escapeCalendar(item.id)}@cedar.invalid\r\nDTSTART:${start}\r\nSUMMARY:${escapeCalendar(item.title)}\r\nURL:${origins.school}${themedHref(state, item)}\r\nEND:VEVENT`;
      });
      response.writeHead(200, { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="cedar-calendar.ics"' });
      response.end(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Cedar Learning//Local LMS//EN\r\n${events.join("\r\n")}\r\nEND:VCALENDAR\r\n`);
      return true;
    }
    const calendar =
      url.pathname === "/calendar/view.php" || url.pathname === "/calendar";
    if (calendar || url.pathname === "/grade/report/user/index.php") {
      html(
        calendar ? "Upcoming events" : "User grade report",
        (calendar && moodle ? `<p>${link("/calendar/export.php", "Export calendar (iCal)")}</p>` : "") + rows(
          state,
          origins,
          calendar
            ? work(state).filter((a) => a.service === "school")
            : state.activities.filter(
                (a) => a.status === "graded" || a.moduleType === "grade",
              ),
        ),
      );
      return true;
    }
    if (url.pathname === "/") {
      const fallback = rows(
        state,
        origins,
        work(state).filter((a) => a.service === "school"),
      );
      const script = moodle
        ? `window.M={cfg:{sesskey:${JSON.stringify(sesskey())}}};fetch('/lib/ajax/service.php?sesskey='+M.cfg.sesskey,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify([{methodname:'core_calendar_get_action_events_by_timesort',args:{}}])}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(data=>render(data[0].data.events.map(e=>({title:e.name,href:e.url,due:e.formattedtime})))).catch(()=>{document.querySelector('#timeline').innerHTML=${JSON.stringify(fallback)};});`
        : `fetch('/api/v1/planner/items').then(r=>{if(!r.ok)throw Error();return r.text()}).then(t=>JSON.parse(t.replace(/^while\\(1\\);/,''))).then(data=>render(data.map(e=>({title:e.plannable.title,href:e.html_url,due:e.plannable.due_text})))).catch(()=>{document.querySelector('#timeline').innerHTML=${JSON.stringify(fallback)};});`;
      html(
        "Dashboard",
        `<section class="${moodle ? "block_timeline block-timeline" : "planner-app"}" data-region="timeline"><h2>${moodle ? "Timeline" : "Planner"}</h2><div id="timeline">Loading upcoming work…</div></section><h2>My courses</h2>${state.courses.map((c) => `<p>${link(courseHref(state, c.id), `${c.code} ${c.title}`)}</p>`).join("")}`,
        `let entries=[],limit=3;function render(data){entries=data;const old=document.querySelector('#timeline'),next=document.createElement('div');next.id='timeline';for(const e of entries.slice(0,limit)){const p=document.createElement('p'),a=document.createElement('a');a.href=e.href;a.textContent=e.title;p.append(a,document.createTextNode(' · '+e.due));next.append(p);}if(limit<entries.length){const b=document.createElement('button');b.textContent='Show more';b.onclick=()=>{limit+=3;render(entries)};next.append(b);}old.replaceWith(next);}${script}`,
      );
      return true;
    }
    const courseId =
      url.pathname === "/course/view.php"
        ? url.searchParams.get("id")
        : /^\/courses\/([^/]+)(?:\/(assignments|modules))?$/.exec(
            url.pathname,
          )?.[1];
    if (courseId) {
      const course = state.courses.find((c) => c.id === courseId);
      if (!course) throw new SchoolError(404, "Course not found.");
      if (state.faults.courseFailurePending) {
        store.change(
          "fault_triggered",
          { fault: "course-load-interrupted" },
          (s) => {
            s.faults.courseFailurePending = false;
          },
        );
        throw new SchoolError(503, "Course unavailable. Reload to retry.");
      }
      const items = state.activities.filter((a) => a.courseId === courseId);
      // Interleave real work among reference rows; do not conveniently group the answers.
      const ordered = items.filter((a) => a.submissionChannel === "none");
      items
        .filter((a) => a.submissionChannel !== "none")
        .forEach((a, i) =>
          ordered.splice(Math.min(i * 14 + 5, ordered.length), 0, a),
        );
      const modules = Array.from(
        { length: Math.ceil(ordered.length / 13) },
        (_, i) =>
          `<section class="section" id="section-${i}"><details ${i === 0 ? "open" : ""}><summary>Week ${i + 1}</summary><section class="content"><details open><summary>Learning activities</summary>${rows(state, origins, ordered.slice(i * 13, i * 13 + 13))}</details></section></details></section>`,
      ).join("");
      const sources = `<p>${link(`${origins.university}/classes/${course.id}`, "University syllabus and exam dates")}</p><p>${["review", "past-quiz", "slides"].map((kind) => link(`/file-shim/${course.id}-${kind}`, kind === "review" ? "Midterm review sheet" : kind === "past-quiz" ? "Graded past quiz" : "Lecture slides")).join(" · ")}</p>${moodle && course.id === "programming" ? `<p>${link("/mod/assign/view.php?id=pacific-lab", "Submit Lab 3")}</p>` : ""}`;
      const body =
        sources +
        (moodle
          ? modules
          : `<nav>${link(`/courses/${course.id}/assignments`, "Assignments")}${link(`/courses/${course.id}/modules`, "Modules")}</nav><div id="course-app">${
              url.pathname.endsWith("/assignments")
                ? rows(
                    state,
                    origins,
                    work(state).filter((a) => a.courseId === courseId),
                  )
                : modules
            }</div>`);
      html(
        `${course.code} ${course.title}`,
        body,
        moodle
          ? `window.M={cfg:{sesskey:${JSON.stringify(sesskey())}}};`
          : `const root=document.querySelector('#course-app');root.replaceWith(root.cloneNode(true));`,
      );
      return true;
    }
    const moduleId =
      /^\/mod\/(assign|quiz|resource|page|url|folder|forum)\/view.php$/.test(
        url.pathname,
      )
        ? url.searchParams.get("id")
        : /^\/courses\/[^/]+\/assignments\/([^/]+)$/.exec(url.pathname)?.[1];
    if (moduleId) {
      const item = activityById(state, moduleId);
      if (item.service !== "school") {
        redirect(origins[item.service] + themedHref(state, item));
        return true;
      }
      const content =
        item.kind === "quiz"
          ? `<iframe title="Quiz instructions" src="/quiz-instructions/${item.id}"></iframe>`
          : `<p>${esc(item.instructions)}</p>`;
      html(
        item.title,
        `<p>${esc(item.dueText)}</p>${item.closeAt ? `<p>Late cutoff: ${esc(item.closeAt)}. ${esc(item.latePenalty)}</p>` : ""}${content}${item.attachments.map((id) => `<p>${link(`/file-shim/${id}`, state.assets.find((a) => a.id === id)?.name ?? id)}</p>`).join("")}${item.submissionChannel !== "none" ? link(`/assignments/${item.id}`, "Open submission form") : "<p>No submission required.</p>"}`,
      );
      return true;
    }
    const quiz = /^\/quiz-instructions\/([^/]+)$/.exec(url.pathname);
    if (quiz) {
      const item = activityById(state, quiz[1]!);
      html(
        "Quiz instructions",
        `<p>${esc(item.instructions)}</p><p>Two attempts. Explain each answer. Q1: push A then B; what does pop return?</p>`,
      );
      return true;
    }
    return false;
  };
}
