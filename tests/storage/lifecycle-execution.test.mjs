import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { AssignmentExecutionCoordinator, submissionConfirmationVisible } from "../../dist/electron/assignment/coordinator.js";
import { VisibleBrowserWork } from "../../dist/electron/browser/work-ownership.js";
import { nextScheduleRun, plannedAssignmentStart } from "../../dist/electron/lifecycle/schedule.js";
import { ManagerCoordinator } from "../../dist/electron/manager/coordinator.js";
import { SchoolScanCoordinator } from "../../dist/electron/scan/coordinator.js";
import { openLocalStore } from "../../dist/electron/storage/index.js";
import { initializeHomeworkWorkspace } from "../../dist/electron/files/workspace.js";
import { homeworkRecord } from "../../dist/shared/homework-state.js";

const initialNow = "2026-09-01T12:00:00.000Z";

test("a negative school status is not mistaken for a submitted confirmation", () => {
  assert.equal(submissionConfirmationVisible("Submission status: Not submitted", "Submitted"), false);
  assert.equal(submissionConfirmationVisible("Submission status: Submitted; not yet graded", "Submitted"), true);
  assert.equal(submissionConfirmationVisible("Draft saved; not submitted", "Submission received"), false);
  assert.equal(submissionConfirmationVisible("Submission received. Receipt: 42", "Submission received"), true);
});

test("homework planning uses real deadlines and local working hours without inventing dates", () => {
  assert.equal(plannedAssignmentStart({}, initialNow, "America/New_York"), undefined);
  assert.equal(plannedAssignmentStart({ dueAt: "2026-08-31T12:00:00.000Z" }, initialNow, "America/New_York"), undefined);
  assert.equal(plannedAssignmentStart({ dueAt: "2026-09-03T18:00:00.000Z" }, initialNow, "America/New_York"), "2026-09-02T18:00:00.000Z");
  assert.equal(plannedAssignmentStart({ dueAt: "2026-09-02T06:00:00.000Z" }, initialNow, "America/New_York"), initialNow);
  assert.equal(plannedAssignmentStart({ dueAt: "2026-09-02T10:00:00.000Z" }, "2026-09-02T03:00:00.000Z", "America/New_York"), undefined, "a deadline before the next working window cannot promise a start");
  assert.equal(plannedAssignmentStart({ dueAt: "2026-11-02T07:00:00.000Z" }, "2026-10-31T12:00:00.000Z", "America/New_York"), "2026-11-01T13:00:00.000Z", "daylight-saving change keeps the next 08:00 local start");
});

test("due schedules coalesce missed occurrences and preserve wall-clock time across DST", async () => {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-wp08-schedule-")));
  try {
    const store = await openLocalStore(root);
    const schedule = {
      schemaVersion: 1,
      scheduleId: "school-scan",
      cadence: "daily",
      state: "enabled",
      timezone: "America/New_York",
      localTime: "01:30",
      nextRunAt: "2026-03-07T06:30:00.000Z",
      updatedAt: "2026-03-06T12:00:00.000Z",
    };
    store.lifecycle.putSchedule(schedule);
    const now = "2026-03-09T12:00:00.000Z";
    const next = nextScheduleRun(schedule, now);
    assert.equal(next, "2026-03-10T05:30:00.000Z", "the same local time survives the DST offset change");
    const claimed = store.lifecycle.claimDueSchedule(now, next);
    assert.equal(claimed.lastClaimedOccurrence, schedule.nextRunAt);
    assert.equal(claimed.nextRunAt, next);
    assert.equal(store.lifecycle.claimDueSchedule(now, next), null, "the same missed wake cannot be claimed twice");
    assert.equal(
      nextScheduleRun({ ...schedule, localTime: "10:59" }, "2026-09-01T14:59:37.000Z"),
      "2026-09-02T14:59:00.000Z",
      "seconds after today's scheduled minute advance to the next local day, not the next minute",
    );
    store.close();
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Dot reads the school's confirmation after the student presses Submit", async () => {
  await withStore(async (store) => {
    const now = initialNow;
    seedTask(store, "hand-in", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("attempt", "attempt", now));
    const browser = new FakeBrowser("Submission status: No submission");
    const runtime = new ScriptedRuntime([
      async (tools) => invoke(tools, "assignment_start_review", {
        answers: "1. x = 4",
        completedRequirements: [{ requirement: "Question 1", evidence: "The answer field contains x = 4." }],
        summary: "Submission status: No submission",
      }),
    ]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => now });
    manager.enqueue({ taskId: "task-hand-in" });
    const execution = await AssignmentExecutionCoordinator.create(store, manager, browser, { now: () => now, notify: () => {}, browserWork: new VisibleBrowserWork(store) });
    assert.equal((await execution.startNext()).phase, "ready_review");
    await execution.watchHandIn("task-hand-in", 5, 2_000);
    browser.text = "Submission status: Draft (not submitted)";
    await new Promise((done) => setTimeout(done, 40));
    assert.equal(store.lifecycle.getExecution("task-hand-in").phase, "ready_review", "a draft is not a hand-in");
    browser.text = "Submission status: Submitted for grading";
    await new Promise((done) => setTimeout(done, 40));
    assert.equal(store.lifecycle.getExecution("task-hand-in").phase, "submitted");
    assert.equal(store.lifecycle.getSubmissionReceipt("task-hand-in").verifiedStatus, "Submitted for grading");
    execution.dispose();
  });
});

test("attempt review releases the page, continues the queue, and later hand-in waits first and re-acquires it", async () => {
  await withStore(async store => {
    let now = initialNow;
    seedTask(store, "review", "2026-09-02T12:00:00.000Z");
    seedTask(store, "next", "2026-09-03T12:00:00.000Z");
    store.permissionRules.put(rule("attempt", "attempt", now));
    const browser = new FakeBrowser("Answer page", "Submitted successfully");
    const review = tools => invoke(tools, "assignment_start_review", {
      answers: "1. x = 4", completedRequirements: [{ requirement: "Question 1", evidence: "Answer field contains x = 4" }], summary: "Answer is complete",
    });
    const runtime = new ScriptedRuntime([review,
      tools => invoke(tools, "assignment_tell_student", { message: "Which units?", needs: "answer" }),
      async tools => { await browser.snapshot(); await invoke(tools, "browser_submit", { ref: browser.currentRef, confirmation: "SUBMIT", expectedConfirmationText: "Submitted successfully" }); },
    ]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => now });
    const browserWork = new VisibleBrowserWork(store);
    const notices = [];
    const execution = await AssignmentExecutionCoordinator.create(store, manager, browser, { now: () => now, notify: intent => notices.push(intent), browserWork });
    try {
      manager.enqueue({ taskId: "task-review" }); manager.queueNext("task-next"); manager.steerNext("task-review");
      const ready = await execution.startNext();
      assert.equal(ready.phase, "ready_review");
      assert.match((await store.artifacts.read("answer", ready.answerArtifactId)).content, /x = 4/);
      assert.match(await readFile(join(runtime.lastTarget.cwd, "studi-answer.md"), "utf8"), /x = 4/);
      assert.equal(manager.state().lease, null);
      assert.equal(store.lifecycle.getActiveExecution(), null, "saved review does not block Start or school checks");
      assert.equal(browserWork.isScanStartBlocked(), false);
      assert.equal(notices.at(-1).kind, "review_ready");
      now = "2026-09-01T13:00:00.000Z";
      await execution.reconcileDeadlines();
      assert.equal(store.lifecycle.getExecution(ready.taskId).phase, "ready_review", "saved work stays ready until the student hands in");
      assert.equal((await execution.startNext()).taskId, "task-next");
      assert.equal(manager.state().lease.taskId, "task-next");
      await execution.submitReviewed(ready.taskId);
      assert.equal(browser.submitClicks, 0, "asking to hand in never steals a live page");
      assert.equal(manager.state().entries[0].taskId, ready.taskId, "hand-in is queued first");
      assert.equal(manager.state().entries[0].startRequestedAt, now);
      assert.equal(manager.state().lease.taskId, "task-next");
      execution.cancel("task-next");
      await execution.continueSubmission(ready.taskId);
      assert.equal(runtime.sessionNumber, 3, "hand-in acquired a new worker lease in the saved assignment session");
      assert.equal(store.lifecycle.getExecution(ready.taskId).phase, "submitted");
      assert.equal(browser.submitClicks, 1);
      assert.equal(manager.state().lease, null);
      assert.equal(store.lifecycle.getSubmissionReceipt(ready.taskId).verifiedStatus, "Submitted successfully");
      await assert.rejects(execution.submitReviewed(ready.taskId), /not ready/);
      assert.equal(browser.submitClicks, 1);
    } finally { execution.dispose(); manager.dispose(); }
  });
});

