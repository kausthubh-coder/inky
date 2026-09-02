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

const indexedColumnMutations = [
  ["assignments", "UPDATE assignments SET course_id = 'course-index-mismatch'"],
  [
    "permission_rules",
    "UPDATE permission_rules SET scope = 'course', course_id = 'course-index-mismatch'",
  ],
  ["runs", "UPDATE runs SET state = 'running'"],
  ["task_events", "UPDATE task_events SET run_id = 'run-index-mismatch'"],
  ["task_projections", "UPDATE task_projections SET revision = 9"],
];

test("backup validation parses every canonical record through its WP-01 schema", async () => {
  await withFixture(async (workspace) => {
    const backupRoot = await createCompleteBackup(workspace);
    const targetRoot = await createProtectedTarget(workspace);

    for (const [index, table] of recordTables.entries()) {
      const damagedRoot = join(workspace, `schema-invalid-${index}`);
      await cp(backupRoot, damagedRoot, { recursive: true });
      mutateDatabase(damagedRoot, `UPDATE ${table} SET record_json = '{"schemaVersion":1}'`);
      await assertRejectedBeforeTargetMove(damagedRoot, targetRoot, `${table} schema`);
    }

    const target = await openLocalStore(targetRoot);
    try {
      assert.deepEqual(target.assignments.get("assignment-target-only"), {
        ...assignment,
        assignmentId: "assignment-target-only",
        title: "Target record must survive invalid backups",
      });
    } finally {
      target.close();
    }
  });
});

test("backup validation rejects query columns that disagree with valid canonical JSON", async () => {
  await withFixture(async (workspace) => {
    const backupRoot = await createCompleteBackup(workspace);
    const targetRoot = await createProtectedTarget(workspace);

    for (const [index, [table, sql]] of indexedColumnMutations.entries()) {
      const damagedRoot = join(workspace, `column-mismatch-${index}`);
      await cp(backupRoot, damagedRoot, { recursive: true });
      mutateDatabase(damagedRoot, sql);
      await assertRejectedBeforeTargetMove(damagedRoot, targetRoot, `${table} columns`);
    }

    const target = await openLocalStore(targetRoot);
    try {
      assert.equal(target.assignments.get("assignment-target-only")?.title,
        "Target record must survive invalid backups");
    } finally {
      target.close();
    }
  });
});

test("roll-forward cleanup failure keeps the installed target usable and retryable", async () => {
  await withFixture(async (workspace) => {
    const target = join(workspace, "recover-active");
    const paths = restorePaths(target);
    const replacement = {
      ...assignment,
      assignmentId: "assignment-replacement",
      title: "Installed replacement",
    };
    const prior = {
      ...assignment,
      assignmentId: "assignment-prior",
      title: "Previous active root",
    };
    await createAssignmentRoot(paths.next, replacement);
    await createAssignmentRoot(paths.previous, prior);
    await writeRestoreJournal(paths);

    const recovered = await openLocalStore(target, {
      failureInjector(point) {
        if (point === "restore_before_previous_cleanup") {
          throw new Error("injected previous-root cleanup failure");
        }
      },
    });
    try {
      assert.deepEqual(recovered.assignments.get(replacement.assignmentId), replacement);
      assert.equal(recovered.assignments.get(prior.assignmentId), null);
    } finally {
      recovered.close();
    }

    assert.equal(await pathExists(paths.target), true);
    assert.equal(await pathExists(paths.next), false);
    assert.equal(await pathExists(paths.previous), true);
    assert.equal(await pathExists(paths.journal), true);

    const retried = await openLocalStore(target);
    try {
      assert.deepEqual(retried.assignments.get(replacement.assignmentId), replacement);
      assert.equal(retried.assignments.get(prior.assignmentId), null);
    } finally {
      retried.close();
    }
    await assertNoRestoreState(target);
  });
});

test("invalid active-root rollback removes its quarantined sibling before the journal", async () => {
  await withFixture(async (workspace) => {
    const target = join(workspace, "rollback-active");
    const paths = restorePaths(target);
    const invalidActive = {
      ...assignment,
      assignmentId: "assignment-invalid-active",
      title: "Invalid active root",
    };
    const prior = {
      ...assignment,
      assignmentId: "assignment-restored-prior",
      title: "Restored prior root",
    };
    await createAssignmentRoot(target, invalidActive);
    await createAssignmentRoot(paths.previous, prior);
    await writeRestoreJournal(paths);
    mutateDatabase(target, "UPDATE assignments SET record_json = '{\"schemaVersion\":1}'");

    const recovered = await openLocalStore(target);
    try {
      assert.deepEqual(recovered.assignments.get(prior.assignmentId), prior);
      assert.equal(recovered.assignments.get(invalidActive.assignmentId), null);
    } finally {
      recovered.close();
    }
    await assertNoRestoreState(target);
  });
});

async function createCompleteBackup(workspace) {
  const sourceRoot = join(workspace, "complete-source");
  const backupRoot = join(workspace, "complete-backup");
  const source = await openLocalStore(sourceRoot);
  source.assignments.put(assignment);
  source.permissionRules.put({
    schemaVersion: 1,
    ruleId: "rule-backup-validation",
    scope: "global",
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
  source.close();
  return backupRoot;
}

async function createProtectedTarget(workspace) {
  const targetRoot = join(workspace, "protected-target");
  await createAssignmentRoot(targetRoot, {
    ...assignment,
    assignmentId: "assignment-target-only",
    title: "Target record must survive invalid backups",
  });
  return targetRoot;
}

async function createAssignmentRoot(root, record) {
  const store = await openLocalStore(root);
  store.assignments.put(record);
  store.close();
}

async function assertRejectedBeforeTargetMove(backupRoot, targetRoot, label) {
  await assert.rejects(
    validateLocalStoreBackup(backupRoot),
    (error) => error.code === "backup_invalid",
    `${label} should fail backup validation`,
  );
  await assert.rejects(
    restoreLocalStoreBackup(backupRoot, targetRoot),
    (error) => error.code === "backup_invalid",
    `${label} should fail before restore`,
  );
  await assertNoRestoreState(targetRoot);
}

function mutateDatabase(root, sql) {
  const database = new DatabaseSync(join(root, "studi.sqlite3"));
  try {
    database.exec(sql);
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

async function assertNoRestoreState(target) {
  const paths = restorePaths(target);
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
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-wp02-cycle-03-")));
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.match(basename(root), /^studi-wp02-cycle-03-/);
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
