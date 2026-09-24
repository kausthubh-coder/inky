import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SchoolScanCoordinator } from "../../dist/electron/scan/coordinator.js";
import { openLocalStore } from "../../dist/electron/storage/index.js";

const schoolRoot = "https://school.example.edu/";
const courseUrl = "https://school.example.edu/course/view.php?id=230";

class Browser {
  url = schoolRoot;
  get navigationUrls() { return [schoolRoot]; }
  get state() { return { url: this.url, title: "School", revision: 1 }; }
  async navigate(url) { this.url = url; return this.snapshot(); }
  async snapshot() {
    return {
      revision: 1, url: this.url, title: "School", text: "Programming in C",
      elements: [{ ref: "r1", role: "link", name: "Programming in C", href: courseUrl }],
      truncated: false,
    };
  }
  async evaluateInPage(code) {
    if (code.includes("hasMoodleConfig")) return { url: this.url, title: "School" };
    return false;
  }
}

async function withScan(script, options, run) {
  const dir = await mkdtemp(join(tmpdir(), "studi-structured-scan-"));
  const store = await openLocalStore(dir);
  let session;
  const runtime = {
    async createScanSession(tools) {
      let release;
      const stopped = new Promise(resolve => { release = resolve; });
      session = {
        toolNames: tools.map(tool => tool.name),
        subscribe: () => () => {},
        prompt: () => script ? script(tools, store, stopped) : stopped,
        abort: async () => { release(); },
        dispose: () => { release(); },
      };
      return session;
    },
  };
  const coordinator = new SchoolScanCoordinator(store, runtime, new Browser(), {
    now: () => "2026-09-13T16:00:00.000Z",
    ...options,
  });
  try {
    await coordinator.saveProfile({ studentName: "Synthetic student", schoolRoot, defaultPermission: "do_not_attempt", scanCadence: "manual" });
    await run({ coordinator, store, get session() { return session; } });
  } finally {
    coordinator.dispose();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("a structured scan stops after no progress and reports incomplete coverage", async () => {
  await withScan(null, { idleLimitMs: 40, activeLimitMs: 500, watchdogIntervalMs: 10 }, async ({ coordinator, session }) => {
    const state = await coordinator.startScan();
    assert.equal(state.scan.state, "partial");
    assert.match(state.scan.failures.join(" "), /No new school work or course/);
  });
});

test("three rejected rows skip their current source instead of looping", async () => {
  await withScan(async (tools, store) => {
    assert.deepEqual(tools.map(tool => tool.name), [
      "scan_status", "scan_record_system", "scan_record_course",
      "scan_record_rows", "scan_record_source", "scan_request_handoff",
    ]);
    await tools.find(tool => tool.name === "scan_record_course").execute("course", { label: "Programming in C" });
    const courseId = store.school.listCourses()[0].courseId;
    const rows = tools.find(tool => tool.name === "scan_record_rows");
    const input = { courseKey: courseId, rows: [{ title: "Invented quiz", href: "https://school.example.edu/mod/quiz/view.php?id=999", kind: "quiz" }] };
    for (let count = 0; count < 3; count++) await assert.rejects(rows.execute("bad", input), /does not show the claimed row/);
    const skipped = await rows.execute("skip", input);
    assert.equal(JSON.parse(skipped.content[0].text).skipped, true);
  }, {}, async ({ coordinator }) => {
    const state = await coordinator.startScan();
    assert.equal(state.scan.state, "partial");
    assert.match(state.scan.failures.join(" "), /three rejected row attempts/);
  });
});

test("Finish with what you found returns promptly and retains the partial result", async () => {
  await withScan(null, {}, async ({ coordinator }) => {
    const pending = coordinator.startScan();
    for (let attempt = 0; attempt < 50 && (await coordinator.state()).scan?.state !== "running"; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const started = performance.now();
    const stopped = await coordinator.finishWithFound();
    assert.ok(performance.now() - started < 1_000);
    assert.equal(stopped.scan.state, "partial");
    assert.match(stopped.scan.failures.join(" "), /ended this check/);
    await pending;
  });
});

test("sign-in resume keeps a finished class and reads only the unfinished class", async () => {
  const first = `${schoolRoot}course/view.php?id=101`;
  const second = `${schoolRoot}course/view.php?id=102`;
  let courseReads = 0;
  class PartialBrowser extends Browser {
    async evaluateInPage(code) {
      if (code.includes("hasMoodleConfig")) return { url: schoolRoot, title: "Moodle", hasMoodleConfig: true };
      if (code.includes("core_course_get_enrolled_courses_by_timeline_classification")) return {
        origin: new URL(schoolRoot).origin,
        calendar: { data: { events: [] } },
        courses: { data: { courses: [
          { id: 101, fullname: "Math", viewurl: first },
          { id: 102, fullname: "Writing", viewurl: second },
        ] } },
        ical: null,
        failures: [],
      };
      if (code.includes("const skip = new Set(")) {
        courseReads++;
        if (courseReads === 1) return {
          courses: [{ label: "Math", href: first, courseKey: "101", code: null, sourceLabels: [] }],
          rows: [{ assignmentKey: "one", courseKey: "101", title: "Problem set", href: `${schoolRoot}mod/assign/view.php?id=one`, dueAt: null, dueText: null, statusText: null, kind: "assignment", instructions: null, sourceLabels: [] }],
          failures: ["Writing needs sign-in"], completedCourseKeys: ["101"], complete: false,
        };
        const skip = code.match(/const skip = new Set\((\[[^\n]*\])\);/);
        assert.deepEqual(JSON.parse(skip?.[1] ?? "[]"), [first], "the finished class is excluded from page reads");
        return {
          courses: [{ label: "Writing", href: second, courseKey: "102", code: null, sourceLabels: [] }],
          rows: [{ assignmentKey: "two", courseKey: "102", title: "Essay", href: `${schoolRoot}mod/assign/view.php?id=two`, dueAt: null, dueText: null, statusText: null, kind: "assignment", instructions: null, sourceLabels: [] }],
          failures: [], completedCourseKeys: ["102"], complete: true,
        };
      }
      return null;
    }
  }
  const dir = await mkdtemp(join(tmpdir(), "studi-scan-resume-"));
  const store = await openLocalStore(dir);
  const runtime = {
    async createScanSession(tools) {
      return {
        subscribe: () => () => {},
        prompt: async () => tools.find(tool => tool.name === "scan_request_handoff").execute("sign-in", { kind: "school_sign_in", reason: "Sign in to Writing" }),
        abort: async () => {}, dispose: () => {},
      };
    },
  };
  const coordinator = new SchoolScanCoordinator(store, runtime, new PartialBrowser(), { now: () => "2026-09-13T16:00:00.000Z" });
  try {
    await coordinator.saveProfile({ studentName: "Synthetic student", schoolRoot, defaultPermission: "do_not_attempt", scanCadence: "manual" });
    const paused = await coordinator.startScan();
    assert.equal(paused.scan.state, "needs_user", JSON.stringify(paused.scan.failures));
    assert.equal(paused.scan.completedCourseIds.length, 1);
    const resumed = await coordinator.resume();
    assert.equal(resumed.scan.state, "succeeded");
    assert.equal(courseReads, 2);
    assert.equal(resumed.assignments.length, 2);
  } finally {
    coordinator.dispose();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