test("an unfinished manual hand-in releases its claimed page when the watch window ends", async () => {
  await withStore(async store => {
    let now = initialNow;
    seedTask(store, "watch-timeout", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("attempt", "attempt", now));
    const runtime = new ScriptedRuntime([tools => invoke(tools, "assignment_start_review", {
      answers: "Saved answer", completedRequirements: [{ requirement: "Question 1", evidence: "Answer entered" }], summary: "Ready",
    })]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => now });
    manager.enqueue({ taskId: "task-watch-timeout" });
    const browser = new FakeBrowser("Submission status: Not submitted");
    const execution = await AssignmentExecutionCoordinator.create(store, manager, browser, { now: () => now });
    try {
      const ready = await execution.startNext();
      await execution.watchHandIn(ready.taskId, 3000, 60000);
      assert.equal(manager.state().lease.taskId, ready.taskId);
      now = "2026-09-01T12:02:00.000Z";
      await execution.reconcileDeadlines();
      assert.equal(manager.state().lease, null);
      assert.equal(browser.submitClicks, 0);
      assert.match((await store.artifacts.read("answer", store.lifecycle.getExecution(ready.taskId).answerArtifactId)).content, /Saved answer/);
    } finally { execution.dispose(); manager.dispose(); }
  });
});

test("cancelling review keeps the saved answer and clears both deadlines and browser ownership", async () => {
  await withStore(async (store) => {
    seedTask(store, "cancel-review", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("attempt", "attempt", initialNow));
    const runtime = new ScriptedRuntime([
      async (tools) => invoke(tools, "assignment_start_review", {
        answers: "A saved answer",
        completedRequirements: [{ requirement: "Answer the question", evidence: "The answer is visible." }],
        summary: "Ready for review.",
      }),
    ]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => initialNow });
    manager.enqueue({ taskId: "task-cancel-review" });
    const execution = await AssignmentExecutionCoordinator.create(store, manager, new FakeBrowser(), { now: () => initialNow });
    try {
      const ready = await execution.startNext();
      const cancelled = execution.cancel("task-cancel-review");
      assert.equal(cancelled.phase, "failed");
      assert.equal(cancelled.reviewDeadline, undefined);
      assert.equal(cancelled.handoffDeadline, undefined);
      assert.equal(cancelled.answerArtifactId, ready.answerArtifactId);
      assert.match((await store.artifacts.read("answer", cancelled.answerArtifactId)).content, /A saved answer/);
      assert.equal(store.tasks.get("task-cancel-review").state, "cancelled");
      assert.equal(manager.state().lease, null);
      assert.equal(manager.state().entries.length, 0);
    } finally {
      execution.dispose();
      manager.dispose();
    }
  });
});

test("the worker cannot bypass review to submit, even under an auto-submit rule", async () => {
  await withStore(async (store) => {
    seedTask(store, "submit", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("auto", "auto_submit", initialNow));
    const browser = new FakeBrowser("Answer page", "Submitted successfully");
    const runtime = new ScriptedRuntime([
      async (tools) => invoke(tools, "browser_submit", {
        ref: "submit-1",
        confirmation: "SUBMIT",
        expectedConfirmationText: "Submitted successfully",
      }),
    ]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => initialNow });
    manager.enqueue({ taskId: "task-submit" });
    const execution = await AssignmentExecutionCoordinator.create(store, manager, browser, { now: () => initialNow });
    const waiting = await execution.startNext();
    assert.equal(waiting.phase, "needs_user");
    assert.match(waiting.lastError, /completed review and a request/);
    assert.equal(browser.submitClicks, 0);
    assert.equal(store.lifecycle.getSubmissionReceipt("task-submit"), null);
    execution.dispose();
    manager.dispose();
  });
});

test("School check shows the last school-wide scan, not a finished one-assignment update", async () => {
  await withStore(async store => {
    seedTask(store, "shown", "2026-09-02T12:00:00.000Z");
    const scan = (scanId, state, extra = {}) => store.school.putScan({ schemaVersion: 1, scanId, kind: "replay", state, startedAt: initialNow, updatedAt: initialNow,
      ...(state === "running" || state === "needs_user" ? {} : { completedAt: initialNow }), currentStep: "Checking", coverage: [], failures: state === "failed" ? ["Studi stopped"] : [], handoff: null,
      observedCourseIds: [], observedAssignmentIds: [], observedLinkedSystemIds: [], ...extra });
    scan("scan-school", "succeeded");
    scan("scan-one", "failed", { targetAssignmentId: "assignment-shown" });
    assert.equal(store.school.latestScan().scanId, "scan-one");
    assert.equal(store.school.shownScan().scanId, "scan-school");
    scan("scan-one-live", "running", { targetAssignmentId: "assignment-shown" });
    assert.equal(store.school.shownScan().scanId, "scan-one-live", "an update in progress still shows");
  });
});

