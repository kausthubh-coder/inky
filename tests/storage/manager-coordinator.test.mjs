import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { ManagerCoordinator } from "../../dist/electron/manager/coordinator.js";
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
    await invokeManagerTool(runtime, "manager_assignment_start", { taskId: "task-b" });
    assert.deepEqual(delegatedStarts, ["task-b"], "the manager delegates a verified queued task to the configured execution owner");

    store.permissionRules.put({
      ...rule("deny-b", "assignment", "do_not_attempt", "2026-09-01T12:02:00.000Z"),
      assignmentId: "assignment-b",
    });
    const lease = await coordinator.startNext();
    assert.equal(store.tasks.get("task-b").state, "cancelled", "permission is resolved again at start");
    assert.equal(lease.taskId, "task-a");
    assert.equal(coordinator.state().lease.taskId, "task-a");
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

    await store.artifacts.write(artifact("preference", "global", "Prefer work due soon."));
    await store.artifacts.write(artifact("memory", "calculus", "The student uses radians."));
    const beforeTurn = coordinator.state();
    await coordinator.runManagerTurn("Explain the next item.", ["calculus"]);
    assert.match(runtime.managerPrompts.at(-1), /# Global preferences[\s\S]*Prefer work due soon\./);
    assert.match(runtime.managerPrompts.at(-1), /# Scoped memories[\s\S]*The student uses radians\./);
    assert.match(runtime.managerPrompts.at(-1), /# Student request[\s\S]*Explain the next item\./);

    await store.productPreferences.put({ schemaVersion: 1, reviewMinutes: 15, handoffMinutes: 30, memoryVisibility: "none", updatedAt: now });
    await coordinator.runManagerTurn("Do not use memory.", ["calculus"]);
    assert.doesNotMatch(runtime.managerPrompts.at(-1), /The student uses radians\./);
    assert.match(runtime.managerPrompts.at(-1), /No scoped memories were requested/);

    await store.artifacts.write(artifact("memory", "algebra", "The student prefers factoring first."));
    await store.productPreferences.put({ schemaVersion: 1, reviewMinutes: 15, handoffMinutes: 30, memoryVisibility: "all", updatedAt: now });
    await coordinator.runManagerTurn("Use all visible memory.", []);
    assert.match(runtime.managerPrompts.at(-1), /The student uses radians\./);
    assert.match(runtime.managerPrompts.at(-1), /The student prefers factoring first\./);
    await coordinator.replaceManagerSession();
    assert.deepEqual(coordinator.state(), beforeTurn, "session replacement does not own queue state");

    const persistedState = coordinator.state();
    coordinator.dispose();
    store.close();

    store = await openLocalStore(root);
    const reopenedRuntime = new RecordingRuntime();
    coordinator = await ManagerCoordinator.create(store, reopenedRuntime, { now: () => now });
    assert.deepEqual(coordinator.state(), persistedState);
    assert.deepEqual(reopenedRuntime.workerResumePaths, [lease.workerSessionPath]);
    assert.equal(reopenedRuntime.managerResumePaths.length, 1);
    await assert.rejects(coordinator.startNext(), /already has an active worker lease/);

    coordinator.finish("task-a", "ready_review");
    assert.equal(coordinator.state().lease, null);
    assert.equal(store.tasks.get("task-a").state, "ready_review");
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
      invokeManagerTool(runtime, "manager_assignment_start", { taskId: "task-selected" }),
      /Task task-selected is blocked by stored permission rules/,
    );
    assert.equal(store.tasks.get("task-selected").state, "cancelled");
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
  managerPrompts = [];
  managerResumePaths = [];
  workerResumePaths = [];
  sessionNumber = 0;
  managerTools = [];

  async createManagerSession(tools, target = {}) {
    this.managerTools = tools;
    this.managerResumePaths.push(target.resumeSessionPath ?? null);
    return this.session("manager", target.resumeSessionPath, tools.map((tool) => tool.name));
  }

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
        if (kind === "manager") this.managerPrompts.push(prompt);
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
  store.assignments.put({
    schemaVersion: 1,
    assignmentId,
    courseId,
    title: `Assignment ${suffix}`,
    sourceTarget: `https://school.example.edu/assignments/${suffix}`,
    dueAt,
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

async function invokeManagerTool(runtime, name, input) {
  const tool = runtime.managerTools.find((candidate) => candidate.name === name);
  assert.ok(tool, `missing manager tool ${name}`);
  return tool.execute(`call-${name}`, input, undefined, undefined, {});
}

function rule(ruleId, scope, mode, updatedAt) {
  return { schemaVersion: 1, ruleId, scope, mode, updatedAt };
}

function artifact(kind, artifactId, content) {
  return {
    frontmatter: { schemaVersion: 1, kind, artifactId, updatedAt: now },
    content,
  };
}
