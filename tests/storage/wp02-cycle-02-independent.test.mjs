import assert from "node:assert/strict";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  openLocalStore,
  restoreLocalStoreBackup,
  validateLocalStoreBackup,
} from "../../dist/electron/storage/index.js";
import { assignment } from "../contracts/fixtures.mjs";

const schemaMutations = [
  {
    name: "required table",
    apply(database) {
      database.exec("DROP TABLE permission_rules");
    },
  },
  {
    name: "required column",
    apply(database) {
      database.exec("ALTER TABLE runs RENAME COLUMN state TO changed_state");
    },
  },
  {
    name: "named query index",
    apply(database) {
      database.exec("DROP INDEX task_projections_state");
    },
  },
  {
    name: "task sequence uniqueness",
    apply(database) {
      database.exec(`
        CREATE TABLE task_events_without_unique (
          event_id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          run_id TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          type TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          record_json TEXT NOT NULL CHECK (json_valid(record_json))
        );
        INSERT INTO task_events_without_unique
          SELECT event_id, task_id, run_id, sequence, type, occurred_at, record_json
          FROM task_events;
        DROP TABLE task_events;
        ALTER TABLE task_events_without_unique RENAME TO task_events;
      `);
    },
  },
];

test("backup rejection preserves active data for required schema-shape mutations", async () => {
  await withFixture(async (workspace) => {
    for (const [index, mutation] of schemaMutations.entries()) {
      const sourceRoot = join(workspace, `source-${index}`);
      const backupRoot = join(workspace, `backup-${index}`);
      const targetRoot = join(workspace, `target-${index}`);
      const targetOnly = {
        ...assignment,
        assignmentId: `assignment-target-${index}`,
        title: `Target record for ${mutation.name}`,
      };

      const source = await openLocalStore(sourceRoot);
      source.assignments.put(assignment);
      await source.backup(backupRoot);
      source.close();

      const target = await openLocalStore(targetRoot);
      target.assignments.put(targetOnly);
      target.close();

      const damaged = new DatabaseSync(join(backupRoot, "studi.sqlite3"));
      try {
        mutation.apply(damaged);
      } finally {
        damaged.close();
      }

      await assert.rejects(
        validateLocalStoreBackup(backupRoot),
        (error) => error.code === "backup_invalid",
        `${mutation.name} backup should fail validation`,
      );
      await assert.rejects(
        restoreLocalStoreBackup(backupRoot, targetRoot),
        (error) => error.code === "backup_invalid",
        `${mutation.name} backup should fail before restore`,
      );

      const reopened = await openLocalStore(targetRoot);
      try {
        assert.deepEqual(reopened.assignments.get(targetOnly.assignmentId), targetOnly);
      } finally {
        reopened.close();
      }
      await assertNoRestoreState(targetRoot);
    }
  });
});

test("live failure after the prior root moves rejects and leaves rollback state clean", async () => {
  await withFixture(async (workspace) => {
    const activeRoot = join(workspace, "active");
    const backupRoot = join(workspace, "backup");
    const active = await openLocalStore(activeRoot);
    active.assignments.put(assignment);
    await active.backup(backupRoot);
    const postBackup = {
      ...assignment,
      assignmentId: "assignment-after-cycle-two-backup",
      title: "Must survive a rejected live restore",
    };
    active.assignments.put(postBackup);
    active.close();

    await assert.rejects(
      restoreLocalStoreBackup(backupRoot, activeRoot, {
        failureInjector(point) {
          if (point === "restore_after_previous_move") {
            throw new Error("injected live restore failure after the prior root moved");
          }
        },
      }),
      (error) => {
        assert.equal(error.code, "restore_failed");
        assert.match(error.message, /without discarding the prior data root/);
        assert.notEqual(error.details.rollbackIncomplete, true);
        return true;
      },
    );

    const reopened = await openLocalStore(activeRoot);
    try {
      assert.deepEqual(reopened.assignments.get(assignment.assignmentId), assignment);
      assert.deepEqual(reopened.assignments.get(postBackup.assignmentId), postBackup);
    } finally {
      reopened.close();
    }
    await assertNoRestoreState(activeRoot);
  });
});

async function assertNoRestoreState(targetRoot) {
  for (const path of [
    `${targetRoot}.studi-restore-next`,
    `${targetRoot}.studi-restore-previous`,
    `${targetRoot}.studi-restore-journal.json`,
  ]) {
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
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-wp02-cycle-02-")));
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.match(basename(root), /^studi-wp02-cycle-02-/);
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