test("under \"Do it, I'll hand it in\" Dot hands in once when the student asks, never by itself", async () => {
  await withStore(async store => {
    let now = initialNow;
    seedTask(store, "asked", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("attempt", "attempt", now));
    const browser = new FakeBrowser("Answer page", "Submitted successfully");
    const runtime = new ScriptedRuntime([
      tools => invoke(tools, "assignment_start_review", { answers: "x = 4", completedRequirements: [{ requirement: "Solve", evidence: "The answer field contains x = 4" }], summary: "Ready" }),
      async tools => { await browser.snapshot(); await invoke(tools, "browser_submit", { ref: browser.currentRef, confirmation: "SUBMIT", expectedConfirmationText: "Submitted successfully" }); },
    ]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => now });
    const execution = await AssignmentExecutionCoordinator.create(store, manager, browser, { now: () => now, reviewWindowMs: 60_000, handoffWindowMs: 600_000 });
    try {
      assert.equal((await execution.start("task-asked")).phase, "ready_review");
      now = "2026-09-01T12:02:00.000Z";
      await execution.reconcileDeadlines();
      assert.equal(browser.submitClicks, 0, "the rule never hands in by itself");
      await execution.submitReviewed("task-asked");
      assert.equal(store.tasks.get("task-asked").state, "submitted");
      assert.equal(browser.submitClicks, 1);
    } finally { execution.dispose(); manager.dispose(); }
  });
});

test("saved work carries on: a preserved run can be started again", async () => {
  await withStore(async store => {
    let now = initialNow;
    seedTask(store, "again", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("attempt", "attempt", now));
    const review = tools => invoke(tools, "assignment_start_review", { answers: "x = 4", completedRequirements: [{ requirement: "Solve", evidence: "The answer field contains x = 4" }], summary: "Ready" });
    const runtime = new ScriptedRuntime([review, review]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => now });
    const execution = await AssignmentExecutionCoordinator.create(store, manager, new FakeBrowser(), { now: () => now, reviewWindowMs: 60_000, handoffWindowMs: 120_000 });
    try {
      assert.equal((await execution.start("task-again")).phase, "ready_review");
      await execution.requestTakeover("task-again");
      now = "2026-09-01T12:03:00.000Z";
      await execution.reconcileDeadlines();
      assert.equal(store.tasks.get("task-again").state, "preserved");
      manager.queueNext("task-again");
      const record = () => homeworkRecord({ assignment: store.assignments.get("assignment-again"), task: store.tasks.get("task-again"), execution: store.lifecycle.getExecution("task-again"), mayAttempt: true }).state;
      assert.equal(record(), "scheduled", "saved work waiting in the queue shows as waiting, not stopped");
      execution.cancel("task-again");
      assert.equal(manager.state().entries.length, 0, "Stop takes waiting work out of the queue");
      assert.equal(store.lifecycle.getExecution("task-again").phase, "preserved", "taking it out of the queue leaves the saved run as it was");
      assert.equal(record(), "stopped");
      manager.enqueue({ taskId: "task-again", retry: true });
      assert.equal((await execution.start("task-again")).phase, "ready_review", "Carry on runs Dot again");
    } finally { execution.dispose(); manager.dispose(); }
  });
});

test("the rule never hands in late work by itself unless the school takes late work", async () => {
  await withStore(async store => {
    let now = initialNow;
    seedTask(store, "late", "2026-09-01T11:00:00.000Z");
    store.permissionRules.put(rule("auto", "auto_submit", now));
    const browser = new FakeBrowser("Answer page", "Submitted successfully");
    const runtime = new ScriptedRuntime([
      tools => invoke(tools, "assignment_start_review", { answers: "x = 4", completedRequirements: [{ requirement: "Solve", evidence: "The answer field contains x = 4" }], summary: "Ready" }),
    ]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => now });
    const execution = await AssignmentExecutionCoordinator.create(store, manager, browser, { now: () => now, reviewWindowMs: 60_000, handoffWindowMs: 180_000 });
    try {
      assert.equal((await execution.start("task-late")).phase, "ready_review", "overdue work can still be started and done");
      now = "2026-09-01T12:01:01.000Z";
      await execution.reconcileDeadlines();
      assert.equal(store.lifecycle.getExecution("task-late").phase, "ready_review");
      assert.equal(browser.submitClicks, 0);
      await assert.rejects(execution.submitByRule("task-late"), /deadline has passed/);
    } finally { execution.dispose(); manager.dispose(); }
  });
});

for (const mode of ["ready", "doubts", "heads-up", "paused"]) test(`timed review submission respects ${mode} state and retains readable actions`, async () => {
  await withStore(async (store, root) => {
    let now = initialNow;
    seedTask(store, "timer", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("auto", "auto_submit", now));
    const browser = new FakeBrowser("Answer page", "Submitted successfully");
    const runtime = new ScriptedRuntime([
      async (tools, emit) => {
        emit({ schemaVersion: 1, type: "text", delta: "Checking the answer." });
        emit({ schemaVersion: 1, type: "tool_started", toolCallId: "inspect", toolName: "browser_snapshot", arguments: { sensitive: "RAW_TOOL_SECRET" } });
        emit({ schemaVersion: 1, type: "tool_finished", toolCallId: "inspect", toolName: "browser_snapshot", outcome: "succeeded", durationMs: 12, result: "RAW_TOOL_SECRET" });
        if (mode === "heads-up") {
          const told = await invoke(tools, "assignment_tell_student", { message: "This computer has no graphing tool, so I drew the graph by hand.", needs: "nothing" });
          assert.equal(told.phase, "working", "a heads-up never pauses the work");
        }
        await invoke(tools, "assignment_start_review", { answers: "x = 4", completedRequirements: [{ requirement: "Solve the problem", evidence: "The answer field contains x = 4" }], summary: "Answer ready", ...(mode === "doubts" ? { doubts: [{ where: "Question 1", why: "The diagram scale is unclear" }] } : {}) });
      },
      async tools => {
        await browser.snapshot();
        await invoke(tools, "browser_submit", { ref: browser.currentRef, confirmation: "SUBMIT", expectedConfirmationText: "Submitted successfully" });
      },
    ]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => now });
    const execution = await AssignmentExecutionCoordinator.create(store, manager, browser, { now: () => now, reviewWindowMs: 60_000, handoffWindowMs: 180_000 });
    try {
      const ready = await execution.start("task-timer");
      assert.equal(ready.phase, "ready_review");
      assert.equal(ready.startedAt, initialNow);
      assert.ok(ready.actions.some(action => action.label === "Checking the answer."));
      assert.ok(ready.actions.some(action => action.kind === "tool" && action.outcome === "succeeded"));
      assert.equal(ready.actions.filter(action => action.toolCallId === "inspect").length, 1, "a tool updates one readable activity row");
      assert.doesNotMatch(JSON.stringify(ready.activity), /RAW_TOOL_SECRET/);
      const reopened = await openLocalStore(root);
      try {
        assert.deepEqual(reopened.lifecycle.getExecution("task-timer").actions, ready.actions);
        assert.deepEqual(reopened.lifecycle.getExecution("task-timer").doubts, ready.doubts);
      } finally { reopened.close(); }
      if (mode === "paused") store.lifecycle.putSchedule({ schemaVersion: 1, scheduleId: "school-scan", state: "paused", cadence: "manual", timezone: "UTC", localTime: "08:00", updatedAt: now });
      now = "2026-09-01T12:01:01.000Z";
      await execution.reconcileDeadlines();
      if (mode === "ready") {
        assert.equal(store.tasks.get("task-timer").state, "submitted");
        assert.equal(browser.submitClicks, 1);
        assert.equal(store.lifecycle.getSubmissionReceipt("task-timer").verifiedStatus, "Submitted successfully");
        await execution.reconcileDeadlines();
        assert.equal(browser.submitClicks, 1, "a persisted receipt cannot trigger a second submission");
      } else {
        assert.equal(browser.submitClicks, 0);
        assert.equal(store.lifecycle.getExecution("task-timer").phase, "ready_review");
        if (mode === "doubts") await assert.rejects(execution.submitByRule("task-timer"), /doubt/i);
        if (mode === "heads-up") {
          await assert.rejects(execution.submitByRule("task-timer"), /heads-up/i);
          assert.deepEqual(store.lifecycle.getExecution("task-timer").doubts, [], "a heads-up is news, not a question");
          assert.deepEqual(store.lifecycle.getExecution("task-timer").notices, ["This computer has no graphing tool, so I drew the graph by hand."]);
        }
      }
    } finally { execution.dispose(); manager.dispose(); }
  });
});

