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

async function withScan(script, options, run, SchoolBrowser = Browser) {
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
  const coordinator = new SchoolScanCoordinator(store, runtime, new SchoolBrowser(), {
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
      "scan_record_rows", "scan_record_source", "scan_request_handoff", "scan_record_class_note",
      "scan_set_category", "scan_record_exam", "scan_record_school_memory", "school_read_class", "school_read_email",
    ]);
    await tools.find(tool => tool.name === "scan_record_course").execute("course", { label: "Programming in C" });
    const courseId = store.school.listCourses()[0].courseId;
    const rows = tools.find(tool => tool.name === "scan_record_rows");
    const input = { courseKey: courseId, rows: [{ title: "Invented quiz", href: "https://school.example.edu/mod/quiz/view.php?id=999", kind: "quiz" }] };
    for (let count = 0; count < 3; count++) await assert.rejects(rows.execute("bad", input), /No page read in this check shows/);
    const skipped = await rows.execute("skip", input);
    assert.equal(JSON.parse(skipped.content[0].text).skipped, true);
  }, {}, async ({ coordinator }) => {
    const state = await coordinator.startScan();
    assert.equal(state.scan.state, "partial");
    assert.match(state.scan.failures.join(" "), /three rejected row attempts/);
  });
});

test("the agent says what a site's status wording means", async () => {
  await withScan(async (tools, store) => {
    await tools.find(tool => tool.name === "scan_record_course").execute("course", { label: "Programming in C" });
    const courseKey = store.school.listCourses()[0].courseId;
    const rows = tools.find(tool => tool.name === "scan_record_rows");
    const row = (id, extra) => ({ title: `HW ${id}`, href: `https://school.example.edu/hw?dep=${id}`, statusText: "Current Score: 10 / 10 Points", kind: "homework", ...extra });
    await rows.execute("rows", { courseKey, rows: [row(8, { state: "graded" }), row(9, {})] });
  }, {}, async ({ coordinator, store }) => {
    await coordinator.startScan();
    const status = title => store.assignments.listAll().find(item => item.title === title)?.schoolStatus.state;
    assert.equal(status("HW 8"), "graded");
    assert.equal(status("HW 9"), "unknown", "without the agent's reading, unfamiliar wording stays unknown");
  }, class extends Browser {
    canNavigateObserved() { return true; }
    recentlyShowed() { return true; }
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

test("a class note is saved once per verified class and replaced on the next check", async () => {
  await withScan(async (tools) => {
    await tools.find(tool => tool.name === "scan_record_course").execute("course", { label: "Programming in C" });
    const note = tools.find(tool => tool.name === "scan_record_class_note");
    await note.execute("note", { courseKey: "Programming in C", text: "Homework 40%, exams 60%. Late work loses 10% a day." });
    await note.execute("note", { courseKey: "Programming in C", text: "Homework 40%, two midterms 30%, final 30%." });
    await assert.rejects(note.execute("note", { courseKey: "Unknown class", text: "x" }), /Verify the class first/);
  }, { idleLimitMs: 40, activeLimitMs: 500, watchdogIntervalMs: 10 }, async ({ coordinator, store }) => {
    await coordinator.startScan();
    const notes = store.notes.list().filter(entry => entry.scope === "course");
    assert.equal(notes.length, 1);
    assert.match((await store.notes.read(notes[0].noteId)).content, /two midterms/);
  });
});
