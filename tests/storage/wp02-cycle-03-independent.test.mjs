import assert from "node:assert/strict";
import { cp, lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  openLocalStore,
  restoreLocalStoreBackup,
  validateLocalStoreBackup,
} from "../../dist/electron/storage/index.js";
import {
  assignment,
  run,
  task,
  taskCreatedEvent,
  timestamp,
} from "../contracts/fixtures.mjs";

const recordTables = [
  "assignments",
  "permission_rules",
  "runs",
  "task_events",
  "task_projections",
];

const duplicatedColumns = [
  ["assignments", "assignment_id", "assignment-column-mismatch"],
  ["assignments", "course_id", "course-column-mismatch"],
  ["assignments", "due_at", "2031-01-01T00:00:00.000Z"],
  ["assignments", "discovered_at", "2031-01-02T00:00:00.000Z"],
  ["permission_rules", "rule_id", "rule-column-mismatch"],
  ["permission_rules", "scope", "assignment"],
  ["permission_rules", "course_id", "course-column-mismatch"],
  ["permission_rules", "assignment_id", "assignment-column-mismatch"],
  ["permission_rules", "pattern_id", "pattern-column-mismatch"],
  ["permission_rules", "updated_at", "2031-01-03T00:00:00.000Z"],
  ["runs", "run_id", "run-column-mismatch"],
  ["runs", "task_id", "task-column-mismatch"],
  ["runs", "state", "running"],
  ["runs", "revision", 17],
  ["runs", "updated_at", "2031-01-04T00:00:00.000Z"],
  ["task_events", "event_id", "event-column-mismatch"],
  ["task_events", "task_id", "task-column-mismatch"],
  ["task_events", "run_id", "run-column-mismatch"],
  ["task_events", "sequence", 17],
  ["task_events", "type", "task_state_changed"],
  ["task_events", "occurred_at", "2031-01-05T00:00:00.000Z"],
  ["task_projections", "task_id", "task-column-mismatch"],
  ["task_projections", "state", "queued"],
  ["task_projections", "revision", 17],
  ["task_projections", "updated_at", "2031-01-06T00:00:00.000Z"],
];

test("backup record audit rejects schema-invalid JSON and every duplicated column before target movement", async () => {
  await withFixture(async (workspace) => {
    const backupRoot = await createCompleteBackup(workspace);
    const targetRoot = join(workspace, "protected-target");
    const protectedRecord = assignmentRecord(
      "assignment-protected-target",
      "Invalid backups must not replace this record",
    );
    await createAssignmentRoot(targetRoot, protectedRecord);

    for (const [index, table] of recordTables.entries()) {
      const damagedRoot = join(workspace, `schema-invalid-${index}`);
      await cp(backupRoot, damagedRoot, { recursive: true });
      mutateDatabase(damagedRoot, (database) => {
        database.exec(
          `UPDATE ${table} SET record_json = json_set(record_json, '$.unexpected', 1)`,
        );
      });
      await assertBackupRejectedWithoutMove(damagedRoot, targetRoot, `${table} schema`);
    }

    for (const [index, [table, column, value]] of duplicatedColumns.entries()) {
      const damagedRoot = join(workspace, `column-invalid-${index}`);
      await cp(backupRoot, damagedRoot, { recursive: true });
      mutateDatabase(damagedRoot, (database) => {
        database.prepare(`UPDATE ${table} SET ${column} = ?`).run(value);
      });
      await assertBackupRejectedWithoutMove(damagedRoot, targetRoot, `${table}.${column}`);
    }

    const target = await openLocalStore(targetRoot);
    try {
      assert.deepEqual(target.assignments.get(protectedRecord.assignmentId), protectedRecord);
    } finally {
      target.close();
    }
  });
});

test("installed replacement stays usable when cleanup fails and a later open cleans retry state", async () => {
  await withFixture(async (workspace) => {
    const targetRoot = join(workspace, "roll-forward-target");
    const paths = restorePaths(targetRoot);
    const replacement = assignmentRecord("assignment-replacement", "Installed replacement");
    const prior = assignmentRecord("assignment-prior", "Prior active root");
    const writtenAfterRecovery = assignmentRecord(
      "assignment-after-recovery",
      "Write proves the recovered target stays usable",
    );
    await createAssignmentRoot(paths.next, replacement);
    await createAssignmentRoot(paths.previous, prior);
    await writeRestoreJournal(paths);

    const recovered = await openLocalStore(targetRoot, {
      failureInjector(point) {
        if (point === "restore_before_previous_cleanup") {
          throw new Error("injected cleanup failure after replacement validation");
        }
      },
    });
    try {
      assert.deepEqual(recovered.assignments.get(replacement.assignmentId), replacement);
      assert.equal(recovered.assignments.get(prior.assignmentId), null);
      recovered.assignments.put(writtenAfterRecovery);
    } finally {
      recovered.close();
    }

    assert.equal(await pathExists(paths.target), true);
    assert.equal(await pathExists(paths.next), false);
    assert.equal(await pathExists(paths.previous), true);
    assert.equal(await pathExists(paths.journal), true);

    const retried = await openLocalStore(targetRoot);
    try {
      assert.deepEqual(retried.assignments.get(replacement.assignmentId), replacement);
      assert.deepEqual(
        retried.assignments.get(writtenAfterRecovery.assignmentId),
        writtenAfterRecovery,
      );
      assert.equal(retried.assignments.get(prior.assignmentId), null);
    } finally {
      retried.close();
    }
    await assertNoRestoreState(targetRoot);
  });
});