test("a student can submit an attempt-only review with doubts exactly once", async () => {
  await withStore(async store => {
    seedTask(store, "student-submit", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("attempt", "attempt", initialNow));
    const browser = new FakeBrowser("Answer page", "Submitted successfully");
    const runtime = new ScriptedRuntime([
      tools => invoke(tools, "assignment_start_review", { answers: "x = 4", completedRequirements: [{ requirement: "Solve", evidence: "Answer filled" }], doubts: [{ where: "Question 1", why: "Double-check the units" }], summary: "Ready" }),
      async tools => { await browser.snapshot(); await invoke(tools, "browser_submit", { ref: browser.currentRef, confirmation: "SUBMIT", expectedConfirmationText: "Submitted successfully" }); },
    ]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => initialNow });
    const execution = await AssignmentExecutionCoordinator.create(store, manager, browser, { now: () => initialNow });
    try {
      const ready = await execution.start("task-student-submit");
      assert.equal(ready.phase, "ready_review");
      assert.equal(browser.submitClicks, 0);
      await assert.rejects(execution.submitByRule(ready.taskId), /you submit it yourself/);
      const submitted = await execution.submitReviewed(ready.taskId);
      assert.equal(submitted.phase, "submitted");
      assert.equal(browser.submitClicks, 1);
      assert.equal(store.lifecycle.getSubmissionReceipt(ready.taskId).verifiedStatus, "Submitted successfully");
      await assert.rejects(execution.submitReviewed(ready.taskId), /not ready for review/);
      assert.equal(browser.submitClicks, 1);
    } finally { execution.dispose(); manager.dispose(); }
  });
});

test("editing review cancels submission before abort finishes and rechecks the rule on fresh review", async () => {
  await withStore(async store => {
    let now = initialNow;
    seedTask(store, "edit-review", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("permission", "auto_submit", now));
    const review = tools => invoke(tools, "assignment_start_review", { answers: "x = 4", completedRequirements: [{ requirement: "Solve", evidence: "The answer is filled in" }], summary: "Ready" });
    const runtime = new ScriptedRuntime([review, review]);
    let finishAbort;
    const aborting = new Promise(resolve => { finishAbort = resolve; });
    const create = runtime.createAssignmentSession.bind(runtime);
    runtime.createAssignmentSession = async (...args) => ({ ...await create(...args), abort: () => aborting });
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => now });
    const browser = new FakeBrowser("Answer page", "Submitted successfully");
    const execution = await AssignmentExecutionCoordinator.create(store, manager, browser, { now: () => now, reviewWindowMs: 60_000, handoffWindowMs: 180_000 });
    try {
      const ready = await execution.start("task-edit-review");
      store.lifecycle.putExecution({ ...ready, reviewSubmissionRequestedAt: initialNow });
      const takingOver = execution.requestTakeover("task-edit-review");
      const editing = store.lifecycle.getExecution("task-edit-review");
      assert.equal(editing.phase, "needs_user");
      assert.equal(editing.reviewDeadline, undefined);
      assert.equal(editing.answerSnapshot, ready.answerSnapshot);
      assert.equal(editing.answerArtifactId, ready.answerArtifactId);
      assert.equal(manager.state().lease.taskId, ready.taskId);
      assert.equal(store.tasks.get(ready.taskId).state, "needs_user");
      now = "2026-09-01T12:01:01.000Z";
      await execution.reconcileDeadlines();
      assert.equal(browser.submitClicks, 0);
      await assert.rejects(execution.submitByRule(ready.taskId), /not ready for review/);
      finishAbort(); await takingOver;
      store.permissionRules.put(rule("permission", "attempt", now));
      const reviewed = await execution.resume(ready.taskId);
      assert.equal(reviewed.phase, "ready_review");
      assert.equal(reviewed.reviewSubmissionRequestedAt, undefined, "a cancelled request without an effect does not poison a new review");
      now = "2026-09-01T12:02:02.000Z";
      await execution.reconcileDeadlines();
      assert.equal(browser.submitClicks, 0, "the new attempt-only rule prevents timed submission");
      await assert.rejects(execution.submitByRule(ready.taskId), /you submit it yourself/);
    } finally { finishAbort(); execution.dispose(); manager.dispose(); }
  });
});

test("new executions stamp their authenticated owner and another owner cannot resume or submit them", async () => {
  await withStore(async store => {
    seedTask(store, "owner", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("auto", "auto_submit", initialNow));
    const browser = new FakeBrowser("Answer page", "Submitted successfully");
    const runtime = new ScriptedRuntime([tools => invoke(tools, "assignment_start_review", {
      answers: "x = 4", completedRequirements: [{ requirement: "Solve", evidence: "The answer is filled in" }], summary: "Ready",
    })]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => initialNow });
    const first = await AssignmentExecutionCoordinator.create(store, manager, browser, { now: () => initialNow, ownerSubject: "student-a" });
    let other;
    try {
      const ready = await first.start("task-owner");
      assert.equal(ready.ownerSubject, "student-a");
      store.lifecycle.putExecution({ ...ready, ownerSubject: "student-b" });
      assert.equal(store.lifecycle.getExecution("task-owner").ownerSubject, "student-a", "existing execution ownership cannot be rewritten by a stale save");
      first.dispose();
      const saved = store.lifecycle.getExecution("task-owner");
      const sessionCount = runtime.sessionNumber;
      other = await AssignmentExecutionCoordinator.create(store, manager, browser, { now: () => "2026-09-02T12:00:00.000Z", ownerSubject: "student-b" });
      assert.equal(runtime.sessionNumber, sessionCount, "foreign work is not restored into a worker session");
      await assert.rejects(other.resume("task-owner"), /another signed-in student/);
      await assert.rejects(other.continueTurn("task-owner", "Continue"), /another signed-in student/);
      await assert.rejects(other.submitByRule("task-owner"), /another signed-in student/);
      await assert.rejects(other.verifyStudentSubmission("task-owner", "Submitted successfully"), /another signed-in student/);
      await assert.rejects(other.start("task-owner"), /another signed-in student/);
      await other.reconcileDeadlines();
      assert.deepEqual(store.lifecycle.getExecution("task-owner"), saved, "another account cannot change the record even when review has expired");
      assert.equal(browser.submitClicks, 0);
      assert.equal(runtime.turn, 1);
    } finally { first.dispose(); other?.dispose(); manager.dispose(); }
  });
});

