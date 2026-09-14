import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SchoolScanCoordinator } from "../../dist/electron/scan/coordinator.js";
import { ManagerCoordinator } from "../../dist/electron/manager/coordinator.js";
import { openLocalStore } from "../../dist/electron/storage/index.js";
import { assignmentWorkEligibility } from "../../dist/shared/index.js";

const now = "2026-09-12T22:00:00.000Z";
const due = "2026-09-14T23:59:00.000Z";
const courseUrl = "https://school.example/course/view.php?id=201";
const assignmentUrl = "https://school.example/mod/assign/view.php?id=801";

async function invoke(tools, name, input) {
  const reply = await tools.find(tool => tool.name === name).execute("test", input);
  return JSON.parse(reply.content[0].text);
}

class Browser {
  revision = 0;
  url = courseUrl;
  text = "Calculus";
  truncated = false;
  async navigate(url) { this.url = url; }
  async snapshot() { return { revision: ++this.revision, url: this.url, title: "Calculus", text: this.text,
    elements: [{ ref: `r${this.revision}:1`, role: "heading", name: this.url === courseUrl ? "Calculus" : "Puzzle Game" }], truncated: this.truncated }; }
  detail(extra = "") { this.url = assignmentUrl; this.text = `Calculus\nPuzzle Game\nNot submitted\n${due}\nBuild a playable game.\nRubric and navigation between paragraphs.\nSubmit a README PDF with walkthroughs.\n${extra}`; }
}

