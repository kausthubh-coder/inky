import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openLocalStore, validateLocalStoreBackup } from "../../dist/electron/storage/index.js";
import { reconcileCourses } from "../../dist/electron/storage/course-reconciliation.js";
import { ManagerCoordinator } from "../../dist/electron/manager/coordinator.js";

const now = "2026-09-10T12:00:00.000Z";
const site = "https://school.example.edu/moodle";
const list = `${site}/mod/assign/index.php?id=11497`;
function course(store, id, target = list, label = "C and Software Tools") {
  return store.school.putCourse({ schemaVersion: 1, courseId: id, label, sourceTarget: target,
    lastVerifiedScanId: "scan", lastVerifiedAt: now,
    evidence: { schemaVersion: 1, evidenceId: `evidence-${id}`, reference: `evidence-${id}`, kind: "agent_observation",
      sourceTarget: target, capturedAt: now, summary: `Observed ${label}` } });
}
function assignment(store, id, courseId, target = list) {
  return store.assignments.put({ schemaVersion: 1, assignmentId: id, courseId, title: "exercise_05",
    sourceTarget: target, discoveredAt: now, evidence: [] });
}
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "studi-course-reconcile-"));
  const store = await openLocalStore(join(root, "data"));
  try { await fn(store, root); } finally { store.close(); await rm(root, { recursive: true, force: true }); }
}

test("legacy directory and full-label class reconcile through course ID, preserving rules, assignments and old links", async () => {
  await fixture(async (store, root) => {
    course(store, "short", "https://directory.example.edu/my-courses");
    course(store, "full", `${site}/course/view.php?id=11497`, "CSC 230 (002) Fall 2026 C and Software Tools");
    assignment(store, "legacy", "short");
    assignment(store, "detail", "full", `${site}/mod/assign/view.php?id=1360423`);
    for (const id of ["short", "full"]) store.permissionRules.put({ schemaVersion: 1, ruleId: `rule-${id}`,
      scope: "course", courseId: id, mode: "attempt", updatedAt: now });
    store.manager.confirmPatternMatch({ schemaVersion: 1, assignmentId: "detail", courseId: "full", patternId: "weekly", confirmedAt: now });
    assert.deepEqual(reconcileCourses(store), []);
    assert.equal(store.school.listCourses().length, 1);
    const canonical = store.school.resolveCourseId("short");
    assert.equal(store.school.resolveCourseId("full"), canonical);
    assert.equal(store.assignments.listAll().length, 2, "a shared title does not prove the list observation's assignment identity");
    assert.ok(store.assignments.listAll().every(row => row.courseId === canonical));
    assert.ok(store.permissionRules.listAll().every(row => row.courseId === canonical));
    assert.equal(store.manager.listConfirmedPatterns("detail", "full").length, 1);
    assert.equal(assignment(store, "later", "full").courseId, canonical);
    const donor = canonical === "short" ? "full" : "short";
    assert.throws(() => course(store, donor), /merged/);
    assert.equal(store.permissionRules.put({ schemaVersion: 1, ruleId: "late-rule", scope: "course", courseId: donor,
      mode: "do_not_attempt", updatedAt: now }).courseId, canonical);
    await store.backup(join(root, "backup"));
    await validateLocalStoreBackup(join(root, "backup"));
    const reopened = await openLocalStore(join(root, "data"));
    try { assert.equal(reopened.school.listCourses().length, 1); assert.equal(reopened.school.resolveCourseId(donor), canonical); }
    finally { reopened.close(); }
  });
});

test("same titles, distinct sites/terms/course IDs, and contradictory membership never merge", async () => {
  await fixture(async store => {
    course(store, "one");
    course(store, "two", list.replace("11497", "12172"));
    course(store, "other-site", list.replace("school.", "other."));
    course(store, "other-install", list.replace("/moodle/", "/fall/"));
    course(store, "directory", "https://directory.example.edu/my-courses");
    assignment(store, "conflicting-one", "directory");
    assignment(store, "conflicting-two", "directory", list.replace("11497", "12172"));
    assert.deepEqual(reconcileCourses(store), []);
    assert.equal(store.school.listCourses().length, 5);
  });
});

test("course policies remain separate and pause work, including inherited versus explicit permissions", async () => {
  await fixture(async store => {
    course(store, "one"); course(store, "two"); assignment(store, "homework", "two");
    store.permissionRules.put({ schemaVersion: 1, ruleId: "global", scope: "global", mode: "attempt", updatedAt: now });
    store.permissionRules.put({ schemaVersion: 1, ruleId: "explicit", scope: "course", courseId: "one", mode: "attempt", updatedAt: now });
    store.courseConflicts = reconcileCourses(store);
    assert.match(store.courseConflicts[0].reason, /permissions/);
    assert.equal(store.school.listCourses().length, 2);
    const manager = await ManagerCoordinator.create(store, {}, { now: () => now });
    try { assert.equal(manager.resolvePermission("homework", "two").mayAttempt, false); }
    finally { manager.dispose(); }
  });
});

test("two independent course notes remain intact for review; transaction failure rolls back redirects and membership", async () => {
  await fixture(async store => {
    course(store, "one"); course(store, "two"); assignment(store, "homework", "two");
    store.database.handle.exec("CREATE TRIGGER reject_course_repair BEFORE DELETE ON courses BEGIN SELECT RAISE(ABORT, 'repair failure'); END");
    assert.throws(() => reconcileCourses(store), /repair failure/);
    assert.equal(store.school.listCourses().length, 2);
    assert.equal(store.assignments.get("homework").courseId, "two");
    assert.equal(store.database.handle.prepare("SELECT count(*) n FROM record_redirects").get().n, 0);
    store.database.handle.exec("DROP TRIGGER reject_course_repair");
    for (const id of ["one", "two"]) await store.artifacts.write({ frontmatter: { schemaVersion: 1, kind: "memory", artifactId: `memory-${id}`, updatedAt: now }, content: `Saved notes for ${id}` });
    assert.match(reconcileCourses(store)[0].reason, /separate saved notes/);
    assert.equal(store.school.listCourses().length, 2);
  });
});