for (const recordedOwner of [undefined, "student-a"]) test(`restart preserves ${recordedOwner ?? "legacy unowned"} execution ownership`, async () => {
  await withStore(async store => {
    seedTask(store, "owner-restart", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("attempt", "attempt", initialNow));
    const review = tools => invoke(tools, "assignment_start_review", {
      answers: "x = 4", completedRequirements: [{ requirement: "Solve", evidence: "The answer is filled in" }], summary: "Ready",
    });
    const runtime = new ScriptedRuntime([review, review]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => initialNow });
    const browser = new FakeBrowser();
    const first = await AssignmentExecutionCoordinator.create(store, manager, browser, { now: () => initialNow, ...(recordedOwner ? { ownerSubject: recordedOwner } : {}) });
    let restored;
    try {
      assert.equal((await first.start("task-owner-restart")).ownerSubject, recordedOwner);
      first.dispose();
      restored = await AssignmentExecutionCoordinator.create(store, manager, browser, { now: () => initialNow, ownerSubject: "student-a" });
      assert.equal(store.lifecycle.getExecution("task-owner-restart").ownerSubject, recordedOwner);
      await restored.requestTakeover("task-owner-restart");
      assert.equal((await restored.resume("task-owner-restart")).ownerSubject, recordedOwner);
      assert.equal(runtime.turn, 2, "same-owner and legacy work may still resume");
    } finally { first.dispose(); restored?.dispose(); manager.dispose(); }
  });
});

test("work that was running when Studi quit carries on by itself after a restart", async () => {
  await withStore(async store => {
    seedTask(store, "carry-on", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("attempt", "attempt", initialNow));
    const ask = tools => invoke(tools, "assignment_tell_student", { message: "Which unit should I use?", needs: "answer" });
    const review = tools => invoke(tools, "assignment_start_review", {
      answers: "x = 4", completedRequirements: [{ requirement: "Solve", evidence: "The answer is filled in" }], summary: "Ready",
    });
    const runtime = new ScriptedRuntime([ask, review]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => initialNow });
    const first = await AssignmentExecutionCoordinator.create(store, manager, new FakeBrowser(), { now: () => initialNow });
    let restored;
    try {
      await first.start("task-carry-on");
      // Studi quits mid-work: the task and its execution are still saved as working.
      manager.resumePaused("task-carry-on", "test: back to work");
      store.lifecycle.putExecution({ ...store.lifecycle.getExecution("task-carry-on"), phase: "working", needs: undefined });
      first.dispose();
      restored = await AssignmentExecutionCoordinator.create(store, manager, new FakeBrowser("about:blank"), { now: () => initialNow });
      assert.match(store.lifecycle.getExecution("task-carry-on").lastError, /restarted/);
      await restored.carryOnAfterRestart();
      assert.equal(store.lifecycle.getExecution("task-carry-on").phase, "ready_review", "the same run finished without the student pressing anything");
    } finally { first.dispose(); restored?.dispose(); manager.dispose(); }
  });
});

test("while Dot waits on the student the page stays held and the queue waits, until the wait ends", async () => {
  await withStore(async store => {
    let now = initialNow;
    seedTask(store, "wait", "2026-09-02T12:00:00.000Z");
    seedTask(store, "after", "2026-09-03T12:00:00.000Z");
    store.permissionRules.put(rule("attempt", "attempt", now));
    const ask = tools => invoke(tools, "assignment_tell_student", { message: "Which unit should I use?", needs: "answer" });
    const manager = await ManagerCoordinator.create(store, new ScriptedRuntime([ask]), { now: () => now });
    const execution = await AssignmentExecutionCoordinator.create(store, manager, new FakeBrowser(), { now: () => now });
    try {
      assert.equal((await execution.start("task-wait")).phase, "needs_user");
      manager.queueNext("task-after");
      await assert.rejects(execution.startNext(), /task-wait already owns/);
      const waitUntil = store.lifecycle.getExecution("task-wait").handoffDeadline;
      assert.equal(waitUntil, "2026-09-02T11:00:00.000Z", "a question waits until an hour before it's due, at most a day");
      now = waitUntil;
      await execution.reconcileDeadlines();
      assert.equal(store.lifecycle.getExecution("task-wait").phase, "failed");
      assert.equal(manager.state().lease, null, "the page is let go when the wait ends, so nothing deadlocks");
      assert.deepEqual(manager.state().entries.map(entry => entry.taskId), ["task-after"]);
    } finally { execution.dispose(); manager.dispose(); }
  });
});

test("a restart after an earlier hand-off still carries on instead of expiring on the old deadline", async () => {
  await withStore(async store => {
    let now = initialNow;
    seedTask(store, "old-deadline", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("attempt", "attempt", now));
    const takeOver = tools => invoke(tools, "assignment_tell_student", { message: "Open the lab page for me.", needs: "browser" });
    const review = tools => invoke(tools, "assignment_start_review", { answers: "x = 4", completedRequirements: [{ requirement: "Solve", evidence: "The answer is filled in" }], summary: "Ready" });
    const runtime = new ScriptedRuntime([takeOver, review]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => now });
    const first = await AssignmentExecutionCoordinator.create(store, manager, new FakeBrowser(), { now: () => now, handoffWindowMs: 60_000 });
    let restored;
    try {
      assert.equal((await first.start("task-old-deadline")).phase, "needs_user");
      // The student lets Dot carry on; Dot is mid-work when Studi quits, long after the first hand-off's deadline.
      manager.resumePaused("task-old-deadline", "test: back to work");
      store.lifecycle.putExecution({ ...store.lifecycle.getExecution("task-old-deadline"), phase: "working", needs: undefined });
      first.dispose();
      now = "2026-09-01T12:30:00.000Z";
      restored = await AssignmentExecutionCoordinator.create(store, manager, new FakeBrowser("about:blank"), { now: () => now, handoffWindowMs: 60_000 });
      const held = store.lifecycle.getExecution("task-old-deadline");
      assert.equal(held.phase, "needs_user");
      assert.equal(held.handoffDeadline, "2026-09-01T12:31:00.000Z", "the restart hand-off waits the usual window from now");
      await restored.carryOnAfterRestart();
      assert.equal(store.lifecycle.getExecution("task-old-deadline").phase, "ready_review");
    } finally { first.dispose(); restored?.dispose(); manager.dispose(); }
  });
});