class Runtime {
  next = async () => {};
  prompts = [];
  sessions = 0;
  async createScanSession(tools) { this.sessions++; return { prompt: async prompt => { this.prompts.push(prompt); await this.next(tools); }, subscribe: () => () => {}, dispose() {}, abort: async () => {} }; }
  async createWorkerSession() { return { sessionId: "worker", sessionPath: "worker.jsonl", toolNames: [], subscribe: () => () => {}, dispose() {} }; }
}

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "studi-scan-evidence-"));
  const store = await openLocalStore(root);
  const browser = new Browser();
  const runtime = new Runtime();
  const manager = await ManagerCoordinator.create(store, runtime, { now: () => now });
  const scan = new SchoolScanCoordinator(store, runtime, browser, { manager, now: () => now });
  try {
    await scan.saveProfile({ studentName: "Avery", schoolRoot: courseUrl, defaultPermission: "attempt", scanCadence: "manual" });
    await run({ root, store, browser, runtime, manager, scan });
  } finally { scan.dispose(); manager.dispose(); store.close(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

async function recordReady(tools, browser) {
  browser.url = courseUrl; browser.text = "Calculus";
  const course = await invoke(tools, "scan_record_course", { label: "Calculus" });
  browser.detail();
  return invoke(tools, "scan_record_assignment", {
    courseId: course.courseId, title: "Puzzle Game", dueText: due,
    schoolStatus: { state: "not_submitted", text: "Not submitted" },
    requirementExcerpts: [{ text: "Build a playable game." }, { text: "Submit a README PDF with walkthroughs." }],
    requirementsComplete: true,
  });
}

async function finishPartial(tools) {
  return invoke(tools, "scan_finish", { coverage: [{ target: "Course: Calculus", status: "partial", failure: "Other class sources still need checking." }], navigationHints: [] });
}

test("visible IANA deadlines retain exact precision and reject unsupported model dates", async () => fixture(async ({ scan, runtime, browser, store }) => {
  let recorded;
  runtime.next = async tools => {
    const assignment = await recordReady(tools, browser);
    const dueText = "September 14, 2026 at 11:59 PM America/New_York";
    browser.detail(dueText);
    const input = { courseId: assignment.courseId, title: assignment.title, dueText };
    recorded = await invoke(tools, "scan_record_assignment", { ...input, dueAt: "2026-09-14T23:59:00-04:00" });
    assert.equal(recorded.dueAt, "2026-09-15T03:59:00.000Z");
    assert.equal(recorded.deadlinePrecision, "datetime");
    for (const wrong of ["2026-09-14T23:59:00-05:00", "2026-09-15T23:59:00-04:00", "2026-09-14T11:59:00-04:00"]) {
      await assert.rejects(invoke(tools, "scan_record_assignment", { ...input, dueAt: wrong }), /does not match the visible due-date text/);
      assert.equal(store.assignments.get(recorded.assignmentId).dueAt, recorded.dueAt);
    }
    const derived = await invoke(tools, "scan_record_assignment", input);
    assert.equal(derived.dueAt, recorded.dueAt, "an omitted model timestamp uses the visible named zone, not the computer zone");
    await assert.rejects(invoke(tools, "scan_record_assignment", { ...input, dueText: dueText.replace("September 14", "September 15") }), /claimed assignment due date/);
    await finishPartial(tools);
  };
  const result = await scan.startScan();
  assert.equal(result.scan.state, "partial");
  assert.ok(result.scan.failures.includes("Other class sources still need checking."), result.scan.failures.join("; "));
  assert.equal(store.assignments.get(recorded.assignmentId).deadlinePrecision, "datetime");
}));

test("a scoped details check refreshes only its assignment and waits for an explicit work request", async () => fixture(async ({ scan, runtime, browser, store, manager }) => {
  let assignment;
  runtime.next = async tools => { assignment = await recordReady(tools, browser); await finishPartial(tools); };
  const previous = (await scan.startScan()).scan;
  const profile = store.school.getProfile();
  store.assignments.put({ ...assignment, requirementsState: "partial", missingRequirements: ["README requirements"] });
  const unrelated = store.assignments.put({ ...assignment, assignmentId: "unrelated", title: "Other assignment", sourceTarget: "https://school.example/mod/assign/view.php?id=999", sourceIdentity: undefined });
  manager.setWorkStartMode("automatic");
  const task = store.tasks.listAll().find(item => item.assignmentId === assignment.assignmentId);
  runtime.next = async tools => {
    assert.equal(browser.url, assignment.sourceTarget);
    browser.detail();
    await assert.rejects(invoke(tools, "scan_record_course", { label: "Calculus" }), /cannot change school/);
    await assert.rejects(invoke(tools, "scan_read_assignment", { assignmentId: unrelated.assignmentId }), /selected/);
    await assert.rejects(invoke(tools, "scan_record_assignment", { courseId: assignment.courseId, title: "Other assignment" }), /only the selected assignment/);
    await invoke(tools, "scan_record_assignment", { courseId: assignment.courseId, title: assignment.title, dueText: due,
      schoolStatus: { state: "not_submitted", text: "Not submitted" },
      requirementExcerpts: [{ text: "Build a playable game." }, { text: "Submit a README PDF with walkthroughs." }], requirementsComplete: true, missingRequirements: [] });
    const snapshot = browser.snapshot.bind(browser);
    const rubricUrl = "https://school.example/puzzle-rubric";
    browser.snapshot = async () => { const page = await snapshot(); return { ...page, elements: [...page.elements, { ref: `r${page.revision}:2`, role: "link", name: "Puzzle rubric", href: rubricUrl }] }; };
    await invoke(tools, "scan_check_source", { kind: "details" });
    browser.url = rubricUrl;
    browser.text = "Puzzle Game\nProvide a walkthrough for every level.";
    await invoke(tools, "scan_record_assignment", { courseId: assignment.courseId, title: assignment.title,
      requirementExcerpts: [{ text: "Provide a walkthrough for every level." }], requirementsComplete: true, missingRequirements: [] });
    await invoke(tools, "scan_record_source", { kind: "details", courseId: assignment.courseId, state: "checked", assignmentIds: [assignment.assignmentId] });
    await invoke(tools, "scan_finish", { coverage: [{ target: `Assignment: ${assignment.title}`, status: "verified" }], navigationHints: [] });
  };
  const result = await scan.startScan(assignment.assignmentId);
  assert.equal(result.scan.state, "succeeded", result.scan.failures.join("; "));
  assert.equal(result.scan.targetAssignmentId, assignment.assignmentId);
  assert.deepEqual(result.scan.observedCourseIds, []);
  assert.deepEqual(store.school.getScan(previous.scanId), previous);
  assert.deepEqual(store.school.getProfile(), profile);
  assert.deepEqual(store.assignments.get(unrelated.assignmentId), JSON.parse(JSON.stringify(unrelated)));
  assert.equal(assignmentWorkEligibility(store.assignments.get(assignment.assignmentId), now).eligible, true);
  assert.equal(store.assignments.get(assignment.assignmentId).sourceTarget, assignment.sourceTarget);
  assert.equal(store.assignments.get(assignment.assignmentId).sourceIdentity, assignment.sourceIdentity);
  assert.equal(store.assignments.get(assignment.assignmentId).requirementEvidence.length, 3);
  assert.equal(manager.state().entries.length, 0, "even automatic mode cannot enqueue from a read-only check");
  assert.equal(manager.state().lease, null);
  assert.equal(store.tasks.get(task.taskId).state, "discovered");
  manager.setWorkStartMode("manual");
  manager.enqueue({ taskId: task.taskId, requestOrigin: "student" });
  assert.equal(manager.state().entries[0].requestOrigin, "student");
  await assert.rejects(scan.startScan("no-longer-exists"), /no longer available/);
}));

test("scoped sign-in recovery survives coordinator restart and submitted work stays out of the queue", async () => fixture(async ({ scan, runtime, browser, store, manager }) => {
  let assignment;
  runtime.next = async tools => { assignment = await recordReady(tools, browser); await finishPartial(tools); };
  await scan.startScan();
  store.assignments.put({ ...assignment, requirementsState: "partial" });
  runtime.next = async tools => { await invoke(tools, "scan_request_handoff", { kind: "school_sign_in", reason: "Sign in to check this assignment." }); };
  const paused = await scan.startScan(assignment.assignmentId);
  assert.equal(paused.scan.state, "needs_user");
  await assert.rejects(scan.startScan(assignment.assignmentId), /already owns|must finish/);
  scan.dispose();
  const resumed = new SchoolScanCoordinator(store, runtime, browser, { manager, now: () => now });
  try {
    runtime.next = async tools => {
      browser.detail(); browser.text = browser.text.replace("Not submitted", "Submitted for grading");
      await invoke(tools, "scan_record_assignment", { courseId: assignment.courseId, title: assignment.title,
        schoolStatus: { state: "submitted", text: "Submitted for grading" } });
      await invoke(tools, "scan_finish", { coverage: [{ target: `Assignment: ${assignment.title}`, status: "verified" }], navigationHints: [] });
    };
    const result = await resumed.resume();
    assert.equal(result.scan.state, "succeeded", result.scan.failures.join("; "));
    assert.equal(result.scan.scanId, paused.scan.scanId);
    assert.equal(result.scan.targetAssignmentId, assignment.assignmentId);
    assert.match(runtime.prompts.at(-1), /Check only this selected assignment/);
    assert.equal(store.assignments.get(assignment.assignmentId).schoolStatus.state, "submitted");
    assert.equal(assignmentWorkEligibility(store.assignments.get(assignment.assignmentId), now).eligible, false);
    assert.equal(manager.state().entries.length, 0);
  } finally { resumed.dispose(); }
}));

test("separate excerpts persist; date-only updates remove invented precision; false submission and late claims fail", async () => fixture(async ({ scan, runtime, browser, store }) => {
  runtime.next = async tools => {
    const assignment = await recordReady(tools, browser);
    assert.equal(assignment.requirementEvidence.length, 2);
    assert.equal(assignmentWorkEligibility(assignment, now).eligible, true);
    await assert.rejects(invoke(tools, "scan_record_assignment", { courseId: assignment.courseId, title: assignment.title,
      instructions: "Build a playable game. Submit a README PDF with walkthroughs." }), /claimed assignment instructions/);
    browser.detail("Submitted for grading\nLate submissions are not accepted.\nOctober 13, 2026");
    await assert.rejects(invoke(tools, "scan_record_assignment", { courseId: assignment.courseId, title: assignment.title,
      schoolStatus: { state: "not_submitted", text: "Submitted for grading" } }), /School status/);
    await assert.rejects(invoke(tools, "scan_record_assignment", { courseId: assignment.courseId, title: assignment.title,
      schoolStatus: { state: "not_submitted", text: "Not submitted\n2026-09-14T23:59:00.000Z\nBuild a playable game.\nRubric and navigation between paragraphs.\nSubmit a README PDF with walkthroughs.\nSubmitted for grading" } }), /School status/);
    await assert.rejects(invoke(tools, "scan_record_assignment", { courseId: assignment.courseId, title: assignment.title,
      latePolicy: { state: "accepted", text: "Late submissions are not accepted." } }), /non-contradictory/);
    browser.text += "\nGrade: —\nGrade pending\nLate submissions accepted.\n2026-09-18T23:55:00.000Z";
    for (const text of ["Grade: —", "Grade pending"]) await assert.rejects(invoke(tools, "scan_record_assignment", {
      courseId: assignment.courseId, title: assignment.title, schoolStatus: { state: "graded", text },
    }), /School status/);
    await assert.rejects(invoke(tools, "scan_record_assignment", { courseId: assignment.courseId, title: assignment.title,
      latePolicy: { state: "accepted", text: "Late submissions accepted.", until: "2026-09-18T23:55:00.000Z", untilText: "2026-09-18T23:55:00.000Z" } }), /cutoff must occur/);
    await assert.rejects(invoke(tools, "scan_record_assignment", { courseId: assignment.courseId, title: assignment.title,
      dueText: "October 13, 2026", dueAt: "2026-10-13T04:00:00.000Z" }), /date-only/);
    const updated = await invoke(tools, "scan_record_assignment", { courseId: assignment.courseId, title: assignment.title,
      dueText: "October 13, 2026", schoolStatus: { state: "submitted", text: "Submitted for grading" } });
    assert.equal(updated.dueAt, undefined);
    assert.equal(updated.deadlinePrecision, "date");
    assert.equal(updated.schoolStatus.state, "submitted");
    assert.equal(updated.requirementEvidence.length, 2);
    assert.equal(assignmentWorkEligibility(updated, now).eligible, false);
    const replaced = await invoke(tools, "scan_record_assignment", { courseId: assignment.courseId, title: assignment.title,
      replaceRequirementsFromSource: true, requirementExcerpts: [{ text: "Build a playable game." }] });
    assert.equal(replaced.requirementEvidence.length, 1);
    assert.equal(replaced.requirementsState, "partial", "removing an old excerpt must not retain an old completeness claim");
    await finishPartial(tools);
  };
  assert.equal((await scan.startScan()).scan.state, "partial");
  assert.equal(store.tasks.listAll()[0].state, "discovered");
}));

test("manual discovery, explicit request, automatic withdrawal and restart keep distinct work intent", async () => fixture(async ({ scan, runtime, browser, store, manager }) => {
  runtime.next = async tools => { await recordReady(tools, browser); await finishPartial(tools); };
  await scan.startScan();
  const task = store.tasks.listAll()[0];
  assert.equal(manager.state().entries.length, 0);
  assert.equal(task.state, "discovered");
  manager.enqueue({ taskId: task.taskId, requestOrigin: "student" });
  assert.equal(manager.state().entries[0].requestOrigin, "student");
  manager.setWorkStartMode("manual");
  assert.equal(manager.state().entries.length, 1, "manual mode keeps a selected student's request");
  manager.dispose();
  const restarted = await ManagerCoordinator.create(store, runtime, { now: () => now });
  assert.equal(restarted.state().entries.length, 1);
  const assignment = store.assignments.listAll()[0];
  store.assignments.put({ ...assignment, schoolStatus: { ...assignment.schoolStatus, state: "submitted", text: "Submitted for grading" } });
  assert.equal(await restarted.startNext(), null);
  assert.equal(store.tasks.get(task.taskId).state, "discovered");
  store.assignments.put(assignment);
  restarted.setWorkStartMode("automatic");
  restarted.enqueue({ taskId: task.taskId, requestOrigin: "automatic" });
  await store.productPreferences.put({ ...await store.productPreferences.get(), workStartMode: "manual" });
  restarted.setWorkStartMode("manual");
  assert.equal(restarted.state().entries.length, 0);
  restarted.dispose();
  const again = await ManagerCoordinator.create(store, runtime, { now: () => now });
  assert.equal(again.state().entries.length, 0);
  assert.equal(store.tasks.get(task.taskId).state, "discovered");
  again.dispose();
}));

test("saved source checkpoint survives restart; unchanged requirements reuse; changed deadline is detected", async () => fixture(async ({ scan, runtime, browser, store, manager }) => {
  let assignment;
  runtime.next = async tools => {
    assignment = await recordReady(tools, browser);
    await invoke(tools, "scan_record_source", { kind: "details", courseId: assignment.courseId, state: "checked", assignmentIds: [assignment.assignmentId] });
    await finishPartial(tools);
  };
  const first = await scan.startScan();
  scan.dispose();
  const resumed = new SchoolScanCoordinator(store, runtime, browser, { manager, now: () => now });
  runtime.next = async tools => {
    browser.detail();
    const reused = await invoke(tools, "scan_check_source", { kind: "details", courseId: assignment.courseId });
    assert.equal(reused.reusable, true);
    assert.equal(store.assignments.get(assignment.assignmentId).schoolStatus.evidence.capturedAt, assignment.schoolStatus.evidence.capturedAt);
    browser.text = browser.text.replace(due, "2026-09-15T23:59:00.000Z");
    assert.equal((await invoke(tools, "scan_check_source", { kind: "details", courseId: assignment.courseId })).unchanged, false);
    browser.detail(); browser.truncated = true;
    assert.equal((await invoke(tools, "scan_check_source", { kind: "details", courseId: assignment.courseId })).reusable, false);
    browser.truncated = false;
    const status = await invoke(tools, "scan_status", {});
    assert.equal(status.assignments[0].requirementEvidence, undefined, "checkpoint summary does not repeat all instructions");
    assert.equal((await invoke(tools, "scan_read_assignment", { assignmentId: assignment.assignmentId })).assignment.requirementEvidence.length, 2);
    await finishPartial(tools);
  };
  try { const result = await resumed.resume(); assert.equal(result.scan.scanId, first.scan.scanId); assert.equal(result.scan.state, "partial"); }
  finally { resumed.dispose(); }
}));

test("source budget rotates sessions from saved progress and stops honestly at a bounded run limit", async () => fixture(async ({ scan, runtime, browser, store, manager }) => {
  scan.dispose();
  const bounded = new SchoolScanCoordinator(store, runtime, browser, { manager, now: () => now, maxSourcesPerSession: 1, maxSessionsPerRun: 2 });
  runtime.next = async tools => {
    if (runtime.sessions === 1) {
      const assignment = await recordReady(tools, browser);
      await invoke(tools, "scan_record_source", { kind: "details", courseId: assignment.courseId, state: "checked", assignmentIds: [assignment.assignmentId] });
    } else {
      const status = await invoke(tools, "scan_status", {});
      assert.equal(status.scan.sourceCheckpoints.length, 1);
      assert.equal(status.assignments.length, 1);
      await invoke(tools, "scan_record_source", { kind: "details", courseId: status.assignments[0].courseId, state: "checked", assignmentIds: [status.assignments[0].assignmentId] });
    }
  };
  try {
    const result = await bounded.startScan();
    assert.equal(runtime.sessions, 2);
    assert.equal(result.scan.state, "partial");
    assert.match(result.scan.failures[0], /budget/);
    assert.equal(result.assignments.length, 1);
    assert.match(runtime.prompts[1], /saved source checkpoints/);
  } finally { bounded.dispose(); }
}));

test("a list cannot attach another assignment's requirements to the selected assignment", async () => fixture(async ({ scan, runtime, browser }) => {
  runtime.next = async tools => {
    const assignment = await recordReady(tools, browser);
    browser.url = courseUrl;
    browser.text = "Calculus\nPuzzle Game\nOther homework: write a lab report.";
    const original = browser.snapshot.bind(browser);
    browser.snapshot = async () => ({ ...await original(), elements: [{ ref: "link", role: "link", name: "Puzzle Game", href: assignmentUrl }] });
    await assert.rejects(invoke(tools, "scan_record_assignment", { courseId: assignment.courseId, title: assignment.title,
      requirementExcerpts: [{ text: "write a lab report" }], requirementsComplete: true }), /detail page|row/);
    await finishPartial(tools);
  };
  assert.equal((await scan.startScan()).scan.state, "partial");
}));

test("eligibility excludes completed, stale, incomplete and overdue work; extension must still be open", async () => fixture(async ({ scan, runtime, browser }) => {
  runtime.next = async tools => {
    const ready = await recordReady(tools, browser);
    for (const state of ["unknown", "submitted", "graded", "locked"]) assert.equal(assignmentWorkEligibility({ ...ready, schoolStatus: { ...ready.schoolStatus, state } }, now).eligible, false);
    assert.equal(assignmentWorkEligibility(ready, "2026-09-14T00:00:00.000Z").eligible, false);
    assert.equal(assignmentWorkEligibility({ ...ready, requirementsState: "partial" }, now).eligible, false);
    const overdue = { ...ready, dueAt: "2026-09-11T23:59:00.000Z" };
    assert.equal(assignmentWorkEligibility(overdue, now).eligible, false);
    const extended = { ...overdue, latePolicy: { state: "accepted", text: "Late submissions accepted until September 15", until: "2026-09-15T23:59:00.000Z", evidence: ready.deadlineEvidence } };
    assert.equal(assignmentWorkEligibility(extended, now).eligible, true);
    assert.equal(assignmentWorkEligibility({ ...extended, latePolicy: { ...extended.latePolicy, until: now } }, now).eligible, false);
    await finishPartial(tools);
  };
  assert.equal((await scan.startScan()).scan.state, "partial");
}));


test("list deadlines cannot be borrowed from another assignment", async () => fixture(async ({ scan, runtime, browser }) => {
  runtime.next = async tools => {
    const assignment = await recordReady(tools, browser);
    browser.url = courseUrl;
    browser.text = `Calculus\nPuzzle Game\nOther homework due ${due}`;
    const original = browser.snapshot.bind(browser);
    browser.snapshot = async () => ({ ...await original(), elements: [{ ref: "link", role: "link", name: "Puzzle Game", href: assignmentUrl }] });
    await assert.rejects(invoke(tools, "scan_record_assignment", { courseId: assignment.courseId, title: assignment.title, dueText: due }), /detail page|row/);
    await finishPartial(tools);
  };
  assert.equal((await scan.startScan()).scan.state, "partial");
}));

test("fresh status and deadline cannot revive stale attachment instructions", async () => fixture(async ({ scan, runtime, browser }) => {
  runtime.next = async tools => {
    const ready = await recordReady(tools, browser);
    const stale = { ...ready, requirementEvidence: ready.requirementEvidence.map(item => ({ ...item, evidence: { ...item.evidence, kind: "document", capturedAt: "2026-08-01T00:00:00.000Z" } })) };
    assert.equal(assignmentWorkEligibility(stale, now).eligible, false);
    assert.match(assignmentWorkEligibility(stale, now).reason, /instructions and attached materials/);
    await finishPartial(tools);
  };
  assert.equal((await scan.startScan()).scan.state, "partial");
}));
