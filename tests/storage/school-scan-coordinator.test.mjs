import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { ManagerCoordinator } from "../../dist/electron/manager/coordinator.js";
import { SchoolScanCoordinator } from "../../dist/electron/scan/coordinator.js";
import { openLocalStore } from "../../dist/electron/storage/index.js";
import { nextSchoolScanAction } from "../../dist/shared/index.js";

const now = "2026-09-01T12:00:00.000Z";
const rootUrl = "https://school.example.edu/";

test("dashboard handoff resumes the same replay without navigating away from the student's page", async () => {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-replay-handoff-")));
  const store = await openLocalStore(root);
  const browser = new RecordingBrowser();
  const finish = async (tools) => {
    browser.showAssignments();
    await invoke(tools, "scan_record_course", { label: "Calculus", courseKey: "calc-101" });
    await recordFixtureInventories(tools, browser);
    await invoke(tools, "scan_finish", {
      coverage: [{ target: "Course: Calculus", status: "verified" }],
      navigationHints: [],
    });
  };
  const runtime = new ScriptedScanRuntime([
    finish,
    async (tools) => {
      await invoke(tools, "scan_request_handoff", { kind: "school_sign_in", reason: "Please sign in." });
    },
    finish,
  ]);
  const coordinator = new SchoolScanCoordinator(store, runtime, browser, { now: () => now });
  try {
    await coordinator.saveProfile({ studentName: "Avery", schoolRoot: rootUrl, defaultPermission: "do_not_attempt", scanCadence: "manual" });
    assert.equal((await coordinator.startScan()).scan.state, "succeeded");
    const paused = await coordinator.replay();
    assert.equal(paused.scan.state, "needs_user");
    assert.equal(paused.workflowRevision, 1);
    const navigationCount = browser.navigations.length;
    const note = {scanId:paused.scan.scanId, text:"Check every class before finishing.",clientMessageId:"00000000-0000-4000-8000-000000000011"};
    await coordinator.sendMessage(note);
    await coordinator.sendMessage(note);
    assert.equal((await coordinator.state()).scan.messages.length, 1, "retrying a paused message does not duplicate it");
    await assert.rejects(coordinator.sendMessage({...note,scanId:"different-check"}), /ended/);
    await assert.rejects(coordinator.replay(), /already owns the visible school browser/);
    const actions = { scan: () => coordinator.startScan(), replay: () => coordinator.replay(), resume: () => coordinator.resume() };
    const resumed = await actions[nextSchoolScanAction(paused)]();
    assert.equal(resumed.scan.state, "succeeded");
    assert.equal(resumed.scan.scanId, paused.scan.scanId);
    assert.equal(resumed.scan.kind, "replay");
    assert.equal(browser.navigations.length, navigationCount, "resume preserves the student's current page");
    assert.match(runtime.prompts.at(-1), /continue the same scan/);
    assert.match(runtime.prompts.at(-1), /Check every class before finishing/);
    await assert.rejects(coordinator.sendMessage({...note,clientMessageId:"after-finish"}), /ended/);
  } finally {
    coordinator.dispose();
    store.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("school scan pauses for sign-ins, records evidence, replays from root, and preserves prior rows on partial and zero results", async () => {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-wp07-scan-")));
  let store;
  let coordinator;
  let manager;
  try {
    store = await openLocalStore(root);
    const browser = new RecordingBrowser();
    let linkedSystemId;
    const runtime = new ScriptedScanRuntime([
      async (tools) => {
        await invoke(tools, "scan_request_handoff", {
          kind: "school_sign_in",
          reason: "Sign in to the school in the visible browser.",
        });
      },
      async (tools) => {
        browser.showAssignments();
        const course = await invoke(tools, "scan_record_course", { label: "Calculus", courseKey: "calc-101" });
        await assert.rejects(
          invoke(tools, "scan_record_assignment", {
            courseId: course.courseId,
            title: "Hallucinated extra credit",
          }),
          /does not contain the claimed assignment title/,
        );
        const recorded = await invoke(tools, "scan_record_assignments", {
          assignments: [{
            courseId: course.courseId,
            title: "Limits practice",
            assignmentKey: "limits-1",
            dueAt: "2026-09-03T15:00:00.000Z",
            dueText: "2026-09-03T15:00:00.000Z",
            observationRef: "assignment-limits",
          }],
        });
        assert.equal(recorded.length, 1);
        const linked = await invoke(tools, "scan_record_linked_system", {
          label: "WebAssign",
          systemKey: "webassign",
          state: "needs_user",
          observationRef: "linked-webassign",
          stateText: "Sign in required",
          stateObservationRef: "linked-state",
        });
        linkedSystemId = linked.linkedSystemId;
        await invoke(tools, "scan_request_handoff", {
          kind: "linked_system_sign_in",
          linkedSystemId,
          reason: "Sign in to WebAssign in the visible browser.",
        });
      },
      async (tools) => {
        browser.showLinkedSignedOut();
        await assert.rejects(
          invoke(tools, "scan_record_linked_system", {
            label: "WebAssign",
            systemKey: "webassign",
            state: "verified",
            observationRef: "linked-webassign",
            stateText: "Not signed in",
            stateObservationRef: "linked-state",
          }),
          /contradicts verified/,
        );
        assert.equal(
          store.school.getLinkedSystem(linkedSystemId).state,
          "needs_user",
          "a contradictory sign-in fact is rejected before persistence",
        );
        browser.showLinkedSignedIn();
        await assert.rejects(
          invoke(tools, "scan_record_linked_system", {
            label: "WebAssign",
            systemKey: "webassign",
            state: "verified",
            observationRef: "linked-webassign",
            stateText: "Signed in as Avery",
            stateObservationRef: "linked-state",
          }),
          /lists its assignments or shows an empty assignment list/,
        );
        assert.equal(
          store.school.getLinkedSystem(linkedSystemId).state,
          "needs_user",
          "a dashboard or account-name page cannot persist verified",
        );
        browser.showEmptyIndex();
        await invoke(tools, "scan_record_linked_system", {
          label: "WebAssign",
          systemKey: "webassign",
          state: "verified",
          observationRef: "linked-webassign",
          stateText: "No assignments due",
          stateObservationRef: "linked-state",
        });
        assert.equal(store.school.getLinkedSystem(linkedSystemId).state, "verified");
        browser.showLinkedHomework();
        await invoke(tools, "scan_record_assignment", {
          courseId: calculusCourseId(),
          title: "Series homework",
          assignmentKey: "series-1",
          dueAt: "2026-09-04T15:00:00.000Z",
          dueText: "2026-09-04T15:00:00.000Z",
          observationRef: "assignment-series",
        });
        await invoke(tools, "scan_record_linked_system", {
          label: "WebAssign",
          systemKey: "webassign",
          state: "verified",
          observationRef: "linked-webassign",
          stateText: "Series homework",
          stateObservationRef: "assignment-series",
        });
        // A submit/autograde page is not an assignment catalog, so the scan omits it.
        browser.showAutograder();
        await recordFixtureInventories(tools, browser);
    await invoke(tools, "scan_finish", {
          coverage: [{ target: "Course: Calculus", status: "verified" }],
          navigationHints: ["Open the <strong>Courses</strong> link, then each current course."],
        });
      },
      async (tools) => {
        browser.showAssignments();
        await invoke(tools, "scan_record_course", { label: "Calculus", courseKey: "calc-101" });
        await invoke(tools, "scan_record_assignment", {
          courseId: calculusCourseId(),
          title: "Limits practice",
          assignmentKey: "limits-1",
          dueAt: "2026-09-03T15:00:00.000Z",
          dueText: "2026-09-03T15:00:00.000Z",
          observationRef: "assignment-limits",
        });
        await recordFixtureInventories(tools, browser);
    await invoke(tools, "scan_finish", {
          coverage: [{ target: "Assignment lists", status: "partial", failure: "One course page timed out." }],
          navigationHints: [],
        });
      },
      async (tools) => {
        await assert.rejects(
          invoke(tools, "scan_finish", {
            coverage: [{ target: "Courses", status: "verified" }],
            navigationHints: [],
          }),
          /cannot complete without at least one browser-verified course/,
        );
      },
    ]);
    manager = await ManagerCoordinator.create(store, runtime, { now: () => now });
    coordinator = new SchoolScanCoordinator(store, runtime, browser, { now: () => now, manager });

    await coordinator.saveProfile({
      studentName: "Avery",
      schoolRoot: rootUrl,
      defaultPermission: "attempt",
      scanCadence: "daily",
    });
    let state = await coordinator.startScan();
    assert.equal(state.scan.state, "needs_user");
    assert.equal(state.scan.handoff.kind, "school_sign_in");
    assert.equal(state.profile.onboardingState, "needs_sign_in");

    state = await coordinator.resume();
    assert.equal(state.scan.state, "needs_user");
    assert.equal(state.scan.handoff.kind, "linked_system_sign_in");
    assert.equal(state.linkedSystems[0].state, "needs_user");
    assert.equal(state.courses.length, 1);
    assert.equal(state.assignments.length, 1);

    state = await coordinator.resume();
    assert.equal(state.scan.state, "succeeded");
    assert.equal(state.profile.onboardingState, "ready");
    assert.equal(state.linkedSystems.length, 1, "a non-catalog autograder page is omitted");
    assert.equal(state.linkedSystems[0].state, "verified");
    assert.equal(state.workflowRevision, 1);
    assert.equal(state.courses[0].lastVerifiedScanId, state.scan.scanId);
    assert.equal(state.assignments.length, 2);
    assert.equal(state.assignments[0].lastVerifiedScanId, state.scan.scanId);
    assert.equal(state.assignments[0].evidence[0].sourceTarget, rootUrl);
    const webAssignHomework = state.assignments.find((item) => item.title === "Series homework");
    assert.equal(webAssignHomework?.sourceTarget, "https://webassign.example.edu/home");
    const assignment = state.assignments[0];
    const assignmentTasks = store.tasks.listAll().filter((task) => task.assignmentId === assignment.assignmentId);
    assert.equal(assignmentTasks.length, 1, "a verified assignment has one durable task origin");
    assert.equal(manager.state().entries.length, 2, "each permitted assignment enters the existing manager queue once");
    assert.equal(manager.state().entries[0].taskId, assignmentTasks[0].taskId);

    const workflow = store.school.getWorkflow();
    assert.equal(workflow.root, rootUrl);
    assert.equal(workflow.steps[0].target, rootUrl);
    assert.ok(workflow.steps.every((step) => step.kind === "navigate"));
    assert.doesNotMatch(JSON.stringify(workflow), /SECRET_PAGE_HTML/);
    const navigationNote = await store.notes.read(store.notes.list({ scope: "school", about: "scan" })[0].noteId);
    assert.match(navigationNote.content, /Open the &lt;strong&gt;Courses&lt;\/strong&gt; link/);

    const successfulRows = { courses: state.courses.length, assignments: state.assignments.length };
    manager.steerNext(assignmentTasks[0].taskId);
    const manualPriority = manager.state().entries[0].priority;
    state = await coordinator.replay();
    assert.equal(state.scan.kind, "replay");
    assert.equal(state.scan.state, "partial");
    assert.deepEqual(
      { courses: state.courses.length, assignments: state.assignments.length },
      successfulRows,
      "partial replay keeps prior verified rows",
    );
    assert.equal(browser.navigations.at(-1), rootUrl, "replay returns to the school root");
    assert.match(runtime.prompts.at(-1), /Structured replay hints/);
    assert.match(runtime.prompts.at(-1), /Re-observe every target/);
    assert.equal(state.courses[0].lastVerifiedScanId, state.scan.scanId, "replay re-observed the course");
    assert.equal(state.assignments[0].lastVerifiedScanId, state.scan.scanId, "replay refreshed the assignment from a current fact");
    assert.equal(store.tasks.listAll().filter((task) => task.assignmentId === assignment.assignmentId).length, 1, "replay does not duplicate the task origin");
    assert.equal(manager.state().entries.length, 2, "replay does not duplicate the queue entry");
    assert.equal(manager.state().entries[0].priority, manualPriority, "replay preserves manual priority");
    assert.equal(state.workflowRevision, 1, "partial replay does not write a workflow");

    state = await coordinator.startScan();
    assert.equal(state.scan.state, "failed");
    assert.match(state.scan.failures[0], /no browser-verified courses/i);
    assert.deepEqual({ courses: state.courses.length, assignments: state.assignments.length }, successfulRows);

    state = await coordinator.recordMissedCourseFeedback("Also look for the honors seminar.");
    assert.equal(state.workflowRevision, 1, "a correction is a note and does not mutate the executable workflow");
    assert.deepEqual(state.profile.missedCourseFeedback, ["Also look for the honors seminar."]);
    const correction = store.notes.list({ scope: "school", subjectId: "primary-school", about: "scan" })
      .find((entry) => entry.key === "student-corrections");
    assert.ok(correction);
    assert.match((await store.notes.read(correction.noteId)).content, /honors seminar/);

    const databaseBytes = await readFile(join(root, "studi.sqlite3"));
    assert.equal(databaseBytes.includes(Buffer.from("SECRET_PAGE_HTML")), false, "page text never enters SQLite");
  } finally {
    coordinator?.dispose();
    manager?.dispose();
    store?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("scan recording rejects a secret-shaped current URL and cannot create a verified row", async () => {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-wp07-secret-")));
  let store;
  let coordinator;
  try {
    store = await openLocalStore(root);
    const browser = new RecordingBrowser();
    const runtime = new ScriptedScanRuntime([
      async (tools) => {
        browser.url = "https://school.example.edu/dashboard?session=secret";
        browser.text = "Unsafe course";
        await assert.rejects(
          invoke(tools, "scan_record_course", { label: "Unsafe course" }),
          /secret-shaped query parameters/,
        );
      },
    ]);
    coordinator = new SchoolScanCoordinator(store, runtime, browser, { now: () => now });
    await coordinator.saveProfile({
      studentName: "Avery",
      schoolRoot: rootUrl,
      defaultPermission: "attempt",
      scanCadence: "manual",
    });
    const state = await coordinator.startScan();
    assert.equal(state.scan.state, "failed");
    assert.equal(state.courses.length, 0);
  } finally {
    coordinator?.dispose();
    store?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("a caught scan failure reports the original cause without letting telemetry break recovery", async () => {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-scan-error-")));
  const store = await openLocalStore(root);
  const failure = new Error("Provider stopped", { cause: new Error("Upstream timeout") });
  const reports = [];
  const coordinator = new SchoolScanCoordinator(store, new ScriptedScanRuntime([async () => { throw failure; }]), new RecordingBrowser(), {
    now: () => now,
    onError: (error, scanId) => { reports.push({ error, scanId }); throw new Error("Analytics unavailable"); },
  });
  try {
    await coordinator.saveProfile({ studentName: "Avery", schoolRoot: rootUrl, defaultPermission: "attempt", scanCadence: "manual" });
    const state = await coordinator.startScan();
    assert.equal(state.scan.state, "failed");
    assert.match(state.scan.failures[0], /Provider stopped/);
    assert.equal(reports[0].error, failure);
    assert.equal(reports[0].scanId, state.scan.scanId);
  } finally {
    coordinator.dispose(); store.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("student takeover pauses a running scan without failing it", async () => {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-scan-takeover-")));
  let store;
  let coordinator;
  try {
    store = await openLocalStore(root);
    const browser = new RecordingBrowser();
    let resolvePrompt;
    let startedPrompt;
    const promptStarted = new Promise((resolve) => { startedPrompt = resolve; });
    const promptGate = new Promise((resolve) => { resolvePrompt = resolve; });
    let turn = 0;
    const runtime = {
      async createScanSession(tools) {
        return {
          sessionId: "hang-scan",
          sessionPath: "hang-scan.jsonl",
          toolNames: tools.map((tool) => tool.name),
          subscribe() { return () => {}; },
          prompt: async () => {
            if (turn++ === 0) {
              startedPrompt();
              await promptGate;
              return;
            }
            browser.showAssignments();
            const course = await invoke(tools, "scan_record_course", { label: "Calculus", courseKey: "calc-101" });
            await invoke(tools, "scan_record_assignment", {
              courseId: course.courseId,
              title: "Limits practice",
              assignmentKey: "limits-1",
              dueAt: "2026-09-03T15:00:00.000Z",
              dueText: "2026-09-03T15:00:00.000Z",
              observationRef: "assignment-limits",
            });
            await recordFixtureInventories(tools, browser);
    await invoke(tools, "scan_finish", {
              coverage: [{ target: "Course: Calculus", status: "verified" }],
              navigationHints: [],
            });
          },
          compact: async () => {},
          abort: async () => { resolvePrompt(); },
          replace: async () => {},
          dispose() {},
        };
      },
    };
    coordinator = new SchoolScanCoordinator(store, runtime, browser, { now: () => now });
    await coordinator.saveProfile({
      studentName: "Avery",
      schoolRoot: rootUrl,
      defaultPermission: "attempt",
      scanCadence: "manual",
    });
    const started = coordinator.startScan();
    await promptStarted;
    const paused = await coordinator.requestTakeover();
    assert.equal(paused.scan.state, "needs_user");
    assert.equal(paused.scan.handoff.kind, "student_takeover");
    assert.equal(paused.scan.failures.length, 0);
    const afterAbort = await started;
    assert.equal(afterAbort.scan.state, "needs_user");
    assert.equal(afterAbort.scan.handoff.kind, "student_takeover");
    const resumed = await coordinator.resume();
    assert.equal(resumed.scan.state, "succeeded");
    assert.equal(resumed.courses.length, 1);
  } finally {
    coordinator?.dispose();
    store?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

class RecordingBrowser {
  url = rootUrl;
  revision = 0;
  navigations = [];
  text = "School sign in";
  elements = [];

  async navigate(url) {
    this.url = new URL(url).href;
    this.navigations.push(this.url);
    return this.snapshot();
  }

  async snapshot() {
    this.revision += 1;
    return {
      revision: this.revision,
      url: this.url,
      title: "School portal",
      text: `${this.text}\nSECRET_PAGE_HTML should never be persisted`,
      elements: this.elements,
      truncated: false,
    };
  }

  showAssignments() {
    this.text = "Calculus Limits practice WebAssign Sign in required 2026-09-03T15:00:00.000Z";
    this.elements = [
      { ref: "course-calculus", role: "link", name: "Calculus" },
      { ref: "assignment-limits", role: "link", name: "Limits practice — due 2026-09-03T15:00:00.000Z" },
      { ref: "linked-webassign", role: "link", name: "WebAssign" },
      { ref: "linked-state", role: "status", name: "Sign in required" },
    ];
  }

  showLinkedSignedIn() {
    this.url = "https://webassign.example.edu/";
    this.text = "WebAssign Signed in as Avery";
    this.elements = [
      { ref: "linked-webassign", role: "heading", name: "WebAssign" },
      { ref: "linked-state", role: "status", name: "Signed in as Avery" },
    ];
  }

  showLinkedSignedOut() {
    this.url = "https://webassign.example.edu/";
    this.text = "WebAssign Not signed in";
    this.elements = [
      { ref: "linked-webassign", role: "heading", name: "WebAssign" },
      { ref: "linked-state", role: "status", name: "Not signed in" },
    ];
  }

  showEmptyIndex() {
    this.url = "https://webassign.example.edu/home";
    this.text = "WebAssign No assignments due";
    this.elements = [
      { ref: "linked-webassign", role: "heading", name: "WebAssign" },
      { ref: "linked-state", role: "status", name: "No assignments due" },
    ];
  }

  showLinkedHomework() {
    this.url = "https://webassign.example.edu/home";
    this.text = "WebAssign Series homework 2026-09-04T15:00:00.000Z";
    this.elements = [
      { ref: "linked-webassign", role: "heading", name: "WebAssign" },
      { ref: "assignment-series", role: "link", name: "Series homework — due 2026-09-04T15:00:00.000Z" },
    ];
  }

  showAutograder() {
    this.url = "https://jenkins.example.edu/job/csc316";
    this.text = "Jenkins dashboard Build now IBM Sorting Machine";
    this.elements = [
      { ref: "jenkins", role: "heading", name: "Jenkins" },
      { ref: "build", role: "button", name: "Build now" },
    ];
  }
}

class ScriptedScanRuntime {
  scripts;
  prompts = [];
  turn = 0;

  constructor(scripts) { this.scripts = scripts; }

  async createScanSession(tools) {
    const listeners = new Set();
    return {
      sessionId: "scripted-scan",
      sessionPath: "scripted-scan.jsonl",
      toolNames: tools.map((tool) => tool.name),
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      prompt: async (prompt) => {
        this.prompts.push(prompt);
        const script = this.scripts[this.turn++];
        if (!script) throw new Error("No scan script remains");
        await script(tools);
        for (const listener of listeners) listener({ schemaVersion: 1, type: "terminal", outcome: "completed" });
      },
      compact: async () => {},
      abort: async () => {},
      replace: async () => {},
      dispose() {},
    };
  }

}

function calculusCourseId() {
  return `course-${createHash("sha256").update(`${rootUrl}|calculus`).digest("hex").slice(0, 24)}`;
}

test("Moodle list → detail → changed course label/key → partial replay keeps one assignment and task", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-moodle-identity-"));
  let store = await openLocalStore(root);
  const browser = new RecordingBrowser();
  const list = `${rootUrl}mod/assign/index.php?id=230`;
  const destination = `${rootUrl}mod/assign/view.php?id=1360376`;
  const runtime = new ScriptedScanRuntime([0, 1, 2, 3].map(turn => async tools => {
    const label = turn < 2 ? "C and Software Tools" : "CSC 230 (002) Fall 2026 C and Software Tools";
    browser.url = turn === 0 ? list : `${rootUrl}course/view.php?id=230`;
    browser.text = label;
    browser.elements = [];
    const course = await invoke(tools, "scan_record_course", { label, courseKey: `model-course-${turn}` });
    browser.text = `${label} Homework 1`;
    await assert.rejects(invoke(tools, "scan_record_assignment", { courseId: course.courseId, title: "Homework 1" }), /no unambiguous assignment link/);
    browser.url = turn % 2 === 0 ? list : destination + "&action=view#intro";
    browser.text = "Homework 1 Write a C program. 2026-09-09T12:00:00.000Z";
    browser.elements = turn % 2 === 0 ? [{ ref: "homework", role: "link", name: "Homework 1", href: destination }] : [];
    await invoke(tools, "scan_record_assignment", {
      courseId: course.courseId, title: "Homework 1", assignmentKey: `model-assignment-${turn}`,
      ...(turn === 0 ? { dueAt: "2026-09-09T12:00:00.000Z", dueText: "2026-09-09T12:00:00.000Z", instructions: "Write a C program." } : {}),
    });
    await recordFixtureInventories(tools, browser);
    await invoke(tools, "scan_finish", { coverage: [{ target: `Course: ${label}`, status: turn === 3 ? "partial" : "verified",
      ...(turn === 3 ? { failure: "Another page timed out" } : {}) }], navigationHints: [] });
  }));
  const scan = new SchoolScanCoordinator(store, runtime, browser, { now: () => now });
  try {
    await scan.saveProfile({ studentName: "Avery", schoolRoot: rootUrl, defaultPermission: "do_not_attempt", scanCadence: "manual" });
    const first = await scan.startScan();
    assert.equal(first.scan.state, "succeeded");
    assert.equal(first.assignments[0].sourceTarget, destination);
    assert.equal(first.assignments[0].evidence[0].sourceTarget, list);
    for (let turn = 1; turn < 4; turn++) {
      const next = await scan.replay();
      assert.equal(next.courses.length, 1);
      assert.equal(next.assignments.length, 1);
      assert.equal(next.assignments[0].assignmentId, first.assignments[0].assignmentId);
      assert.equal(next.assignments[0].instructions, "Write a C program.");
      assert.equal(next.assignments[0].dueAt, "2026-09-09T12:00:00.000Z");
      assert.equal(store.tasks.listAll().length, 1);
    }
    scan.dispose(); store.close();
    store = await openLocalStore(root);
    assert.equal(store.assignments.listAll().length, 1);
    assert.equal(store.tasks.listAll().length, 1);
  } finally {
    scan.dispose(); store.close(); await rm(root, { recursive: true, force: true });
  }
});

test("a fresh list link reconciles an old index record with a detail record, but a failed batch rolls back", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-moodle-legacy-"));
  const store = await openLocalStore(root);
  const browser = new RecordingBrowser();
  const list = `${rootUrl}mod/assign/index.php?id=230`;
  const destination = `${rootUrl}mod/assign/view.php?id=1360376`;
  const runtime = new ScriptedScanRuntime([async tools => {
    browser.url = list;
    browser.text = "C and Software Tools Homework 1";
    browser.elements = [{ ref: "hw", role: "link", name: "Homework 1", href: destination }];
    const course = await invoke(tools, "scan_record_course", { label: "C and Software Tools" });
    const original = { schemaVersion: 1, courseId: course.courseId, title: "Homework 1", discoveredAt: now, evidence: [] };
    store.assignments.put({ ...original, assignmentId: "legacy-list", sourceTarget: list });
    store.school.putCourse({ ...course, courseId: "old-long-name", label: "CSC 230 (002) Fall 2026 C and Software Tools" });
    store.assignments.put({ ...original, assignmentId: "legacy-detail", sourceTarget: destination, courseId: "old-long-name" });
    store.assignments.put({ ...original, assignmentId: "legacy-detail-again", sourceTarget: `${destination}&action=view` });
    const input = { courseId: course.courseId, title: "Homework 1" };
    await assert.rejects(invoke(tools, "scan_record_assignments", { assignments: [input, { ...input, title: "Invented homework" }] }), /claimed assignment title/);
    assert.equal(store.assignments.listAll().length, 3);
    assert.equal(store.tasks.listAll().length, 0);
    assert.equal(store.database.handle.prepare("SELECT count(*) AS n FROM record_redirects").get().n, 0);
    await invoke(tools, "scan_record_assignment", input);
    assert.equal(store.assignments.listAll().length, 1);
    assert.equal(store.tasks.listAll().length, 1);
    assert.equal(store.assignments.get("legacy-list").assignmentId, store.assignments.get("legacy-detail").assignmentId);
    assert.equal(store.assignments.get("legacy-list").assignmentId, store.assignments.get("legacy-detail-again").assignmentId);
    await recordFixtureInventories(tools, browser);
    await invoke(tools, "scan_finish", { coverage: [{ target: "Course: C and Software Tools", status: "verified" }], navigationHints: [] });
  }]);
  const scan = new SchoolScanCoordinator(store, runtime, browser, { now: () => now });
  try {
    await scan.saveProfile({ studentName: "Avery", schoolRoot: rootUrl, defaultPermission: "do_not_attempt", scanCadence: "manual" });
    assert.equal((await scan.startScan()).scan.state, "succeeded");
  } finally { scan.dispose(); store.close(); await rm(root, { recursive: true, force: true }); }
});

test("a legacy permission conflict keeps its confirmed identity and pause after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-moodle-conflict-"));
  let store = await openLocalStore(root);
  const browser = new RecordingBrowser();
  const destination = `${rootUrl}mod/assign/view.php?id=1360376`;
  const runtime = new ScriptedScanRuntime([async tools => {
    browser.url = `${rootUrl}mod/assign/index.php?id=230`;
    browser.text = "C and Software Tools Homework 1";
    browser.elements = [{ ref: "hw", role: "link", name: "Homework 1", href: destination }];
    const course = await invoke(tools, "scan_record_course", { label: "C and Software Tools" });
    const original = { schemaVersion: 1, courseId: course.courseId, title: "Homework 1", discoveredAt: now, evidence: [] };
    store.assignments.put({ ...original, assignmentId: "legacy-list", sourceTarget: browser.url });
    store.assignments.put({ ...original, assignmentId: "legacy-detail", sourceTarget: destination });
    store.permissionRules.put({ schemaVersion: 1, scope: "assignment", ruleId: "no-work", assignmentId: "legacy-list", mode: "do_not_attempt", updatedAt: now });
    await invoke(tools, "scan_record_assignment", { courseId: course.courseId, title: "Homework 1" });
    browser.url = destination;
    browser.elements = [];
    await invoke(tools, "scan_record_assignment", { courseId: course.courseId, title: "Homework 1" });
    assert.equal(store.assignmentConflicts.length, 1);
    assert.equal(store.assignments.listAll().length, 2);
    assert.equal(store.tasks.listAll().length, 0);
    await recordFixtureInventories(tools, browser);
    await invoke(tools, "scan_finish", { coverage: [{ target: "Course: C and Software Tools", status: "verified" }], navigationHints: [] });
  }]);
  const scan = new SchoolScanCoordinator(store, runtime, browser, { now: () => now });
  try {
    await scan.saveProfile({ studentName: "Avery", schoolRoot: rootUrl, defaultPermission: "attempt", scanCadence: "manual" });
    const state = await scan.startScan();
    assert.equal(state.scan.state, "succeeded");
    assert.equal(state.assignmentConflicts.length, 1);
    scan.dispose(); store.close(); store = await openLocalStore(root);
    assert.equal(store.assignmentConflicts.length, 1);
    assert.equal(store.assignments.listAll().length, 2);
  } finally { scan.dispose(); store.close(); await rm(root, { recursive: true, force: true }); }
});

async function invoke(tools, name, input) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `missing scan tool ${name}`);
  const result = await tool.execute(`call-${name}`, input, undefined, undefined, {});
  return result.details;
}


test("scan refreshes rotated refs and verifies instructions and dates independently of title refs", async () => {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-scan-facts-")));
  const store = await openLocalStore(root);
  const browser = new RecordingBrowser();
  const runtime = new ScriptedScanRuntime([async tools => {
    browser.showAssignments();
    const course = await invoke(tools, "scan_record_course", { label: "Calculus", courseKey: "calc", observationRef: "r8:1" });
    browser.url = rootUrl + "assignments/limits";
    browser.text += " Write three sentences about limits.";
    const input = { courseId: course.courseId, title: "Limits practice", assignmentKey: "limits", observationRef: "r8:2", dueAt: "2026-09-03T15:00:00.000Z", dueText: "2026-09-03T15:00:00.000Z", instructions: "Write three sentences about limits." };
    const assignment = await invoke(tools, "scan_record_assignment", input);
    assert.equal(assignment.sourceTarget, browser.url);
    assert.equal(assignment.instructions, input.instructions);
    assert.equal(assignment.dueAt, input.dueAt);
    browser.text += " Due 2026-09-09 at 11:59 PM";
    const dated = await invoke(tools, "scan_record_assignment", { ...input, dueAt: undefined, dueText: "2026-09-09 at 11:59 PM" });
    assert.equal(dated.dueAt, new Date("2026-09-09 11:59 PM").toISOString());
    assert.equal(dated.dueText, "2026-09-09 at 11:59 PM");
    await assert.rejects(invoke(tools, "scan_record_assignment", { ...input, instructions: "Invented instructions" }), /claimed assignment instructions/);
    await assert.rejects(invoke(tools, "scan_record_course", { label: "Invented course", observationRef: "r1:1" }), /claimed course label/);
    await recordFixtureInventories(tools, browser);
    await invoke(tools, "scan_finish", { coverage: [{ target: "Course: Calculus", status: "verified" }], navigationHints: [] });
  }]);
  const scan = new SchoolScanCoordinator(store, runtime, browser, { now: () => now });
  try {
    await scan.saveProfile({ studentName: "Avery", schoolRoot: rootUrl, defaultPermission: "do_not_attempt", scanCadence: "manual" });
    assert.equal((await scan.startScan()).scan.state, "succeeded");
  } finally {
    scan.dispose(); store.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});


test("replay preserves course, assignment and task identities when the model changes suggested keys", async () => {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-scan-identity-")));
  const store = await openLocalStore(root);
  const browser = new RecordingBrowser();
  const runtime = new ScriptedScanRuntime(["first-key", "different-key"].map(key => async tools => {
    browser.showAssignments();
    const course = await invoke(tools, "scan_record_course", { label: "Calculus", courseKey: key });
    browser.url = rootUrl + "assignment/limits";
    await invoke(tools, "scan_record_assignment", { courseId: course.courseId, title: "Limits practice", assignmentKey: key });
    await recordFixtureInventories(tools, browser);
    await invoke(tools, "scan_finish", { coverage: [{ target: "Course: Calculus", status: "verified" }], navigationHints: [] });
  }));
  const scan = new SchoolScanCoordinator(store, runtime, browser, { now: () => now });
  try {
    await scan.saveProfile({ studentName: "Avery", schoolRoot: rootUrl, defaultPermission: "do_not_attempt", scanCadence: "manual" });
    const first = await scan.startScan();
    const second = await scan.replay();
    assert.equal(second.courses.length, 1);
    assert.equal(second.assignments.length, 1);
    assert.equal(second.assignments[0].assignmentId, first.assignments[0].assignmentId);
    assert.equal(store.tasks.listAll().length, 1);
  } finally {
    scan.dispose(); store.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

// Explicit simulated inventory pages used by the successful scripted journeys.
test("a running check delivers a steering message once and preserves concurrent discoveries", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-scan-steering-"));
  const store = await openLocalStore(root);
  const browser = new RecordingBrowser();
  let started, finish, delivered;
  const entered = new Promise(resolve => { started=resolve; });
  const finishTurn = new Promise(resolve => { finish=resolve; });
  const delivery = new Promise(resolve => { delivered=resolve; });
  const calls=[];
  const runtime = new ScriptedScanRuntime([async tools => {
    started(tools);
    await finishTurn;
    await recordFixtureInventories(tools,browser);
    await invoke(tools,"scan_finish",{coverage:[{target:"Course: Calculus",status:"verified"}],navigationHints:[]});
  }]);
  const create = runtime.createScanSession.bind(runtime);
  runtime.createScanSession = async tools => ({...await create(tools),steer:async text=>{calls.push(text);await delivery;}});
  const scan = new SchoolScanCoordinator(store,runtime,browser,{now:()=>now});
  try {
    await scan.saveProfile({studentName:"Avery",schoolRoot:rootUrl,defaultPermission:"do_not_attempt",scanCadence:"manual"});
    const running=scan.startScan();
    const tools=await entered;
    const input={scanId:(await scan.state()).scan.scanId,text:"Check every class",clientMessageId:"00000000-0000-4000-8000-000000000012"};
    const sending=scan.sendMessage(input);
    await assert.rejects(scan.sendMessage(input),/still being delivered/);
    browser.showAssignments();
    const course=await invoke(tools,"scan_record_course",{label:"Calculus"});
    delivered();await sending;await scan.sendMessage(input);
    const state=await scan.state();
    assert.deepEqual(calls,[input.text]);
    assert.equal(state.scan.messages.length,1);
    assert.ok(state.scan.observedCourseIds.includes(course.courseId));
    finish();assert.equal((await running).scan.state,"succeeded");
  } finally { delivered?.();finish?.();scan.dispose();store.close();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}); }
});

test("new destination links refine legacy directory records without losing their IDs", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-legacy-directory-"));
  const store = await openLocalStore(root);
  const browser = new RecordingBrowser();
  const runtime = new ScriptedScanRuntime([0, 1].map(turn => async tools => {
    browser.url = rootUrl;
    browser.text = "Calculus Limits practice 2026-09-03T15:00:00.000Z";
    browser.elements = turn ? [
      {ref:"course",role:"link",name:"Calculus",href:rootUrl+"courses/calculus"},
      {ref:"assignment",role:"link",name:"Limits practice",href:rootUrl+"assignments/limits"},
    ] : [];
    const course = await invoke(tools,"scan_record_course",{label:"Calculus"});
    await invoke(tools,"scan_record_assignment",{courseId:course.courseId,title:"Limits practice",...(turn ? {dueAt:"2026-09-03T15:00:00.000Z",dueText:"2026-09-03T15:00:00.000Z"} : {})});
    await recordFixtureInventories(tools,browser);
    await invoke(tools,"scan_finish",{coverage:[{target:"Course: Calculus",status:"verified"}],navigationHints:[]});
  }));
  const scan = new SchoolScanCoordinator(store,runtime,browser,{now:()=>now});
  try {
    await scan.saveProfile({studentName:"Avery",schoolRoot:rootUrl,defaultPermission:"do_not_attempt",scanCadence:"manual"});
    const original = await scan.startScan();
    const {sourceIdentity:_, ...legacy} = original.assignments[0];
    store.assignments.put(legacy);
    const updated = await scan.replay();
    assert.equal(updated.scan.state,"succeeded", JSON.stringify(updated.scan.failures));
    assert.equal(updated.courses.length,1);
    assert.equal(updated.courses[0].courseId,original.courses[0].courseId);
    assert.equal(updated.assignments.length,1);
    assert.equal(updated.assignments[0].assignmentId,legacy.assignmentId);
    assert.equal(updated.assignments[0].sourceTarget,rootUrl+"assignments/limits");
    assert.equal(updated.assignments[0].dueAt,"2026-09-03T15:00:00.000Z");
    assert.equal(store.tasks.listAll().length,1);
  } finally { scan.dispose();store.close();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}); }
});

async function recordFixtureInventories(tools, browser) {
  const {scan,courses,assignments} = await invoke(tools,"scan_status",{});
  if (!courses.length) return;
  const saved = {url:browser.url,text:browser.text,elements:browser.elements};
  try {
    browser.url=rootUrl; browser.elements=[]; browser.text="All courses: " + courses.map(course=>course.label).join(", ");
    await invoke(tools,"scan_record_inventory",{kind:"courses",state:"complete",itemIds:scan.observedCourseIds,evidenceText:"All courses"});
    for (const course of courses) {
      const items=assignments.filter(item=>item.courseId===course.courseId);
      browser.url=course.sourceTarget; browser.text=course.label + " " + (items.length ? "All assignments: " + items.map(item=>item.title).join(", ") : "No assignments");
      await invoke(tools,"scan_record_inventory",{kind:"assignments",courseId:course.courseId,state:items.length?"complete":"empty",itemIds:items.map(item=>item.assignmentId),evidenceText:items.length?"All assignments":"No assignments"});
    }
  } finally { Object.assign(browser,saved); }
}

test("school check reports only new or changed work and refuses incomplete inventory",async()=>{
 const root=await mkdtemp(join(tmpdir(),"studi-scan-changes-")); const store=await openLocalStore(root); const browser=new RecordingBrowser();
 const runtime=new ScriptedScanRuntime([0,1,2,3].map(turn=>async tools=>{
  browser.showAssignments();
  const course=await invoke(tools,"scan_record_course",{label:"Calculus"});
  const due=turn>=2?"2026-09-04T15:00:00.000Z":"2026-09-03T15:00:00.000Z";
  browser.text="Calculus Limits practice "+due; browser.elements=[];
  await invoke(tools,"scan_record_assignment",{courseId:course.courseId,title:"Limits practice",dueAt:due,dueText:due});
  if(turn!==3) await recordFixtureInventories(tools,browser);
  await invoke(tools,"scan_finish",{coverage:[{target:"Course: Calculus",status:"verified"}],navigationHints:[]});
 }));
 const coordinator=new SchoolScanCoordinator(store,runtime,browser,{now:()=>now});
 try {
  await coordinator.saveProfile({studentName:"Avery",schoolRoot:rootUrl,defaultPermission:"do_not_attempt",scanCadence:"manual"});
  const first=await coordinator.startScan();assert.equal(first.scan.changes.length,1);assert.equal(first.scan.changes[0].kind,"new");
  const unchanged=await coordinator.replay();assert.equal(unchanged.scan.changes.length,0);
  const updated=await coordinator.replay();assert.equal(updated.scan.changes[0].kind,"updated");assert.ok(updated.scan.changes[0].fields.includes("dueAt"));assert.equal(updated.assignments.length,1);
  const incomplete=await coordinator.replay();assert.equal(incomplete.scan.state,"partial");assert.match(incomplete.scan.failures.join(" "),/inventory|directory/);
 }finally{coordinator.dispose();store.close();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