test("Dot notices the student signed in and carries on, with one notification for the sign-out", async () => {
  await withStore(async store => {
    seedTask(store, "sign-in", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("attempt", "attempt", initialNow));
    const browser = new FakeBrowser();
    let signedOut = true;
    const snapshot = browser.snapshot.bind(browser);
    browser.snapshot = async () => {
      const page = await snapshot();
      return signedOut ? { ...page, elements: [...page.elements, { ref: "password", role: "textbox", name: "Password" }] } : page;
    };
    const ask = tools => invoke(tools, "assignment_tell_student", { message: "Sign in to the school, please.", needs: "sign_in" });
    const review = tools => invoke(tools, "assignment_start_review", {
      answers: "x = 4", completedRequirements: [{ requirement: "Solve", evidence: "The answer is filled in" }], summary: "Ready",
    });
    const runtime = new ScriptedRuntime([ask, review]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => initialNow });
    const notices = [];
    const execution = await AssignmentExecutionCoordinator.create(store, manager, browser, { now: () => initialNow, signInCheckMs: 5, notify: notice => notices.push(notice) });
    try {
      await execution.start("task-sign-in");
      assert.equal(store.lifecycle.getExecution("task-sign-in").needs, "sign_in");
      await new Promise(done => setTimeout(done, 30));
      assert.equal(store.lifecycle.getExecution("task-sign-in").phase, "needs_user", "still signed out, still waiting");
      signedOut = false;
      for (let tries = 0; tries < 50 && store.lifecycle.getExecution("task-sign-in").phase !== "ready_review"; tries += 1) await new Promise(done => setTimeout(done, 10));
      assert.equal(store.lifecycle.getExecution("task-sign-in").phase, "ready_review", "Dot carried on without the student pressing anything");
      assert.equal(notices.filter(notice => notice.kind === "handoff").length, 1);
    } finally { execution.dispose(); manager.dispose(); }
  });
});

test("homework sees the student's preferences and how the school works, and every run leaves a note", async () => {
  await withStore(async store => {
    seedTask(store, "memory", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("attempt", "attempt", initialNow));
    store.school.putProfile({ schemaVersion: 1, profileId: "primary-school", studentName: "Avery", schoolRoot: "https://school.example.edu/", defaultPermission: "attempt", scanCadence: "manual", onboardingState: "ready", missedCourseFeedback: [], scanDepth: "normal", updatedAt: initialNow });
    await store.notes.upsert({ scope: "student", subjectId: "student-a", about: "preference", key: "voice", title: "Write in first person", content: "Always write essays in first person." });
    await store.notes.upsert({ scope: "school", subjectId: "primary-school", about: "scan", key: "how-this-school-works", title: "How this school works", content: "WebAssign opens from each course page." });
    const runtime = new ScriptedRuntime([tools => invoke(tools, "assignment_start_review", {
      answers: "x = 4", completedRequirements: [{ requirement: "Solve", evidence: "The answer is filled in" }], summary: "Ready",
    })]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => initialNow });
    const execution = await AssignmentExecutionCoordinator.create(store, manager, new FakeBrowser(), { now: () => initialNow, ownerSubject: "student-a" });
    try {
      await execution.start("task-memory");
      const prompt = runtime.prompts.find(text => text?.includes("# Relevant notes"));
      assert.match(prompt, /Write in first person/);
      assert.match(prompt, /How this school works/);
      await new Promise(resolve => setTimeout(resolve, 50));
      const runNote = store.notes.list().find(note => note.scope === "assignment" && note.key === "run-log");
      assert.ok(runNote, "the run left a note");
      assert.match((await store.notes.read(runNote.noteId)).content, /ready for the student to check/);
    } finally { execution.dispose(); manager.dispose(); }
  });
});

test("auto-submit rejects confirmation text that was already visible before the effect", async () => {
  await withStore(async (store) => {
    seedTask(store, "preexisting-confirmation", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("auto", "auto_submit", initialNow));
    const browser = new FakeBrowser("Answer page Submit assignment", "Answer page Submit assignment");
    const runtime = new ScriptedRuntime([
      async (tools) => invoke(tools, "assignment_start_review", { answers: "x = 4", completedRequirements: [{ requirement: "Solve the problem", evidence: "The answer field contains x = 4" }], summary: "Answer ready" }),
      async (tools) => { await browser.snapshot(); return invoke(tools, "browser_submit", {
        ref: browser.currentRef,
        confirmation: "SUBMIT",
        expectedConfirmationText: "Submit assignment",
      }); },
    ]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => initialNow });
    manager.enqueue({ taskId: "task-preexisting-confirmation" });
    const execution = await AssignmentExecutionCoordinator.create(store, manager, browser, { now: () => initialNow });
    const ready = await execution.startNext();
    assert.equal(ready.phase, "ready_review");
    const needsUser = await execution.submitByRule(ready.taskId);
    assert.equal(needsUser.phase, "needs_user");
    assert.match(needsUser.lastError, /Choose an affirmative submission status/);
    assert.equal(needsUser.submissionAttemptedAt, undefined, "no destructive attempt is recorded when pre-effect evidence is invalid");
    assert.equal(browser.submitClicks, 0, "pre-existing confirmation text cannot trigger a click");
    assert.equal(store.lifecycle.getSubmissionReceipt("task-preexisting-confirmation"), null);
    assert.equal(manager.state().lease.taskId, "task-preexisting-confirmation", "ambiguity keeps the page with the student");
    execution.dispose();
    manager.dispose();
  });
});

test("an active school scan blocks assignment acquisition before the browser is touched", async () => {
  await withStore(async (store) => {
    seedTask(store, "scan-collision", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("attempt", "attempt", initialNow));
    store.school.putScan({
      schemaVersion: 1,
      scanId: "scan-active",
      kind: "replay",
      state: "running",
      startedAt: initialNow,
      updatedAt: initialNow,
      currentStep: "Reading the visible course list",
      coverage: [],
      failures: [],
      handoff: null,
      observedCourseIds: [],
      observedAssignmentIds: [],
      observedLinkedSystemIds: [],
    });
    const browser = new FakeBrowser();
    const manager = await ManagerCoordinator.create(store, new ScriptedRuntime([]), { now: () => initialNow });
    manager.enqueue({ taskId: "task-scan-collision" });
    const execution = await AssignmentExecutionCoordinator.create(store, manager, browser, { now: () => initialNow });
    await assert.rejects(execution.startNext(), /School scan scan-active must finish/);
    assert.equal(manager.state().lease, null, "the assignment never acquires the durable browser lease");
    assert.equal(browser.revision, 0, "the assignment never snapshots or changes the scan page");
    execution.dispose();
    manager.dispose();
  });
});

test("a permission change before submit blocks the effect and hands the retained page to the student", async () => {
  await withStore(async (store) => {
    seedTask(store, "permission", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("auto", "auto_submit", initialNow));
    const browser = new FakeBrowser("Answer page", "Submitted successfully");
    const runtime = new ScriptedRuntime([
      async (tools) => {
        store.permissionRules.put({ schemaVersion: 1, ruleId: "assignment-attempt", scope: "assignment", assignmentId: "assignment-permission", mode: "attempt", updatedAt: "2026-09-01T12:01:00.000Z" });
        await assert.rejects(invoke(tools, "browser_submit", { ref: "submit-1", confirmation: "SUBMIT", expectedConfirmationText: "Submitted successfully" }), /does not allow submission/);
        await invoke(tools, "assignment_tell_student", { message: "Submission permission changed; you decide whether to hand this in.", needs: "answer" });
      },
    ]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => initialNow });
    manager.enqueue({ taskId: "task-permission" });
    const execution = await AssignmentExecutionCoordinator.create(store, manager, browser, { now: () => initialNow });
    const paused = await execution.startNext();
    assert.equal(paused.phase, "needs_user");
    assert.equal(browser.submitClicks, 0);
    assert.equal(store.lifecycle.getSubmissionReceipt("task-permission"), null);
    assert.equal(manager.state().lease.taskId, "task-permission");
    execution.dispose();
    manager.dispose();
  });
});

