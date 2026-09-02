import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  openLocalStore,
  restoreLocalStoreBackup,
  validateLocalStoreBackup,
} from "../../dist/electron/storage/index.js";
import { assignment } from "../contracts/fixtures.mjs";

test("a pending migration first creates one validated and normally restorable backup", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "studi-migration-backup-"));
  const dataRoot = join(workspace, "studi-data");
  const backupRoot = join(workspace, "migration-backups");
  const source = await openLocalStore(dataRoot);
  source.assignments.put(assignment);
  source.close();

  const database = new DatabaseSync(join(dataRoot, "studi.sqlite3"));
  try {
    database.exec(`
      DROP TABLE submission_receipts;
      DROP TABLE notification_intents;
      DROP TABLE execution_attempts;
      DROP TABLE assignment_executions;
      DROP TABLE automation_schedules;
      DELETE FROM schema_migrations WHERE version = 4;
    `);
  } finally {
    database.close();
  }

  const migrated = await openLocalStore(dataRoot, {
    migrationBackup: { directory: backupRoot, appVersion: "0.1.0" },
  });
  assert.deepEqual(migrated.assignments.get(assignment.assignmentId), assignment);
  assert.equal(migrated.health().schemaVersion, 4);
  migrated.close();

  const backupNames = await readdir(backupRoot);
  assert.deepEqual(backupNames, ["pre-migration-v3-to-v4-app-0.1.0"]);
  const backup = join(backupRoot, backupNames[0]);
  assert.equal((await validateLocalStoreBackup(backup)).schemaVersion, 4);
  assert.deepEqual(JSON.parse(await readFile(join(backup, "backup.json"), "utf8")).migration, {
    appVersion: "0.1.0",
    fromSchemaVersion: 3,
    toSchemaVersion: 4,
  });

  const restoredRoot = join(workspace, "restored-data");
  await restoreLocalStoreBackup(backup, restoredRoot);
  const restored = await openLocalStore(restoredRoot);
  assert.deepEqual(restored.assignments.get(assignment.assignmentId), assignment);
  restored.close();
});
