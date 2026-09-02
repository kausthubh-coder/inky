import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  openLocalStore,
  restoreLocalStoreBackup,
  validateLocalStoreBackup,
} from "../../dist/electron/storage/index.js";
import { transitionTask } from "../../dist/shared/index.js";
import { assignment, run, task, timestamp } from "../contracts/fixtures.mjs";

test("reopening schema 1 is idempotent and does not rerun migration 1", async () => {
  await withFixture(async (root) => {
    const first = await openLocalStore(root);
    first.close();

    const raw = new DatabaseSync(join(root, "studi.sqlite3"));
    const before = raw
      .prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => ({ ...row }));
    raw.close();

    const reopened = await openLocalStore(root, {
      failureInjector(point) {
        if (point === "migration_before_version") {
          throw new Error("migration 1 ran during an idempotent reopen");
        }
      },
    });
    reopened.close();

    const verified = new DatabaseSync(join(root, "studi.sqlite3"));
    try {
      assert.deepEqual(
        verified
          .prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version")
          .all()
          .map((row) => ({ ...row })),
        before,
      );
    } finally {
      verified.close();
    }
  });
});

test("task creation and transition failures roll back both rows and enforce revision and sequence", async () => {
  await withFixture(async (root) => {
    let failBeforeProjection = true;
    const store = await openLocalStore(root, {
      failureInjector(point) {
        if (point === "task_before_projection" && failBeforeProjection) {
          throw new Error("injected projection failure");
        }
      },
    });

    assert.throws(
      () =>
        store.tasks.append({
          event: taskCreatedEvent(),
          projection: task,
          expectedRevision: null,
        }),
      (error) => error.code === "invalid_event_stream",
    );
    assert.equal(store.tasks.get(task.taskId), null);
    assert.deepEqual(store.tasks.listEvents(task.taskId), []);

    failBeforeProjection = false;
    store.tasks.append({
      event: taskCreatedEvent(),
      projection: task,
      expectedRevision: null,
    });

    const queued = transitionTask(task, {
      type: "transition",
      to: "queued",
      eventId: "event-independent-queued",
      runId: "run-independent-queued",
      sequence: 1,
      occurredAt: "2026-08-31T12:01:00.000Z",
    });
    assert.equal(queued.ok, true);
    failBeforeProjection = true;
    assert.throws(
      () =>
        store.tasks.append({
          event: queued.event,
          projection: queued.task,
          expectedRevision: 0,
        }),
      (error) => error.code === "invalid_event_stream",
    );
    assert.deepEqual(store.tasks.get(task.taskId), task);
    assert.equal(store.tasks.listEvents(task.taskId).length, 1);

    failBeforeProjection = false;
    const skippedSequence = {
      ...queued.event,
      eventId: "event-independent-skipped",
      sequence: 2,
    };
    assert.throws(
      () =>
        store.tasks.append({
          event: skippedSequence,
          projection: queued.task,
          expectedRevision: 0,
        }),
      (error) => error.code === "event_sequence_invalid",
    );

    store.tasks.append({ event: queued.event, projection: queued.task, expectedRevision: 0 });
    const working = transitionTask(queued.task, {
      type: "transition",
      to: "working",
      eventId: "event-independent-working",
      runId: "run-independent-working",
      sequence: 2,
      occurredAt: "2026-08-31T12:02:00.000Z",
    });
    assert.equal(working.ok, true);
    assert.throws(
      () =>
        store.tasks.append({
          event: working.event,
          projection: working.task,
          expectedRevision: 0,
        }),
      (error) => error.code === "optimistic_revision_conflict",
    );
    assert.deepEqual(store.tasks.get(task.taskId), queued.task);
    assert.equal(store.tasks.listEvents(task.taskId).length, 2);
    store.close();
  });
});