test("an assignment message resumes a needs-user handoff with the message as work context", async () => {
  await withStore(async (store) => {
    seedTask(store, "message-resume", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("attempt", "attempt", initialNow));
    const runtime = new ScriptedRuntime([
      async (tools) => invoke(tools, "assignment_tell_student", { message: "Attach the required graph before I continue.", needs: "files" }),
      async (tools) => invoke(tools, "assignment_tell_student", { message: "The graph is still missing after checking your reply.", needs: "files" }),
    ]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => initialNow });
    manager.enqueue({ taskId: "task-message-resume" });
    const execution = await AssignmentExecutionCoordinator.create(store, manager, new FakeBrowser(), { now: () => initialNow });

    assert.equal((await execution.startNext()).phase, "needs_user");
    await execution.continueTurn("task-message-resume", "I attached it; fill out the rest.");

    const resumed = store.lifecycle.getExecution("task-message-resume");
    assert.equal(resumed.phase, "needs_user", "the worker may truthfully hand back again after inspecting the reply");
    assert.equal(resumed.turnCount, 2);
    const transitions = store.tasks.listEvents("task-message-resume").filter((event) => event.type === "task_state_changed");
    assert.deepEqual(transitions.slice(-2).map((event) => event.payload.to), ["working", "needs_user"]);
    execution.dispose();
    manager.dispose();
  });
});

test("two distinct failed recovery plans stop in a truthful handoff", async () => {
  await withStore(async (store) => {
    seedTask(store, "recovery", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("attempt", "attempt", initialNow));
    const browser = new FakeBrowser();
    const runtime = new ScriptedRuntime([
      async (tools) => {
        await invoke(tools, "assignment_record_recovery", { plan: "Refresh the current assignment route", result: "The same loading error remained." });
        await invoke(tools, "assignment_record_recovery", { plan: "Return through the course assignment list", result: "The assignment route still failed." });
      },
    ]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => initialNow });
    manager.enqueue({ taskId: "task-recovery" });
    const execution = await AssignmentExecutionCoordinator.create(store, manager, browser, { now: () => initialNow });
    const paused = await execution.startNext();
    assert.equal(paused.phase, "needs_user");
    assert.equal(paused.attemptCount, 2);
    assert.match(paused.lastError, /Two different browser recovery plans failed/);
    assert.deepEqual(store.lifecycle.listAttempts("task-recovery").map((attempt) => attempt.ordinal), [1, 2]);
    assert.equal(store.tasks.get("task-recovery").state, "needs_user");
    execution.dispose();
    manager.dispose();
  });
});

