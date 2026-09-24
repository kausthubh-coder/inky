import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startLms } from "../../../.studi-lms/build/server.mjs";
import { evaluateScan, loadExpected } from "../evaluate-scan.mjs";
import { sanitizeHar } from "../record.mjs";

async function fixture(t, scenarioId = "moodle-noisy", options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "studi-scan-fixture-"));
  const school = await startLms({
    scenarioId,
    runDirectory: join(directory, "run"),
    ...options,
  });
  t.after(() => school.close());
  return { school, directory };
}
const get = async (url) => {
  const response = await fetch(url);
  return {
    status: response.status,
    html: await response.text(),
    headers: response.headers,
  };
};
test("unknown LMS needs a browser crawl and keeps all nine tasks reachable", async (t) => {
  const { school } = await fixture(t, "unknown-lms");
  const expected = await loadExpected("unknown-lms");
  assert.equal(expected.assignments.length, 9);
  const dashboard = await get(school.url);
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.html, /Show more/);
  assert.match(dashboard.html, /<template id="more-work">/);
  assert.match(dashboard.html, /\/classroom\/programming/);
  assert.doesNotMatch(dashboard.html, /class="activity|modtype_|block_timeline|planner-app|\/course\/view\.php|\/courses\/programming/);
  assert.doesNotMatch(dashboard.html.split("<template")[0], /Design document/, "one task is absent from the dashboard");
  const course = await get(`${school.url}/classroom/programming`);
  assert.equal(course.status, 200);
  assert.match(course.html, /Design document/);
  assert.match(course.html, /<td>Oct 7<\/td>/);
  assert.match(course.html, /<th>Due<\/th>/);
  assert.match(course.html, /\/work\/exercise-05/);
  assert.match(course.html, new RegExp(school.origins.statistics.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal((await get(`${school.url}/calendar/export.php`)).status, 404);
  assert.equal((await get(`${school.url}/courses/programming`)).status, 404);
  assert.equal((await get(`${school.url}/mod/lti/view.php?id=webassign-1`)).status, 404);
  assert.equal((await get(`${school.url}/api/v1/planner/items`)).status, 404);
  assert.equal((await get(`${school.url}/lib/ajax/service.php`)).status, 404);
});
test("noisy course has 130 activities, exactly nine real tasks, independent goldens and per-course Learn sources", async (t) => {
  const { school } = await fixture(t),
    { state, truth } = school.inspect();
  assert.equal(
    state.activities.filter((a) => a.courseId === "programming").length,
    130,
  );
  assert.equal(truth.expectedAssignmentIds.length, 9);
  const expected = await loadExpected("moodle-noisy");
  for (const task of expected.assignments) {
    const id = task.href.split(/id=|\/assignments\//).at(-1),
      actual = state.activities.find((a) => a.id === id);
    assert.ok(actual, task.title);
    assert.equal(actual.title, task.title);
    assert.equal(
      actual.dueAt === null ? null : Date.parse(actual.dueAt),
      task.dueAt === null ? null : Date.parse(task.dueAt),
    );
    assert.equal(actual.workKind, task.kind);
  }
  for (const course of state.courses)
    for (const suffix of ["syllabus", "review", "slides", "past-quiz"])
      assert.ok(state.assets.some((a) => a.id === `${course.id}-${suffix}`));
  const page = await get(school.url + "/course/view.php?id=programming");
  assert.equal(page.status, 200);
  assert.equal((page.html.match(/<tr class="activity/g) ?? []).length, 130);
  assert.match(page.html, /<section class="section"/);
  assert.match(page.html, /<td>Oct 7<\/td>/);
  assert.match(page.html, /\/mod\/lti\/view.php/);
  assert.match(page.html, /<a href="\/mod\/assign\/view.php\?id=pacific-lab">Submit Lab 3<\/a>/);
  const labPage = await get(school.url + "/mod/assign/view.php?id=pacific-lab");
  assert.equal(labPage.status, 200);
  assert.match(labPage.html, /Pacific lab/);
  assert.equal(school.inspect().effects.some((event) => event.type === "submitted"), false);
  assert.match((await get(school.url)).html, /block_timeline block-timeline/);
  assert.match(
    (await get(school.url + "/mod/quiz/view.php?id=concept-quiz")).html,
    /<iframe title="Quiz instructions"/,
  );
  assert.match(
    (await get(school.url + "/quiz-instructions/concept-quiz")).html,
    /push A then B/,
  );
  for (const type of ["assign", "resource", "page", "url", "folder", "forum"]) {
    const item = state.activities.find((a) => a.moduleType === type);
    assert.equal(
      (await get(`${school.url}/mod/${type}/view.php?id=${item.id}`)).status,
      200,
    );
  }
});
test("Moodle AJAX methods require sesskey; unknown writes fail; disabled connectors retain public calendar", async (t) => {
  const { school } = await fixture(t),
    html = (await get(school.url)).html,
    key = /sesskey:"([^"]+)"/.exec(html)?.[1];
  assert.ok(key);
  const call = (methodname, keyValue = key) =>
    fetch(`${school.url}/lib/ajax/service.php?sesskey=${keyValue}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ methodname, args: { courseid: "programming" } }]),
    });
  const reply = await (
    await call("core_calendar_get_action_events_by_timesort")
  ).json();
  assert.equal(reply[0].data.events.length, 7);
  assert.equal((await call("core_course_get_contents")).status, 200);
  assert.equal(
    (await call("core_course_get_enrolled_courses_by_timeline_classification"))
      .status,
    200,
  );
  assert.equal((await call("mod_assign_submit_for_grading")).status, 403);
  assert.equal((await call("core_course_get_contents", "bad")).status, 403);
  school.advance("course-failure");
  assert.equal((await call("core_course_get_contents")).status, 503);
  assert.equal((await call("core_course_get_contents")).status, 200);
  const disabled = (await fixture(t, "moodle-noisy-no-api")).school;
  assert.equal(
    (await fetch(disabled.url + "/lib/ajax/service.php")).status,
    404,
  );
  assert.equal(
    (await get(disabled.url + "/calendar/view.php?view=upcoming")).status,
    200,
  );
  const exported = await fetch(disabled.url + "/calendar/export.php");
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("content-type"), /text\/calendar/);
  const calendar = await exported.text();
  assert.match(calendar, /BEGIN:VCALENDAR/);
  assert.match(calendar, /SUMMARY:Pacific lab/);
  assert.match(calendar, /DTSTART:20260919T065900Z/);
  assert.equal(
    school
      .inspect()
      .effects.filter((e) =>
        ["draft_saved", "submission_committed", "lesson_completed"].includes(
          e.type,
        ),
      ).length,
    0,
  );
});
test("Canvas routes and prefixed APIs expose planner/assignments/modules, API-off falls back", async (t) => {
  const { school } = await fixture(t, "canvas-basic");
  for (const path of [
    "/courses/programming",
    "/courses/programming/assignments",
    "/courses/programming/modules",
    "/courses/programming/assignments/concept-quiz",
  ])
    assert.equal((await get(school.url + path)).status, 200);
  for (const path of [
    "/api/v1/courses",
    "/api/v1/planner/items",
    "/api/v1/courses/programming/assignments",
    "/api/v1/courses/programming/modules",
  ]) {
    const { html, status } = await get(school.url + path);
    assert.equal(status, 200);
    assert.ok(html.startsWith("while(1);"));
    assert.ok(JSON.parse(html.slice(9)).length);
  }
  const disabled = (await fixture(t, "canvas-basic-no-api")).school;
  assert.equal(
    (await fetch(disabled.url + "/api/v1/planner/items")).status,
    404,
  );
  assert.equal((await get(disabled.url + "/calendar")).status, 200);
});
test("separate-origin SSO waits for remembered push, rejects early/replayed tickets and expires mid-run", async (t) => {
  const { school } = await fixture(t, "moodle-sso");
  const root = await fetch(school.url, { redirect: "manual" });
  assert.equal(
    root.headers.get("location"),
    school.origins.unity + "/sso/login",
  );
  const login = await fetch(root.headers.get("location"), {
    redirect: "manual",
  });
  const duo = new URL(login.headers.get("location"), school.origins.unity);
  assert.match((await get(duo)).html, /Remembered device/);
  const callback = school.url + "/sso/callback" + duo.search;
  assert.equal((await fetch(callback, { redirect: "manual" })).status, 403);
  await new Promise((r) => setTimeout(r, 1550));
  assert.equal((await fetch(callback, { redirect: "manual" })).status, 303);
  assert.equal((await fetch(callback, { redirect: "manual" })).status, 403);
  school.advance("expire-session");
  assert.equal((await fetch(school.url, { redirect: "manual" })).status, 303);
  school.advance("forget-device");
  const handoff = await get(school.url);
  assert.match(handoff.html, /Waiting for you/);
  assert.doesNotMatch(handoff.html, /setTimeout/);
  school.advance("approve-push");
  assert.match((await get(school.url)).html, /Timeline/);
});
test("LTI is a one-use cross-origin POST; Gradescope has separate course list and dates", async (t) => {
  const { school } = await fixture(t),
    launch = (await get(school.url + "/mod/lti/view.php?id=webassign-1")).html;
  const token = /name="launch" value="([^"]+)"/.exec(launch)[1];
  const post = (origin) =>
    fetch(school.origins.statistics + "/lti/launch", {
      method: "POST",
      redirect: "manual",
      headers: { origin, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ launch: token }),
    });
  assert.equal((await post("https://foreign.invalid")).status, 403);
  assert.equal((await post(school.url)).status, 303);
  assert.equal((await post(school.url)).status, 403);
  assert.match(
    (await get(school.origins.statistics + "/assignments/webassign-1")).html,
    /September 16, 2026 at 11:59 PM ET/,
  );
  assert.match(
    (await get(school.origins.feedback + "/courses")).html,
    /Gradescope-like/,
  );
});
test("university syllabus, shim, actual image-only PDF, docx, download failure and latency", async (t) => {
  const { school } = await fixture(t);
  const syllabus = await get(
    school.origins.university + "/classes/programming",
  );
  assert.match(syllabus.html, /Core methods - 45%/);
  const pdf = await fetch(
    school.origins.university + "/download/programming-syllabus",
  );
  assert.match(pdf.headers.get("content-disposition"), /^attachment/);
  assert.match(await pdf.text(), /^%PDF/);
  assert.match(
    (await get(school.url + "/file-shim/programming-review")).html,
    /Download programming-review.docx/,
  );
  const doc = Buffer.from(
    await (
      await fetch(school.url + "/download/programming-review")
    ).arrayBuffer(),
  );
  assert.equal(doc.readUInt32LE(), 0x04034b50);
  assert.ok(doc.includes(Buffer.from("word/document.xml")));
  assert.ok(doc.includes(Buffer.from("1. Trace a stack")));
  const image = await (
    await fetch(school.url + "/files/programming-past-quiz")
  ).text();
  assert.match(image, /\/Subtype \/Image/);
  assert.doesNotMatch(image, /\bTj\b/);
  school.advance("download-failure");
  assert.equal(
    (await fetch(school.url + "/download/programming-review")).status,
    503,
  );
  assert.equal(
    (await fetch(school.url + "/download/programming-review")).status,
    200,
  );
  const before = performance.now();
  await get(school.url + "/calendar?latency=80");
  assert.ok(performance.now() - before >= 70);
  assert.equal((await get(school.url + "/?latency=Infinity")).status, 400);
});
test("scan scoring rejects junk, duplicate, invented dates, wrong class, writes, unknown metrics and 25% regressions", async () => {
  const expected = await loadExpected("moodle-noisy"),
    origins = {
      school: "http://127.0.0.1:1000",
      statistics: "http://127.0.0.1:1001",
      feedback: "http://127.0.0.1:1002",
    };
  const observation = {
    status: "completed",
    scanState: "succeeded",
    assignments: expected.assignments.map((e) => ({
      ...e,
      sourceTarget: e.href.replace(/^(\w+):/, (_, s) => origins[s]),
    })),
    metrics: {
      durationMs: 60000,
      toolCalls: 20,
      usage: {
        inputTokens: 1000,
        outputTokens: 50,
        cacheReadTokens: 500,
        cacheWriteTokens: 0,
      },
    },
  };
  const grade = (o = observation, effects = [], extra = {}) =>
    evaluateScan({ expected, observation: o, origins, effects, ...extra });
  const good = grade();
  assert.equal(good.passed, true);
  const launchLink = structuredClone(observation);
  launchLink.assignments[7].sourceTarget = origins.school + "/mod/lti/view.php?id=webassign-1";
  assert.equal(grade(launchLink).passed, true, "A real LTI launch is a valid assignment link, not junk");
  assert.equal(good.metrics.tokens, 1550);
  for (const mutate of [
    (o) => o.assignments.pop(),
    (o) => o.assignments.push({ ...o.assignments[0] }),
    (o) => (o.assignments[0].sourceTarget += "fake"),
    (o) => (o.assignments[2].dueAt = "2026-10-07T00:00:00Z"),
    (o) => (o.assignments[0].course = "Other class"),
    (o) => (o.status = "timed_out"),
  ]) {
    const o = structuredClone(observation);
    mutate(o);
    assert.equal(grade(o).passed, false);
  }
  assert.equal(grade(observation, [{ type: "draft_saved" }]).passed, false);
  assert.equal(grade(observation, null).metrics.schoolWrites, null);
  const slow = structuredClone(observation);
  slow.metrics.durationMs = 75000;
  assert.equal(
    grade(slow, [], { previous: good }).regressions[0].field,
    "minutes",
  );
  const faster = structuredClone(observation);
  faster.metrics.durationMs = 40000;
  assert.equal(grade(faster, [], { previous: good }).regressions.length, 0);
  const unknown = structuredClone(observation);
  unknown.metrics.usage = null;
  assert.equal(grade(unknown, [], { slo: { tokens: 10000 } }).passed, false);
  assert.equal(grade(unknown).metrics.tokens, null);
});
test("HAR sanitizer strips personal fields and strict offline replay returns 404 for misses", async (t) => {
  const raw = {
    log: {
      entries: [
        {
          request: {
            method: "GET",
            url: "https://school.example/course?id=12345",
            headers: [{ name: "cookie", value: "SECRET" }],
          },
          response: {
            status: 200,
            headers: [{ name: "set-cookie", value: "SECRET" }],
            content: {
              mimeType: "text/html",
              text: '<h1>Jane Doe jane@school.example</h1><a href="https://school.example/course?id=12345">Course</a><script>sesskey="SECRET";</script>',
            },
          },
        },
      ],
    },
  };
  const clean = sanitizeHar(raw, {
    origins: { "https://school.example": "school" },
    replacements: { "Jane Doe": "Alex Morgan", 12345: "course-one" },
  });
  const text = JSON.stringify(clean);
  assert.doesNotMatch(text, /SECRET|Jane Doe|12345|jane@/);
  assert.match(text, /Alex Morgan/);
  const dir = await mkdtemp(join(tmpdir(), "studi-replay-"));
  await writeFile(join(dir, "recording.json"), JSON.stringify(clean));
  const { school } = await fixture(t, "smoke", { replayDirectory: dir });
  const page = await get(school.url + "/course?id=course-one");
  assert.equal(page.status, 200);
  assert.ok(page.html.includes(school.url));
  assert.match(
    page.headers.get("content-security-policy"),
    /default-src 'none'/,
  );
  assert.equal((await fetch(school.url + "/course?id=unrecorded")).status, 404);
  assert.equal(
    (await fetch(school.url + "/course?id=course-one", { method: "POST" }))
      .status,
    404,
  );
});
