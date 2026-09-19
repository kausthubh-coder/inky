import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { AssignmentExecutionCoordinator } from "../../dist/electron/assignment/coordinator.js";
import { VisibleBrowserWork } from "../../dist/electron/browser/work-ownership.js";
import { nextScheduleRun, plannedAssignmentStart } from "../../dist/electron/lifecycle/schedule.js";
import { ManagerCoordinator } from "../../dist/electron/manager/coordinator.js";
import { SchoolScanCoordinator } from "../../dist/electron/scan/coordinator.js";
import { openLocalStore } from "../../dist/electron/storage/index.js";
import { initializeHomeworkWorkspace } from "../../dist/electron/files/workspace.js";

const initialNow = "2026-09-01T12:00:00.000Z";

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

test("attempt-only work retains its browser lease through review and saves Markdown before continuing the queue", async () => {
  await withStore(async (store) => {
    let now = initialNow;
    seedTask(store, "review", "2026-09-02T12:00:00.000Z");
    seedTask(store, "next", "2026-09-03T12:00:00.000Z");
    store.permissionRules.put(rule("attempt", "attempt", now));
    const browser = new FakeBrowser();
    const runtime = new ScriptedRuntime([
      async (tools) => invoke(tools, "assignment_start_review", {
        answers: "1. x = 4\n2. y = 9",
        completedRequirements: [
          { requirement: "Question 1", evidence: "The first answer field contains x = 4." },
          { requirement: "Question 2", evidence: "The second answer field contains y = 9." },
        ],
        summary: "Both answer fields are visibly complete.",
      }),
    ]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => now });
    const browserWork = new VisibleBrowserWork(store);
    manager.enqueue({ taskId: "task-review" });
    manager.enqueue({ taskId: "task-next" });
    const notices = [];
    const execution = await AssignmentExecutionCoordinator.create(store, manager, browser, {
      now: () => now,
      reviewWindowMs: 60_000,
      handoffWindowMs: 3 * 60_000,
      notify: (intent) => notices.push(intent),
      browserWork,
    });

    const ready = await execution.startNext();
    assert.equal(ready.phase, "ready_review");
    assert.ok(ready.answerArtifactId, "review creates a durable answer immediately");
    assert.match((await store.artifacts.read("answer", ready.answerArtifactId)).content, /x = 4/);
    assert.match(await readFile(join(runtime.lastTarget.cwd, "studi-answer.md"), "utf8"), /x = 4/);
    const workerTools = new Set(manager.workerToolNames());
    for (const toolName of ["read", "write", "edit", "grep", "find", "ls", "browser_upload", "browser_download", "file_read_pdf", process.platform === "win32" ? "powershell" : "bash"]) {
      assert.ok(workerTools.has(toolName), `assignment worker is missing ${toolName}`);
    }
    assert.match(runtime.lastTarget.cwd, /Assignment review \[[a-f0-9]{6}\]$/, "the Pi session runs from its assignment workspace");
    assert.equal(ready.completionChecklist.length, 2);
    assert.equal(store.tasks.get("task-review").state, "ready_review");
    assert.equal(manager.state().lease.taskId, "task-review", "the completed page remains leased during review");
    assert.equal(ready.reviewDeadline, "2026-09-01T12:01:00.000Z");
    assert.equal(ready.handoffDeadline, "2026-09-01T12:03:00.000Z");
    assert.equal(browser.submitClicks, 0, "attempt-only never invokes a submission effect");
    assert.equal(notices.at(-1).kind, "review_ready");

    const scan = new SchoolScanCoordinator(store, {}, browser, { now: () => now, browserWork });
    let scheduledClaims = 0;
    for (const startScan of [
      () => scan.startScan(),
      () => scan.resume(),
      () => scan.replay(),
      () => scan.runScheduledScan(() => { scheduledClaims += 1; return { occurrence: "due" }; }, async () => undefined),
    ]) {
      await assert.rejects(startScan(), /Assignment task-review must finish/);
    }
    assert.equal(scheduledClaims, 0, "a blocked scheduled scan cannot advance its durable occurrence");
    scan.dispose();

    now = "2026-09-01T12:02:00.000Z";
    await execution.reconcileDeadlines();
    assert.equal(store.lifecycle.getExecution("task-review").phase, "ready_review", "the review reminder does not release the browser before the handoff deadline");
    assert.equal(manager.state().lease.taskId, "task-review");

    now = "2026-09-01T12:04:00.000Z";
    await execution.reconcileDeadlines();
    const preserved = store.lifecycle.getExecution("task-review");
    assert.equal(preserved.phase, "preserved");
    assert.ok(preserved.answerArtifactId);
    const artifact = await store.artifacts.read("answer", preserved.answerArtifactId);
    assert.match(artifact.content, /# Assignment review[\s\S]*x = 4[\s\S]*y = 9/);
    assert.equal(store.tasks.get("task-review").state, "preserved");
    assert.equal(manager.state().lease, null, "the lease releases only after the artifact is linked");
    assert.equal(manager.state().entries[0].taskId, "task-next", "the durable queue can continue");
    execution.dispose();
    manager.dispose();
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

test("auto-submit rechecks assignment permission and requires visible post-submit confirmation", async () => {
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
    const submitted = await execution.startNext();
    assert.equal(submitted.phase, "submitted");
    assert.equal(browser.refRefreshes, 1, "the coordinator re-identifies the submit control in its own fresh pre-submit snapshot");
    assert.equal(browser.submitClicks, 1);
    assert.equal(store.tasks.get("task-submit").state, "submitted");
    assert.equal(manager.state().lease, null);
    const receipt = store.lifecycle.getSubmissionReceipt("task-submit");
    assert.equal(receipt.verifiedStatus, "Submitted successfully");
    assert.notEqual(receipt.preSubmit.revision, receipt.postSubmit.revision);
    execution.dispose();
    manager.dispose();
  });
});

for (const mode of ["ready", "doubts", "paused"]) test(`timed review submission respects ${mode} state and retains readable actions`, async () => {
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
      }
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
      assert.equal((await restored.resume("task-owner-restart")).ownerSubject, recordedOwner);
      assert.equal(runtime.turn, 2, "same-owner and legacy work may still resume");
    } finally { first.dispose(); restored?.dispose(); manager.dispose(); }
  });
});