test("restart during submission pauses without repeating the destructive effect", async () => {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-wp09-restart-")));
  try {
    let store = await openLocalStore(root);
    await configureHomework(store, root);
    seedTask(store, "restart", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("auto", "auto_submit", initialNow));
    let runtime = new ScriptedRuntime([]);
    let manager = await ManagerCoordinator.create(store, runtime, { now: () => initialNow });
    manager.enqueue({ taskId: "task-restart" });
    const lease = await manager.startNext([]);
    manager.beginSubmission("task-restart");
    store.lifecycle.putExecution({
      schemaVersion: 1,
      taskId: "task-restart",
      assignmentId: "assignment-restart",
      phase: "submitting",
      taskBudget: { maxAgentTurns: 24, maxRecoveryAttempts: 2 },
      turnCount: 0,
      attemptCount: 0,
      submissionAttemptedAt: initialNow,
      workerSessionPath: lease.workerSessionPath,
      updatedAt: initialNow,
    });
    manager.dispose();
    store.close();

    store = await openLocalStore(root);
    runtime = new ScriptedRuntime([]);
    manager = await ManagerCoordinator.create(store, runtime, { now: () => initialNow });
    const browser = new FakeBrowser();
    const execution = await AssignmentExecutionCoordinator.create(store, manager, browser, { now: () => initialNow });
    assert.equal(store.lifecycle.getExecution("task-restart").phase, "needs_user");
    assert.equal(store.tasks.get("task-restart").state, "needs_user");
    assert.equal(manager.state().lease.taskId, "task-restart", "the retained page still has one owner");
    assert.equal(browser.submitClicks, 0, "startup never repeats an unverified submission");
    execution.dispose();
    manager.dispose();
    store.close();
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("restart keeps detached review answers ready without claiming browser ownership", async () => {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-wp09-review-restart-")));
  try {
    let store = await openLocalStore(root);
    await configureHomework(store, root);
    seedTask(store, "review-restart", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("attempt", "attempt", initialNow));
    let runtime = new ScriptedRuntime([
      async (tools) => invoke(tools, "assignment_start_review", {
        answers: "Restart-safe answer: 42",
        completedRequirements: [
          { requirement: "Written response", evidence: "The visible answer field contains 42." },
        ],
        summary: "The visible answer was complete before restart.",
      }),
    ]);
    let manager = await ManagerCoordinator.create(store, runtime, { now: () => initialNow });
    manager.enqueue({ taskId: "task-review-restart" });
    let execution = await AssignmentExecutionCoordinator.create(store, manager, new FakeBrowser(), { now: () => initialNow });
    assert.equal((await execution.startNext()).phase, "ready_review");
    execution.dispose();
    manager.dispose();
    store.close();

    store = await openLocalStore(root);
    runtime = new ScriptedRuntime([]);
    manager = await ManagerCoordinator.create(store, runtime, { now: () => initialNow });
    execution = await AssignmentExecutionCoordinator.create(store, manager, new FakeBrowser("about:blank"), { now: () => initialNow });
    const recovered = store.lifecycle.getExecution("task-review-restart");
    assert.equal(recovered.phase, "ready_review");
    assert.ok(recovered.answerArtifactId);
    assert.equal(manager.state().lease, null, "saved review remains detached after restart");
    assert.match((await store.artifacts.read("answer", recovered.answerArtifactId)).content, /Restart-safe answer: 42/);
    assert.equal(recovered.handoffDeadline, undefined);
    await execution.reconcileDeadlines();
    assert.equal(store.lifecycle.getExecution("task-review-restart").phase, "ready_review");
    execution.dispose();
    manager.dispose();
    store.close();
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("changing the rule to leave it stops running work at once, and resuming waits until the rule allows it", async () => {
  await withStore(async store => {
    seedTask(store, "rule-change", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("attempt", "attempt", initialNow));
    let stop;
    const listeners = new Set();
    const runtime = {
      async createWorkerSession() { return runtime.session("worker"); },
      async createAssignmentSession() { return runtime.session("assignment"); },
      session: kind => ({
        sessionId: `${kind}-1`, sessionPath: `${kind}-1.jsonl`, toolNames: [],
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        prompt: async () => {
          if (kind === "assignment") await new Promise(resolve => { stop = resolve; });
          for (const listener of listeners) listener({ schemaVersion: 1, type: "terminal", outcome: kind === "assignment" ? "aborted" : "completed" });
        },
        abort: async () => stop?.(), compact: async () => {}, replace: async () => {}, dispose() {},
      }),
    };
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => initialNow });
    manager.enqueue({ taskId: "task-rule-change", requestOrigin: "automatic" });
    const execution = await AssignmentExecutionCoordinator.create(store, manager, new FakeBrowser(), { now: () => initialNow });
    const running = execution.startNext();
    while (!manager.isWorkerRunning) await new Promise(resolve => setTimeout(resolve, 5));
    store.permissionRules.put(rule("leave", "do_not_attempt", "2026-09-01T12:01:00.000Z"));
    await manager.stopWorkNoLongerAllowed();
    await running;
    const stopped = store.lifecycle.getExecution("task-rule-change");
    assert.equal(stopped.phase, "needs_user");
    assert.match(stopped.lastError, /Your rule changed/);
    await assert.rejects(execution.continueTurn("task-rule-change", "carry on"), /Your rule changed/);
    execution.dispose();
    manager.dispose();
  });
});

test("a student Start under leave-it can work and hand in while an automatic Start is refused", async () => {
  await withStore(async store => {
    seedTask(store, "manual-leave", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("leave", "do_not_attempt", initialNow));
    const browser = new FakeBrowser("Answer page", "Submitted successfully");
    const runtime = new ScriptedRuntime([
      tools => invoke(tools, "assignment_start_review", { answers: "42", completedRequirements: [{ requirement: "Answer", evidence: "42 in field" }], summary: "Ready" }),
      async tools => { await browser.snapshot(); await invoke(tools, "browser_submit", { ref: browser.currentRef, confirmation: "SUBMIT", expectedConfirmationText: "Submitted successfully" }); },
    ]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => initialNow });
    const execution = await AssignmentExecutionCoordinator.create(store, manager, browser, { now: () => initialNow });
    try {
      assert.throws(() => manager.enqueue({ taskId: "task-manual-leave", requestOrigin: "automatic" }), /only when you ask/);
      assert.equal((await execution.start("task-manual-leave")).phase, "ready_review");
      assert.equal(manager.state().lease, null);
      await assert.rejects(execution.submitByRule("task-manual-leave"), /rule/);
      assert.equal((await execution.submitReviewed("task-manual-leave")).phase, "submitted");
      assert.equal(browser.submitClicks, 1);
    } finally { execution.dispose(); manager.dispose(); }
  });
});

class FakeBrowser {
  revision = 0;
  refRefreshes = 0;
  submitClicks = 0;
  currentRef = null;
  text;
  postSubmitText;

  constructor(text = "Assignment answer page", postSubmitText = "Assignment answer page") {
    this.text = text;
    this.postSubmitText = postSubmitText;
  }

  async snapshot() {
    this.revision += 1;
    this.currentRef = `submit-${this.revision}`;
    return { revision: this.revision, url: "https://school.example.edu/assignment", title: "Assignment", text: this.text, elements: [{ ref: this.currentRef, role: "button", name: "Submit assignment" }], truncated: false };
  }

  async refreshRef(ref) {
    if (ref !== this.currentRef) throw new Error("Stale or unknown browser ref. Take a new snapshot before acting.");
    this.refRefreshes += 1;
    const snapshot = await this.snapshot();
    return { snapshot, ref: this.currentRef };
  }

  async click(ref, allowSubmission) {
    assert.equal(allowSubmission, true);
    assert.equal(ref, this.currentRef, "only the control re-identified in the fresh snapshot may be clicked");
    this.submitClicks += 1;
    this.text = this.postSubmitText;
    return this.snapshot();
  }
}

class ScriptedRuntime {
  scripts;
  turn = 0;
  sessionNumber = 0;

  constructor(scripts) { this.scripts = scripts; }

  async createWorkerSession(target = {}) { return this.session("worker", [], target); }
  async createAssignmentSession(tools, target = {}) { return this.session("assignment", tools, target); }

  session(kind, tools, target) {
    this.sessionNumber += 1;
    this.lastTarget = target;
    const listeners = new Set();
    return {
      sessionId: `${kind}-${this.sessionNumber}`,
      sessionPath: target.resumeSessionPath ?? `${kind}-${this.sessionNumber}.jsonl`,
      toolNames: tools.map((tool) => tool.name),
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      prompt: async (text) => {
        (this.prompts ??= []).push(text);
        if (kind === "assignment") {
          const script = this.scripts[this.turn++];
          if (!script) throw new Error("No assignment script remains");
          await script(tools, event => { for (const listener of listeners) listener(event); });
        }
        for (const listener of listeners) listener({ schemaVersion: 1, type: "terminal", outcome: "completed" });
      },
      compact: async () => {}, abort: async () => {}, replace: async () => {}, dispose() {},
    };
  }
}

async function invoke(tools, name, input) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `missing assignment tool ${name}`);
  const result = await tool.execute(`call-${name}`, input, undefined, undefined, {});
  return result.details;
}

function seedTask(store, suffix, dueAt) {
  const assignmentId = `assignment-${suffix}`;
  const taskId = `task-${suffix}`;
  const evidence = { schemaVersion: 1, evidenceId: `evidence-${suffix}`, reference: `evidence-${suffix}`, kind: "text_snapshot", sourceTarget: `https://school.example.edu/assignments/${suffix}`, capturedAt: initialNow };
  store.assignments.put({
    schemaVersion: 1,
    assignmentId,
    courseId: `course-${suffix}`,
    title: `Assignment ${suffix}`,
    sourceTarget: `https://school.example.edu/assignments/${suffix}`,
    dueAt,
    deadlinePrecision: "datetime", deadlineEvidence: evidence,
    schoolStatus: { state: "not_submitted", text: "Not submitted", evidence },
    requirementEvidence: [{ text: "Complete the exercise.", evidence }], requirementsState: "complete",
    discoveredAt: initialNow,
    evidence: [],
  });
  const task = { schemaVersion: 1, taskId, assignmentId, state: "discovered", revision: 0, createdAt: initialNow, updatedAt: initialNow };
  store.tasks.append({
    expectedRevision: null,
    projection: task,
    event: {
      schemaVersion: 1,
      eventId: `event-${suffix}`,
      aggregateType: "task",
      aggregateId: taskId,
      runId: `run-${suffix}`,
      sequence: 0,
      occurredAt: initialNow,
      type: "task_created",
      payload: { taskId, assignmentId, state: "discovered", revision: 0, createdAt: initialNow, updatedAt: initialNow },
    },
  });
}

function rule(ruleId, mode, updatedAt) {
  return { schemaVersion: 1, ruleId, scope: "global", mode, updatedAt };
}

async function withStore(run) {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-wp09-execution-")));
  const store = await openLocalStore(root);
  try {
    await configureHomework(store, root);
    await run(store, root);
  }
  finally {
    try { store.close(); } catch {}
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function configureHomework(store, root) {
  const homeworkRoot = join(root, "homework");
  await mkdir(homeworkRoot, { recursive: true });
  await initializeHomeworkWorkspace(homeworkRoot);
  const current = await store.productPreferences.get();
  await store.productPreferences.put({ ...current, homeworkRoot, updatedAt: initialNow });
}
