import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openLocalStore, validateLocalStoreBackup } from "../../dist/electron/storage/index.js";
import { reconcileAssignments } from "../../dist/electron/storage/assignment-reconciliation.js";
import { assignmentIdentity, schoolIdentity, observedTarget } from "../../dist/electron/scan/source-identity.js";
import { ManagerCoordinator } from "../../dist/electron/manager/coordinator.js";

const now = "2026-09-08T12:00:00.000Z";
const target = "https://school.example.edu/moodle/mod/assign/view.php?id=1360376";

function seed(store, id, sourceTarget = target, courseId = "course-short") {
  const assignment = store.assignments.put({ schemaVersion: 1, assignmentId: id, courseId,
    title: "Homework 1", sourceTarget, discoveredAt: now, evidence: [] });
  const taskId = `task-${id}`;
  const task = { schemaVersion: 1, taskId, assignmentId: id, state: "discovered", revision: 0, createdAt: now, updatedAt: now };
  store.tasks.append({ expectedRevision: null, projection: task, event: {
    schemaVersion: 1, eventId: `event-${id}`, aggregateType: "task", aggregateId: taskId,
    runId: "scan-origin", sequence: 0, occurredAt: now, type: "task_created",
    payload: { taskId, assignmentId: id, state: "discovered", revision: 0, createdAt: now, updatedAt: now },
  } });
  return assignment;
}

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "studi-reconcile-"));
  const store = await openLocalStore(join(root, "data"));
  try { await fn(store, root); } finally { store.close(); await rm(root, { recursive: true, force: true }); }
}

test("school identity ignores Moodle view options, but separates installations, module types and ids", () => {
  assert.equal(schoolIdentity(target, "assignment"), schoolIdentity(`${target}&action=editsubmission#intro`, "assignment"));
  for (const other of [target.replace("1360376", "1360377"), target.replace("school.", "other."),
    target.replace("/moodle/", "/another/"), target.replace("/assign/", "/quiz/")]) {
    assert.notEqual(schoolIdentity(target, "assignment"), schoolIdentity(other, "assignment"));
  }
  assert.equal(schoolIdentity("https://school.example.edu/moodle/course/view.php?id=123", "course"),
    schoolIdentity("https://school.example.edu/moodle/mod/assign/index.php?id=123", "course"));
  assert.equal(schoolIdentity("https://school.example.edu/moodle/mod/assign/index.php?id=123", "assignment"), null);
  assert.equal(schoolIdentity(`${target}&id=999`, "assignment"), null);
  assert.notEqual(assignmentIdentity("https://school.example.edu/#/assignments/1"), assignmentIdentity("https://school.example.edu/#/assignments/2"));
});

test("ambiguous assignment links require a ref or a detail visit", () => {
  const snapshot = { url: target, elements: [
    { ref: "a", role: "link", name: "Homework 1", href: target },
    { ref: "b", role: "link", name: "Homework 1", href: target.replace("1360376", "999") },
  ] };
  assert.throws(() => observedTarget(snapshot, "Homework 1"), /Several links/);
  assert.equal(observedTarget(snapshot, "Homework 1", "b"), snapshot.elements[1].href);
});