test("invalid-target rollback retains quarantine cleanup state and does not block a later restore", async () => {
  await withFixture(async (workspace) => {
    const targetRoot = join(workspace, "rollback-target");
    const paths = restorePaths(targetRoot);
    const invalidActive = assignmentRecord("assignment-invalid-active", "Invalid active root");
    const prior = assignmentRecord("assignment-prior-valid", "Prior valid root");
    const writtenAfterRollback = assignmentRecord(
      "assignment-after-rollback",
      "Write proves the restored prior root stays usable",
    );
    await createAssignmentRoot(targetRoot, invalidActive);
    await createAssignmentRoot(paths.previous, prior);
    await writeRestoreJournal(paths);
    mutateDatabase(targetRoot, (database) => {
      database.exec("UPDATE assignments SET record_json = json_set(record_json, '$.unexpected', 1)");
    });

    const recovered = await openLocalStore(targetRoot, {
      failureInjector(point) {
        if (point === "restore_before_next_cleanup") {
          throw new Error("injected quarantine cleanup failure");
        }
      },
    });
    try {
      assert.deepEqual(recovered.assignments.get(prior.assignmentId), prior);
      assert.equal(recovered.assignments.get(invalidActive.assignmentId), null);
      recovered.assignments.put(writtenAfterRollback);
    } finally {
      recovered.close();
    }

    assert.equal(await pathExists(paths.target), true);
    assert.equal(await pathExists(paths.next), true);
    assert.equal(await pathExists(paths.previous), false);
    assert.equal(await pathExists(paths.journal), true);

    const cleaned = await openLocalStore(targetRoot);
    try {
      assert.deepEqual(cleaned.assignments.get(prior.assignmentId), prior);
      assert.deepEqual(cleaned.assignments.get(writtenAfterRollback.assignmentId), writtenAfterRollback);
    } finally {
      cleaned.close();
    }
    await assertNoRestoreState(targetRoot);

    const laterBackup = await createAssignmentBackup(
      workspace,
      "later",
      assignmentRecord("assignment-later-restore", "Later restore replacement"),
    );
    await restoreLocalStoreBackup(laterBackup.backupRoot, targetRoot);
    const restored = await openLocalStore(targetRoot);
    try {
      assert.deepEqual(restored.assignments.get(laterBackup.record.assignmentId), laterBackup.record);
      assert.equal(restored.assignments.get(prior.assignmentId), null);
    } finally {
      restored.close();
    }
    await assertNoRestoreState(targetRoot);
  });
});

async function createCompleteBackup(workspace) {
  const sourceRoot = join(workspace, "complete-source");
  const backupRoot = join(workspace, "complete-backup");
  const source = await openLocalStore(sourceRoot);
  try {
    source.assignments.put(assignment);
    source.permissionRules.put({
      schemaVersion: 1,
      ruleId: "rule-complete-pattern",
      scope: "pattern",
      courseId: assignment.courseId,
      patternId: "pattern-complete",
      mode: "attempt",
      updatedAt: timestamp,
    });
    source.runs.put(run);
    source.tasks.append({
      event: taskCreatedEvent,
      projection: task,
      expectedRevision: null,
    });
    await source.backup(backupRoot);
  } finally {
    source.close();
  }
  return backupRoot;
}

async function createAssignmentBackup(workspace, name, record) {
  const sourceRoot = join(workspace, `${name}-source`);
  const backupRoot = join(workspace, `${name}-backup`);
  const source = await openLocalStore(sourceRoot);
  try {
    source.assignments.put(record);
    await source.backup(backupRoot);
  } finally {
    source.close();
  }
  return { backupRoot, record };
}

async function createAssignmentRoot(root, record) {
  const store = await openLocalStore(root);
  try {
    store.assignments.put(record);
  } finally {
    store.close();
  }
}

function assignmentRecord(assignmentId, title) {
  return { ...assignment, assignmentId, title };
}

async function assertBackupRejectedWithoutMove(backupRoot, targetRoot, label) {
  await assert.rejects(
    validateLocalStoreBackup(backupRoot),
    (error) => error.code === "backup_invalid",
    `${label} should fail validation`,
  );
  await assert.rejects(
    restoreLocalStoreBackup(backupRoot, targetRoot),
    (error) => error.code === "backup_invalid",
    `${label} should fail restore before target movement`,
  );
  await assertNoRestoreState(targetRoot);
}

function mutateDatabase(root, mutate) {
  const database = new DatabaseSync(join(root, "studi.sqlite3"));
  try {
    mutate(database);
  } finally {
    database.close();
  }
}

function restorePaths(targetValue) {
  const target = resolve(targetValue);
  return {
    target,
    next: `${target}.studi-restore-next`,
    previous: `${target}.studi-restore-previous`,
    journal: `${target}.studi-restore-journal.json`,
  };
}

async function writeRestoreJournal(paths) {
  await writeFile(
    paths.journal,
    `${JSON.stringify({
      format: "studi-local-restore",
      target: paths.target,
      next: paths.next,
      previous: paths.previous,
    })}\n`,
    "utf8",
  );
}

async function assertNoRestoreState(targetRoot) {
  const paths = restorePaths(targetRoot);
  for (const path of [paths.next, paths.previous, paths.journal]) {
    assert.equal(await pathExists(path), false, `${path} should not remain`);
  }
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function withFixture(run) {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-wp02-cycle-03-independent-")));
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.match(basename(root), /^studi-wp02-cycle-03-independent-/);
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