test("auto-submit rejects confirmation text that was already visible before the effect", async () => {
  await withStore(async (store) => {
    seedTask(store, "preexisting-confirmation", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("auto", "auto_submit", initialNow));
    const browser = new FakeBrowser("Answer page Submit assignment", "Answer page Submit assignment");
    const runtime = new ScriptedRuntime([
      async (tools) => invoke(tools, "browser_submit", {
        ref: "submit-1",
        confirmation: "SUBMIT",
        expectedConfirmationText: "Submit assignment",
      }),
    ]);
    const manager = await ManagerCoordinator.create(store, runtime, { now: () => initialNow });
    manager.enqueue({ taskId: "task-preexisting-confirmation" });
    const execution = await AssignmentExecutionCoordinator.create(store, manager, browser, { now: () => initialNow });
    const needsUser = await execution.startNext();
    assert.equal(needsUser.phase, "needs_user");
    assert.match(needsUser.lastError, /already visible before/);
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
        await invoke(tools, "assignment_request_takeover", { reason: "Submission permission changed; the student must decide.", returnPredicate: "The student has reviewed the current permission." });
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
      async (tools) => invoke(tools, "assignment_request_takeover", {
        reason: "Attach the required graph before I continue.",
        returnPredicate: "The graph is attached, or the student supplies different instructions.",
      }),
      async (tools) => invoke(tools, "assignment_request_takeover", {
        reason: "The graph is still missing after checking the student's reply.",
        returnPredicate: "The graph is visibly attached.",
      }),
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

test("restart during review preserves answers and hands off without claiming the page survived", async () => {
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
    assert.equal(recovered.phase, "needs_user");
    assert.ok(recovered.answerArtifactId);
    assert.match(recovered.lastError, /page could not be retained/);
    assert.doesNotMatch(recovered.lastError, /page is retained|retained page/);
    assert.equal(manager.state().lease.taskId, "task-review-restart", "the student handoff keeps ownership of the task");
    const artifact = await store.artifacts.read("answer", recovered.answerArtifactId);
    assert.match(artifact.content, /Restart-safe answer: 42/);
    execution.dispose();
    manager.dispose();
    store.close();
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
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
      prompt: async () => {
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