test("repair retains the worked task, archives originals, redirects old links, and survives backup/restart", async () => {
  await fixture(async (store, root) => {
    seed(store, "a-empty");
    const worked = seed(store, "b-worked", `${target}&action=editsubmission`, "course-long");
    store.lifecycle.putExecution({ schemaVersion: 1, taskId: "task-b-worked", assignmentId: worked.assignmentId,
      phase: "preserved", answerArtifactId: "answer-b-worked", taskBudget: { maxAgentTurns: 24, maxRecoveryAttempts: 2 }, turnCount: 1,
      attemptCount: 0, answerSnapshot: "My saved answer", updatedAt: now });
    await store.artifacts.write({ frontmatter: { schemaVersion: 1, kind: "answer", artifactId: "answer-b-worked", updatedAt: now }, content: "My saved answer for task-b-worked" });
    const before = store.tasks.listEvents("task-b-worked");
    assert.deepEqual(reconcileAssignments(store), []);
    assert.equal(store.assignments.listAll().length, 1);
    assert.equal(store.tasks.listAll().length, 1);
    assert.equal(store.assignments.get("a-empty").assignmentId, "b-worked");
    assert.equal(store.tasks.get("task-a-empty").taskId, "task-b-worked");
    assert.deepEqual(store.tasks.replay("task-a-empty"), store.tasks.get("task-b-worked"));
    assert.deepEqual(store.tasks.listEvents("task-b-worked"), before);
    assert.equal(store.lifecycle.getExecution("task-b-worked").answerSnapshot, "My saved answer");
    const archived = JSON.parse(store.database.handle.prepare("SELECT record_json FROM record_redirects WHERE kind = 'task'").get().record_json);
    assert.equal(archived.events[0].payload.assignmentId, "a-empty");
    assert.throws(() => seed(store, "a-empty"), /merged/);
    const rule = store.permissionRules.put({ schemaVersion: 1, ruleId: "old-link-rule", scope: "assignment", assignmentId: "a-empty", mode: "do_not_attempt", updatedAt: now });
    assert.equal(rule.assignmentId, "b-worked", "a restriction saved through an old assignment link applies to the retained assignment");
    assert.deepEqual(reconcileAssignments(store), []);
    await store.backup(join(root, "backup"));
    await validateLocalStoreBackup(join(root, "backup"));
    const reopened = await openLocalStore(join(root, "data"));
    try { assert.equal(reopened.assignments.get("a-empty").assignmentId, "b-worked"); }
    finally { reopened.close(); }
  });
});

test("different permissions and separate work histories remain explicit conflicts and cannot enqueue", async () => {
  await fixture(async store => {
    seed(store, "a"); seed(store, "b");
    store.permissionRules.put({ schemaVersion: 1, ruleId: "attempt-a", scope: "assignment", assignmentId: "a", mode: "attempt", updatedAt: now });
    store.assignmentConflicts = reconcileAssignments(store);
    assert.match(store.assignmentConflicts[0].reason, /permissions/);
    const manager = await ManagerCoordinator.create(store, {}, { now: () => now });
    try { assert.throws(() => manager.enqueue({ taskId: "task-a" }), /blocked/); }
    finally { manager.dispose(); }
    store.permissionRules.put({ schemaVersion: 1, ruleId: "attempt-b", scope: "assignment", assignmentId: "b", mode: "attempt", updatedAt: now });
    assert.match(reconcileAssignments(store)[0].reason, /separate saved work/);
    assert.equal(store.tasks.listAll().length, 2);
    assert.equal(store.database.handle.prepare("SELECT count(*) AS n FROM record_redirects").get().n, 0);
  });
});

test("repair does not infer identity from shared titles, deadlines or list URLs", async () => {
  await fixture(async store => {
    seed(store, "a", "https://school.example.edu/moodle/mod/assign/index.php?id=123");
    seed(store, "b", "https://school.example.edu/moodle/mod/assign/index.php?id=123");
    seed(store, "c", target);
    seed(store, "d", target.replace("1360376", "999"));
    assert.deepEqual(reconcileAssignments(store), []);
    assert.equal(store.assignments.listAll().length, 4);
  });
});

test("repair rolls back its archives and task deletions if a write fails", async () => {
  await fixture(async store => {
    seed(store, "a"); seed(store, "b");
    store.database.handle.exec("CREATE TRIGGER reject_repair BEFORE DELETE ON assignments BEGIN SELECT RAISE(ABORT, 'repair failure'); END");
    assert.throws(() => reconcileAssignments(store), /repair failure/);
    assert.equal(store.assignments.listAll().length, 2);
    assert.equal(store.tasks.listAll().length, 2);
    assert.equal(store.tasks.listEvents("task-b").length, 1);
    assert.equal(store.database.handle.prepare("SELECT count(*) AS n FROM record_redirects").get().n, 0);
  });
});
