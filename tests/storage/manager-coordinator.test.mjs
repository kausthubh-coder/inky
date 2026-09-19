import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { ManagerCoordinator } from "../../dist/electron/manager/coordinator.js";
import { HomeworkCoordinator } from "../../dist/electron/assignment/homework.js";
import { openLocalStore } from "../../dist/electron/storage/index.js";

const due = "2026-09-03T12:00:00.000Z";
const now = "2026-09-01T12:00:00.000Z";

test("manager queue refreshes permission, leases one worker, and recovers its order and sessions", async () => {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-wp06-manager-")));
  try {
    let store = await openLocalStore(root);
    seedTask(store, "a", due);
    seedTask(store, "b", due);
    seedTask(store, "pattern", "2026-09-02T12:00:00.000Z");
    store.permissionRules.put(rule("global-attempt", "global", "attempt", now));
    store.permissionRules.put({
      ...rule("pattern-attempt", "pattern", "attempt", "2026-09-01T12:01:00.000Z"),
      courseId: "course-pattern",
      patternId: "confirmed-pattern",
    });

    const runtime = new RecordingRuntime();
    const delegatedStarts = [];
    let coordinator = await ManagerCoordinator.create(store, runtime, {
      now: () => now,
      startAssignment: async (taskId) => {
        delegatedStarts.push(taskId);
        return { taskId, phase: "working" };
      },
    });
    coordinator.enqueue({ taskId: "task-a" });
    coordinator.enqueue({ taskId: "task-b" });
    assert.deepEqual(coordinator.state().entries.map((entry) => entry.taskId), ["task-a", "task-b"]);
    coordinator.steerNext("task-b");
    assert.equal(coordinator.state().entries[0].taskId, "task-b");
    const steeredPriority = coordinator.state().entries[0].priority;
    coordinator.enqueue({ taskId: "task-b" });
    assert.equal(
      coordinator.state().entries.find((entry) => entry.taskId === "task-b").priority,
      steeredPriority,
      "re-enqueue without an explicit priority keeps manual steering",
    );
    await coordinator.startFromConversation("task-b");
    assert.deepEqual(delegatedStarts, ["task-b"], "the manager delegates a verified queued task to the configured execution owner");

    store.permissionRules.put({
      ...rule("deny-b", "assignment", "do_not_attempt", "2026-09-01T12:02:00.000Z"),
      assignmentId: "assignment-b",
    });
    const lease = await coordinator.startNext();
    assert.equal(store.tasks.get("task-b").state, "discovered", "revoked unstarted work returns to discovery");
    assert.equal(lease.taskId, "task-a");
    assert.equal(coordinator.state().lease.taskId, "task-a");
    const claimedJob = store.agentJobs.getByTarget({ kind: "assignment", assignmentId: "assignment-a" });
    assert.equal(claimedJob.job.phase, "working");
    assert.equal(claimedJob.job.claim.jobId, claimedJob.job.jobId);
    assert.equal(claimedJob.sessionPath, lease.workerSessionPath);
    assert.equal(coordinator.activeTaskForAssignment("assignment-a"), "task-a");
    assert.equal(coordinator.activeTaskForAssignment("assignment-b"), null);
    coordinator.pause("task-a", "needs_user", "Student action required");
    assert.equal(store.agentJobs.get(claimedJob.job.jobId).job.phase, "needs_user");
    coordinator.resumePaused("task-a", "Student returned");
    assert.equal(store.agentJobs.get(claimedJob.job.jobId).job.phase, "working");
    await assert.rejects(coordinator.startNext(), /already has an active worker lease/);

    store.permissionRules.put(rule("global-deny", "global", "do_not_attempt", "2026-09-01T12:03:00.000Z"));
    assert.throws(
      () => coordinator.enqueue({ taskId: "task-pattern" }),
      /blocked by stored permission rules/,
    );
    store.manager.confirmPatternMatch({
      schemaVersion: 1,
      assignmentId: "assignment-pattern",
      courseId: "course-pattern",
      patternId: "confirmed-pattern",
      confirmedAt: "2026-09-01T12:04:00.000Z",
    });
    coordinator.enqueue({ taskId: "task-pattern" });
    assert.equal(
      coordinator.state().entries.find((entry) => entry.taskId === "task-pattern").permission.matchedRuleId,
      "pattern-attempt",
    );

    const beforeTurn = coordinator.state();
    assert.deepEqual(coordinator.state(), beforeTurn, "assignment worker state remains repository-backed");

    const persistedState = coordinator.state();
    coordinator.dispose();
    store.close();

    store = await openLocalStore(root);
    const reopenedRuntime = new RecordingRuntime();
    coordinator = await ManagerCoordinator.create(store, reopenedRuntime, { now: () => now });
    assert.deepEqual(coordinator.state(), persistedState);
    assert.deepEqual(reopenedRuntime.workerResumePaths, [lease.workerSessionPath]);
    await assert.rejects(coordinator.startNext(), /already has an active worker lease/);

    coordinator.finish("task-a", "ready_review");
    assert.equal(coordinator.state().lease, null);
    assert.equal(store.tasks.get("task-a").state, "ready_review");
    assert.equal(store.agentJobs.getByTarget({ kind: "assignment", assignmentId: "assignment-a" }).job.claim, null);
    assert.equal(store.agentJobs.getByTarget({ kind: "assignment", assignmentId: "assignment-a" }).job.phase, "review");
    assert.equal(coordinator.state().entries[0].taskId, "task-pattern");
    coordinator.dispose();
    store.close();
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("an interrupted acquiring lease returns to the same durable next task on reopen", async () => {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-wp06-recover-")));
  try {
    let store = await openLocalStore(root);
    seedTask(store, "recover", due);
    store.permissionRules.put(rule("allow", "global", "attempt", now));
    const first = await ManagerCoordinator.create(store, new RecordingRuntime(), { now: () => now });
    first.enqueue({ taskId: "task-recover" });
    first.dispose();
    store.manager.acquireLease("task-recover", now);
    store.close();

    store = await openLocalStore(root);
    const reopened = await ManagerCoordinator.create(store, new RecordingRuntime(), { now: () => now });
    assert.equal(reopened.state().lease, null);
    assert.equal(reopened.state().entries[0].taskId, "task-recover");
    assert.equal(store.tasks.get("task-recover").state, "queued");
    reopened.dispose();
    store.close();
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("a selected manager start cannot fall through when its permission is revoked", async () => {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-manager-selected-start-")));
  let store;
  let coordinator;
  try {
    store = await openLocalStore(root);
    seedTask(store, "selected", due);
    seedTask(store, "other", due);
    store.permissionRules.put(rule("allow", "global", "attempt", now));
    const runtime = new RecordingRuntime();
    coordinator = await ManagerCoordinator.create(store, runtime, {
      now: () => now,
      startAssignment: (taskId) => coordinator.startTask(taskId),
    });
    coordinator.enqueue({ taskId: "task-selected" });
    coordinator.enqueue({ taskId: "task-other" });
    store.permissionRules.put({
      ...rule("deny-selected", "assignment", "do_not_attempt", "2026-09-01T12:01:00.000Z"),
      assignmentId: "assignment-selected",
    });

    await assert.rejects(
      coordinator.startFromConversation("task-selected"),
      /Task task-selected is blocked by stored permission rules/,
    );
    assert.equal(store.tasks.get("task-selected").state, "discovered");
    assert.equal(store.tasks.get("task-other").state, "queued");
    assert.equal(coordinator.state().lease, null, "no other task acquires the browser lease");
    assert.deepEqual(coordinator.state().entries.map((entry) => entry.taskId), ["task-other"]);
  } finally {
    coordinator?.dispose();
    store?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

class RecordingRuntime {
  workerResumePaths = [];
  sessionNumber = 0;

  async createWorkerSession(target = {}) {
    if (target.resumeSessionPath) this.workerResumePaths.push(target.resumeSessionPath);
    return this.session("worker", target.resumeSessionPath, ["studi_probe"]);
  }

  session(kind, resumePath, toolNames) {
    this.sessionNumber += 1;
    let sessionId = `${kind}-${this.sessionNumber}`;
    let sessionPath = resumePath ?? `${kind}-${this.sessionNumber}.jsonl`;
    const listeners = new Set();
    return {
      get sessionId() { return sessionId; },
      get sessionPath() { return sessionPath; },
      toolNames,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      prompt: async (prompt) => {
        for (const listener of listeners) listener({ schemaVersion: 1, type: "text", delta: "Done." });
        for (const listener of listeners) listener({ schemaVersion: 1, type: "terminal", outcome: "completed" });
      },
      compact: async () => {},
      abort: async () => {},
      replace: async (target = {}) => {
        this.sessionNumber += 1;
        sessionId = `${kind}-replacement-${this.sessionNumber}`;
        sessionPath = target.resumeSessionPath ?? `${kind}-replacement-${this.sessionNumber}.jsonl`;
      },
      dispose() {},
    };
  }
}

function seedTask(store, suffix, dueAt) {
  const assignmentId = `assignment-${suffix}`;
  const taskId = `task-${suffix}`;
  const courseId = `course-${suffix}`;
  const evidence = { schemaVersion: 1, evidenceId: `evidence-${suffix}`, reference: `evidence-${suffix}`, kind: "text_snapshot", sourceTarget: `https://school.example.edu/assignments/${suffix}`, capturedAt: now };
  store.assignments.put({
    schemaVersion: 1,
    assignmentId,
    courseId,
    title: `Assignment ${suffix}`,
    sourceTarget: `https://school.example.edu/assignments/${suffix}`,
    dueAt,
    deadlinePrecision: "datetime", deadlineEvidence: evidence,
    schoolStatus: { state: "not_submitted", text: "Not submitted", evidence },
    requirementEvidence: [{ text: "Solve the assigned exercises and upload a PDF.", evidence }],
    requirementsState: "complete",
    discoveredAt: now,
    lastVerifiedScanId: "scan-manager-test",
    evidence: [{
      schemaVersion: 1,
      evidenceId: `evidence-${suffix}`,
      reference: `evidence-${suffix}`,
      kind: "agent_observation",
      sourceTarget: `https://school.example.edu/assignments/${suffix}`,
      capturedAt: now,
      summary: `Observed Assignment ${suffix}.`,
    }],
  });
  const task = {
    schemaVersion: 1,
    taskId,
    assignmentId,
    state: "discovered",
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
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
      occurredAt: now,
      type: "task_created",
      payload: {
        taskId,
        assignmentId,
        state: "discovered",
        revision: 0,
        createdAt: now,
        updatedAt: now,
      },
    },
  });
}

function rule(ruleId, scope, mode, updatedAt) {
  return { schemaVersion: 1, ruleId, scope, mode, updatedAt };
}

test("uncertain quiz/essay labels never grant a stronger kind rule and retain weaker restrictions", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-kind-permission-"));
  const store = await openLocalStore(root);
  const manager = await ManagerCoordinator.create(store, new RecordingRuntime(), { now: () => now });
  try {
    seedTask(store, "kind", due);
    const original = store.assignments.get("assignment-kind");
    store.assignments.put({ ...original, kind: "quiz", possibleKinds: ["quiz", "essay"], kindConfidence: "uncertain", kindEvidence: original.deadlineEvidence });
    store.permissionRules.put(rule("global", "global", "attempt", now));
    store.permissionRules.put({ ...rule("quiz", "pattern", "auto_submit", now), courseId: original.courseId, patternId: "quiz" });
    manager.confirmKindMatches(original.courseId, "quiz");
    assert.equal(store.manager.listConfirmedPatterns(original.assignmentId, original.courseId).length, 0);
    assert.equal(manager.resolvePermission(original.assignmentId, original.courseId).mode, "attempt");
    store.permissionRules.put({ ...rule("essay", "pattern", "do_not_attempt", now), courseId: original.courseId, patternId: "essay" });
    assert.equal(manager.resolvePermission(original.assignmentId, original.courseId).mode, "do_not_attempt");
    store.assignments.put({ ...original, possibleKinds: [], kindConfidence: "uncertain" });
    store.permissionRules.put(rule("global", "global", "auto_submit", now));
    assert.equal(manager.resolvePermission(original.assignmentId, original.courseId).mode, "do_not_attempt", "unknown must not fall through to global submission");
    store.assignments.put({ ...original, kind: "quiz", possibleKinds: ["quiz"], kindConfidence: "explicit", kindEvidence: original.deadlineEvidence });
    store.permissionRules.put(rule("global", "global", "attempt", now));
    assert.equal(manager.resolvePermission(original.assignmentId, original.courseId).mode, "attempt", "an observed label alone cannot widen permission");
    manager.confirmKindMatches(original.courseId, "quiz");
    assert.equal(manager.resolvePermission(original.assignmentId, original.courseId).mode, "auto_submit");
    store.assignments.put({ ...original, possibleKinds: ["quiz", "essay"], kindConfidence: "uncertain" });
    assert.equal(manager.resolvePermission(original.assignmentId, original.courseId).mode, "do_not_attempt", "a stale confirmed label cannot override new uncertainty");
    store.permissionRules.put({ ...rule("student-exception", "assignment", "attempt", now), assignmentId: original.assignmentId });
    assert.equal(manager.resolvePermission(original.assignmentId, original.courseId).mode, "attempt", "an explicit assignment exception still follows rule precedence");
  } finally { manager.dispose(); store.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("assignment browser controls recheck the lease and current permission for new and restored sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-worker-control-"));
  const store = await openLocalStore(root);
  const runtime = new RecordingRuntime();
  const controls = [];
  runtime.createAssignmentSession = async (tools, target, control) => { controls.push(control); return runtime.session("assignment", target.resumeSessionPath, tools.map(tool => tool.name)); };
  const manager = await ManagerCoordinator.create(store, runtime, { now: () => now });
  try {
    seedTask(store, "guard", due);
    store.permissionRules.put(rule("global", "global", "attempt", now));
    await manager.startTask("task-guard", [{ name: "test_action" }]);
    assert.doesNotThrow(() => controls[0].assertActive());
    await manager.restoreAssignmentWorker([{ name: "test_action" }]);
    assert.doesNotThrow(() => controls[1].assertActive());
    store.permissionRules.put({ ...rule("revoke", "assignment", "do_not_attempt", now), assignmentId: "assignment-guard" });
    for (const control of controls) assert.throws(() => control.assertActive(), /no longer allow/);
    manager.cancel("task-guard");
    for (const control of controls) assert.throws(() => control.assertActive(), /no longer owns/);
  } finally { manager.dispose(); store.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("scheduled starts require auto-submit while attempt-only work remains explicitly startable", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-scheduled-permission-"));
  const store = await openLocalStore(root);
  const manager = await ManagerCoordinator.create(store, new RecordingRuntime(), { now: () => now });
  try {
    seedTask(store, "automatic", due);
    seedTask(store, "manual-attempt", due);
    store.permissionRules.put(rule("global", "global", "attempt", now));
    store.permissionRules.put({ ...rule("automatic", "assignment", "auto_submit", now), assignmentId: "assignment-automatic" });
    manager.setWorkStartMode("automatic");
    manager.setSchedulingEnabled(true);
    assert.deepEqual(manager.state().entries.map(entry => entry.taskId), ["task-automatic"]);
    assert.ok(manager.state().entries[0].scheduledStartAt);
    manager.enqueue({ taskId: "task-manual-attempt", requestOrigin: "student" });
    assert.equal(manager.state().entries.find(entry => entry.taskId === "task-manual-attempt").scheduledStartAt, undefined);
    store.permissionRules.put({ ...rule("automatic", "assignment", "attempt", now), assignmentId: "assignment-automatic" });
    manager.reconcileQueue();
    assert.ok(manager.state().entries.every(entry => entry.scheduledStartAt === undefined), "downgrading an existing scheduled entry withdraws its promise");
    const lease = await manager.startTask("task-manual-attempt");
    assert.equal(lease.taskId, "task-manual-attempt", "an explicit student start still allows attempt-only work");
  } finally { manager.dispose(); store.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("homework corrections, ignore reasons, owner and queue order survive restart and stale scan writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-homework-corrections-"));
  let store = await openLocalStore(root);
  let manager = await ManagerCoordinator.create(store, new RecordingRuntime(), { now: () => now });
  const sourceRequests = [];
  const scan = { state: async () => ({ assignments: store.assignments.listAll() }), startSourceScan: async url => sourceRequests.push(url) };
  let manualId;
  try {
    for (const suffix of ["a", "b", "c"]) seedTask(store, suffix, due);
    store.permissionRules.put(rule("global", "global", "attempt", now));
    const homework = new HomeworkCoordinator(store, manager, scan, () => now);
    const stale = store.assignments.get("assignment-a");
    await homework.correctAssignment({ assignmentId: stale.assignmentId, correction: "due_date", dueAt: "2026-09-05T12:00:00.000Z" });
    await homework.correctAssignment({ assignmentId: stale.assignmentId, correction: "due_date", dueAt: "2026-09-06T12:00:00.000Z" });
    store.assignments.put(stale);
    assert.equal(store.assignments.get(stale.assignmentId).dueAt, "2026-09-06T12:00:00.000Z");
    for (const suffix of ["a", "b", "c"]) manager.enqueue({ taskId: `task-${suffix}` });
    manager.reorderQueue(["task-c", "task-a"]);
    assert.deepEqual(manager.state().entries.map(entry => entry.taskId), ["task-c", "task-a", "task-b"]);
    assert.throws(() => manager.reorderQueue(["task-c", "missing"]));
    assert.deepEqual(manager.state().entries.map(entry => entry.taskId), ["task-c", "task-a", "task-b"]);
    await homework.setAssignmentOwner({ assignmentId: "assignment-b", owner: "student" });
    assert.equal(manager.resolvePermission("assignment-b", "course-b").mayAttempt, false);
    await homework.setAssignmentOwner({ assignmentId: "assignment-b", owner: "inky" });
    assert.equal(manager.resolvePermission("assignment-b", "course-b").mode, "attempt");
    await homework.correctAssignment({ assignmentId: "assignment-b", correction: "not_homework", reason: "Optional reading" });
    const ignored = store.assignments.get("assignment-b");
    store.assignments.put({ ...ignored, ignoredReason: undefined, ignoredNote: undefined });
    assert.equal(store.assignments.get("assignment-b").ignoredNote, "Optional reading");
    await homework.addAssignment({ text: "Bring a draft to class" });
    manualId = store.assignments.listAll().find(item => item.origin === "manual").assignmentId;
    assert.equal(store.assignments.get(manualId).sourceTarget, undefined);
    assert.equal(store.assignments.get(manualId).dueAt, undefined);
    await homework.addAssignment({ text: "https://school.example.edu/assignments/new" });
    assert.deepEqual(sourceRequests, ["https://school.example.edu/assignments/new"]);
    const before = manager.state().entries.map(entry => entry.taskId);
    manager.dispose(); store.close();
    store = await openLocalStore(root);
    manager = await ManagerCoordinator.create(store, new RecordingRuntime(), { now: () => now });
    assert.deepEqual(manager.state().entries.map(entry => entry.taskId), before);
    assert.equal(store.assignments.get("assignment-a").dueDateOverride.dueAt, "2026-09-06T12:00:00.000Z");
    assert.equal(store.tasks.get("task-b").state, "ignored");
    assert.equal(store.assignments.get("assignment-b").ignoredNote, "Optional reading");
    assert.equal(store.assignments.get(manualId).origin, "manual");
  } finally { manager.dispose(); store.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});


test("cancelled work retries only after an explicit request and a fresh permission check", async () => {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-retry-")));
  const store = await openLocalStore(root);
  const manager = await ManagerCoordinator.create(store, new RecordingRuntime(), { now: () => now });
  try {
    seedTask(store, "retry", due);
    store.permissionRules.put(rule("global-attempt", "global", "attempt", now));
    manager.enqueue({ taskId: "task-retry" });
    manager.cancel("task-retry");
    assert.throws(() => manager.enqueue({ taskId: "task-retry" }), /cannot be queued from cancelled/);
    store.permissionRules.put(rule("global-attempt", "global", "do_not_attempt", now));
    assert.throws(() => manager.enqueue({ taskId: "task-retry", retry: true }), /blocked by stored permission/);
    assert.equal(store.tasks.get("task-retry").state, "cancelled");
    store.permissionRules.put(rule("global-attempt", "global", "attempt", now));
    manager.enqueue({ taskId: "task-retry", retry: true });
    assert.equal(store.tasks.get("task-retry").state, "queued");
    assert.equal((await manager.startNext()).taskId, "task-retry");
  } finally {
    manager.dispose(); store.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