test("assignment, permission, and run repositories validate stored JSON again on read", async () => {
  await withFixture(async (root) => {
    const permission = globalPermissionRule();
    const store = await openLocalStore(root);
    store.assignments.put(assignment);
    store.permissionRules.put(permission);
    store.runs.put(run);
    assert.deepEqual(store.assignments.get(assignment.assignmentId), assignment);
    assert.deepEqual(store.permissionRules.get(permission.ruleId), permission);
    assert.deepEqual(store.runs.get(run.runId), run);
    store.close();

    const raw = new DatabaseSync(join(root, "studi.sqlite3"));
    try {
      raw.prepare("UPDATE assignments SET record_json = ? WHERE assignment_id = ?").run(
        JSON.stringify({ ...assignment, title: "" }),
        assignment.assignmentId,
      );
      raw.prepare("UPDATE permission_rules SET record_json = ? WHERE rule_id = ?").run(
        JSON.stringify({ ...permission, mode: "unlimited" }),
        permission.ruleId,
      );
      raw.prepare("UPDATE runs SET record_json = ? WHERE run_id = ?").run(
        JSON.stringify({ ...run, state: "unknown" }),
        run.runId,
      );
    } finally {
      raw.close();
    }

    const reopened = await openLocalStore(root);
    try {
      for (const read of [
        () => reopened.assignments.get(assignment.assignmentId),
        () => reopened.permissionRules.get(permission.ruleId),
        () => reopened.runs.get(run.runId),
      ]) {
        assert.throws(read, (error) => error.code === "record_validation_failed");
      }
    } finally {
      reopened.close();
    }
  });
});

test("backup validation rejects a version-1 database missing a required table before restore", async () => {
  await withFixture(async (workspace) => {
    const sourceRoot = join(workspace, "source");
    const targetRoot = join(workspace, "target");
    const backupRoot = join(workspace, "backup");
    const source = await openLocalStore(sourceRoot);
    source.assignments.put(assignment);
    await source.backup(backupRoot);
    source.close();

    const targetOnly = { ...assignment, assignmentId: "assignment-target-only" };
    const target = await openLocalStore(targetRoot);
    target.assignments.put(targetOnly);
    target.close();

    const damaged = new DatabaseSync(join(backupRoot, "studi.sqlite3"));
    damaged.exec("DROP TABLE assignments");
    damaged.close();

    let validationAccepted = false;
    try {
      await validateLocalStoreBackup(backupRoot);
      validationAccepted = true;
    } catch (error) {
      assert.equal(error.code, "backup_invalid");
    }

    let restoreAccepted = false;
    try {
      await restoreLocalStoreBackup(backupRoot, targetRoot);
      restoreAccepted = true;
    } catch (error) {
      assert.equal(error.code, "backup_invalid");
    }

    let targetRecordSurvived = false;
    const reopened = await openLocalStore(targetRoot);
    try {
      targetRecordSurvived =
        reopened.assignments.get(targetOnly.assignmentId)?.assignmentId === targetOnly.assignmentId;
    } catch {
      targetRecordSurvived = false;
    } finally {
      reopened.close();
    }

    assert.deepEqual(
      { validationAccepted, restoreAccepted, targetRecordSurvived },
      { validationAccepted: false, restoreAccepted: false, targetRecordSurvived: true },
    );
  });
});

test("a restore error after moving the active root rolls back to the prior data", async () => {
  await withFixture(async (workspace) => {
    const activeRoot = join(workspace, "active");
    const backupRoot = join(workspace, "backup");
    const active = await openLocalStore(activeRoot);
    active.assignments.put(assignment);
    await active.backup(backupRoot);
    const postBackup = { ...assignment, assignmentId: "assignment-after-backup" };
    active.assignments.put(postBackup);
    active.close();

    await assert.rejects(
      restoreLocalStoreBackup(backupRoot, activeRoot, {
        failureInjector(point) {
          if (point === "restore_after_previous_move") {
            throw new Error("injected Windows directory replacement failure");
          }
        },
      }),
      (error) => error.code === "restore_failed",
    );

    const reopened = await openLocalStore(activeRoot);
    try {
      assert.deepEqual(reopened.assignments.get(postBackup.assignmentId), postBackup);
    } finally {
      reopened.close();
    }
  });
});

function taskCreatedEvent() {
  return {
    schemaVersion: 1,
    eventId: "event-independent-created",
    aggregateType: "task",
    aggregateId: task.taskId,
    runId: "run-independent-created",
    sequence: 0,
    occurredAt: timestamp,
    type: "task_created",
    payload: {
      taskId: task.taskId,
      assignmentId: task.assignmentId,
      state: "discovered",
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

function globalPermissionRule() {
  return {
    schemaVersion: 1,
    ruleId: "rule-independent-global",
    scope: "global",
    mode: "attempt",
    updatedAt: timestamp,
  };
}

async function withFixture(run) {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-wp02-independent-")));
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.match(basename(root), /^studi-wp02-independent-/);
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
