import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  detectLmsFromSignals,
  parseCanvasConnectorPayload,
  parseCanvasJson,
  parseMoodleConnectorPayload,
  runSchoolConnector,
} from "../../dist/electron/scan/connectors/index.js";

const fixture = async (name) => JSON.parse(await readFile(
  new URL(`../fixtures/scan-connectors/${name}.json`, import.meta.url),
  "utf8",
));

test("LMS detection requires a recognizable signed-in Moodle or Canvas page", () => {
  assert.equal(detectLmsFromSignals({
    url: "https://school.example/",
    hasMoodleConfig: true,
  }), "moodle");
  assert.equal(detectLmsFromSignals({
    url: "https://school.example/courses/42",
    hasCanvasConfig: true,
  }), "canvas");
  assert.equal(detectLmsFromSignals({
    url: "https://school.example/dashboard",
    title: "Student dashboard",
  }), null);
});

test("Moodle timeline and course replies become coordinator-ready rows", async () => {
  const snapshot = parseMoodleConnectorPayload(await fixture("moodle"));

  assert.equal(snapshot.lms, "moodle");
  assert.equal(snapshot.courses.length, 2);
  assert.deepEqual(snapshot.assignments.map((row) => ({
    key: row.assignmentKey,
    course: row.courseKey,
    title: row.title,
    dueAt: row.dueAt,
    kind: row.kind,
  })), [
    {
      key: "concept-quiz",
      course: "programming",
      title: "Concept quiz",
      dueAt: "2026-09-24T00:59:00.000Z",
      kind: "quiz",
    },
    {
      key: "reflection",
      course: "writing",
      title: "Reflection",
      dueAt: null,
      kind: "assignment",
    },
  ]);
});

test("Moodle iCal fallback preserves unknown date precision and maps only known courses", async () => {
  const snapshot = parseMoodleConnectorPayload(await fixture("moodle-ical"));

  assert.equal(snapshot.assignments.length, 2);
  assert.deepEqual(snapshot.assignments.map((row) => ({
    course: row.courseKey,
    title: row.title,
    dueAt: row.dueAt,
    dueText: row.dueText,
  })), [
    {
      course: "programming",
      title: "Pacific lab",
      dueAt: "2026-09-19T06:59:00Z",
      dueText: "20260919T065900Z",
    },
    {
      course: "programming",
      title: "Design document",
      dueAt: null,
      dueText: "20261007",
    },
  ]);
  assert.deepEqual(snapshot.failures, [{
    sourceLabel: "Moodle calendar",
    message: "HTTP 404 Not Found",
  }]);
});

test("Canvas strips its JSON guard and merges planner facts into assignment identities", async () => {
  assert.deepEqual(parseCanvasJson('while(1);[{"id":1}]'), [{ id: 1 }]);
  assert.deepEqual(parseCanvasJson('  while ( 1 ) ;  [{"id":2}]'), [{ id: 2 }]);

  const snapshot = parseCanvasConnectorPayload(await fixture("canvas"));
  assert.equal(snapshot.lms, "canvas");
  assert.equal(snapshot.courses.length, 2);
  assert.equal(snapshot.assignments.length, 2);
  const quiz = snapshot.assignments.find((row) => row.assignmentKey === "concept-quiz");
  assert.deepEqual(quiz, {
    assignmentKey: "concept-quiz",
    courseKey: "programming",
    title: "Concept quiz",
    href: "https://canvas.cedar.example/courses/programming/assignments/concept-quiz#submit",
    dueAt: "2026-09-23T23:59:00-04:00",
    dueText: "Sep 23 at 11:59pm",
    statusText: "unsubmitted",
    kind: "quiz",
    instructions: "Answer all ten questions.",
    sourceLabels: ["Canvas assignments", "Canvas planner"],
  });
});

test("runSchoolConnector evaluates API fetches inside the signed-in page", async () => {
  const payload = await fixture("moodle");
  const browser = {
    calls: [],
    async evaluateInPage(source) {
      this.calls.push(source);
      if (source.includes("hasMoodleConfig")) {
        return {
          url: "https://moodle.cedar.example/",
          title: "Dashboard",
          hasMoodleConfig: true,
          hasMoodleTimeline: true,
        };
      }
      assert.match(source, /core_calendar_get_action_events_by_timesort/);
      assert.match(source, /core_course_get_enrolled_courses_by_timeline_classification/);
      assert.match(source, /\/calendar\/export\.php/);
      assert.match(source, /credentials: 'same-origin'/);
      return payload;
    },
  };

  const result = await runSchoolConnector(
    browser,
    "https://moodle.cedar.example/",
  );
  assert.equal(browser.calls.length, 2);
  assert.equal(result.kind, "moodle");
  assert.equal(result.origin, "https://moodle.cedar.example");
  assert.equal(result.complete, true);
  assert.equal(result.courses.length, 2);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.failures, []);
});

test("Canvas signed-in fetch covers planner, courses, assignments, pagination and guarded JSON", async () => {
  const payload = await fixture("canvas");
  const browser = {
    async evaluateInPage(source) {
      assert.match(source, /\/api\/v1\/planner\/items/);
      assert.match(source, /\/api\/v1\/courses\?/);
      assert.match(source, /\/assignments\?/);
      assert.match(source, /while\\s\*\\\(/);
      assert.match(source, /response\.headers\.get\('link'\)/);
      assert.match(source, /credentials: 'same-origin'/);
      return payload;
    },
  };

  const result = await runSchoolConnector(
    browser,
    "https://canvas.cedar.example/dashboard",
    { kind: "canvas" },
  );
  assert.equal(result.kind, "canvas");
  assert.equal(result.complete, true);
  assert.equal(result.rows.length, 2);
});

test("runSchoolConnector rejects data evaluated on a different page origin", async () => {
  const payload = await fixture("moodle");
  const result = await runSchoolConnector(
    { evaluateInPage: async () => payload },
    "https://other-school.example/",
    { kind: "moodle" },
  );

  assert.equal(result.complete, false);
  assert.deepEqual(result.courses, []);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.failures, [{
    sourceLabel: "LMS detection",
    message: "The signed-in page is on https://moodle.cedar.example, not the school origin https://other-school.example",
  }]);
});
