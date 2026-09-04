import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { ManagerCoordinator } from "../../dist/electron/manager/coordinator.js";
import { SchoolScanCoordinator } from "../../dist/electron/scan/coordinator.js";
import { openLocalStore } from "../../dist/electron/storage/index.js";

const now = "2026-09-01T12:00:00.000Z";
const rootUrl = "https://school.example.edu/";

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
          courseId: courseId("calc-101"),
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
        await invoke(tools, "scan_finish", {
          coverage: [{ target: "Course: Calculus", status: "verified" }],
          navigationHints: ["Open the <strong>Courses</strong> link, then each current course."],
        });
      },
      async (tools) => {
        browser.showAssignments();
        await invoke(tools, "scan_record_course", { label: "Calculus", courseKey: "calc-101" });
        await invoke(tools, "scan_record_assignment", {
          courseId: courseId("calc-101"),
          title: "Limits practice",
          assignmentKey: "limits-1",
          dueAt: "2026-09-03T15:00:00.000Z",
          dueText: "2026-09-03T15:00:00.000Z",
          observationRef: "assignment-limits",
        });
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

function courseId(courseKey) {
  return `course-${createHash("sha256").update(courseKey).digest("hex").slice(0, 24)}`;
}

async function invoke(tools, name, input) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `missing scan tool ${name}`);
  const result = await tool.execute(`call-${name}`, input, undefined, undefined, {});
  return result.details;
}
