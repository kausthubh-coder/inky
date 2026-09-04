import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
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

const storageModuleUrl = new URL("../../dist/electron/storage/index.js", import.meta.url).href;

test("fresh migration, known repository queries, and reopen keep validated records", async () => {
  await withFixture(async (root) => {
    const store = await openLocalStore(root);
    assert.deepEqual(store.health(), {
      status: "ok",
      schemaVersion: 6,
      databasePath: join(root, "studi.sqlite3"),
      integrity: "ok",
    });

    store.assignments.put(assignment);
    store.permissionRules.put(globalPermissionRule());
    store.runs.put(run);
    store.tasks.append({
      event: taskCreatedEvent(),
      projection: task,
      expectedRevision: null,
    });

    assert.deepEqual(store.assignments.get(assignment.assignmentId), assignment);
    assert.deepEqual(store.assignments.listByCourse(assignment.courseId), [assignment]);
    assert.deepEqual(store.assignments.listDueThrough(assignment.dueAt), [assignment]);
    assert.deepEqual(store.permissionRules.listByScope("global"), [globalPermissionRule()]);
    assert.deepEqual(store.runs.listByTask(task.taskId), [run]);
    assert.deepEqual(store.runs.listByState("queued"), [run]);
    assert.deepEqual(store.tasks.listByState("discovered"), [task]);
    store.close();

    const reopened = await openLocalStore(root);
    assert.deepEqual(reopened.assignments.get(assignment.assignmentId), assignment);
    assert.deepEqual(reopened.tasks.get(task.taskId), task);
    reopened.close();

    const raw = new DatabaseSync(join(root, "studi.sqlite3"));
    try {
      assert.deepEqual(
        raw.prepare("SELECT version FROM schema_migrations").all().map((row) => ({ ...row })),
        [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }],
      );
      raw.prepare("UPDATE assignments SET record_json = ? WHERE assignment_id = ?").run(
        JSON.stringify({ schemaVersion: 1 }),
        assignment.assignmentId,
      );
    } finally {
      raw.close();
    }
    const invalidRecordStore = await openLocalStore(root);
    assert.throws(
      () => invalidRecordStore.assignments.get(assignment.assignmentId),
      (error) => error.code === "record_validation_failed",
    );
    invalidRecordStore.close();
  });
});

test("migration rollback, too-new schema, and corruption fail closed", async () => {
  await withFixture(async (root) => {
    await assert.rejects(
      openLocalStore(root, {
        failureInjector(point) {
          if (point === "migration_before_version") {
            throw new Error("injected migration stop");
          }
        },
      }),
      (error) => error.code === "migration_failed",
    );

    const rolledBack = new DatabaseSync(join(root, "studi.sqlite3"));
    try {
      assert.deepEqual(
        rolledBack.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all(),
        [],
      );
    } finally {
      rolledBack.close();
    }

    const recovered = await openLocalStore(root);
    recovered.close();
  });

  await withFixture(async (root) => {
    await mkdir(root, { recursive: true });
    const databasePath = join(root, "studi.sqlite3");
    const tooNew = new DatabaseSync(databasePath);
    tooNew.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    tooNew.prepare("INSERT INTO schema_migrations VALUES (?, ?)").run(7, timestamp);
    tooNew.close();
    const before = await readFile(databasePath);
    await assert.rejects(openLocalStore(root), (error) => error.code === "schema_too_new");
    assert.deepEqual(await readFile(databasePath), before);
  });

  await withFixture(async (root) => {
    await mkdir(root, { recursive: true });
    const databasePath = join(root, "studi.sqlite3");
    const corruptBytes = Buffer.from("this is not sqlite\n", "utf8");
    await writeFile(databasePath, corruptBytes);
    await assert.rejects(openLocalStore(root), (error) => error.code === "corrupt_database");
    assert.deepEqual(await readFile(databasePath), corruptBytes);
  });
});

test("task append is atomic and replay reconstructs only valid streams", async () => {
  await withFixture(async (root) => {
    let failProjection = false;
    const store = await openLocalStore(root, {
      failureInjector(point) {
        if (point === "task_before_projection" && failProjection) {
          throw new Error("injected projection stop");
        }
      },
    });
    store.tasks.append({ event: taskCreatedEvent(), projection: task, expectedRevision: null });

    const transition = transitionTask(task, {
      type: "transition",
      to: "queued",
      eventId: "event-transition-storage",
      runId: "run-transition-storage",
      sequence: 1,
      occurredAt: "2026-08-30T12:35:56.000Z",
    });
    assert.equal(transition.ok, true);
    failProjection = true;
    assert.throws(
      () =>
        store.tasks.append({
          event: transition.event,
          projection: transition.task,
          expectedRevision: 0,
        }),
      (error) => error.code === "invalid_event_stream",
    );
    assert.deepEqual(store.tasks.get(task.taskId), task);
    assert.equal(store.tasks.listEvents(task.taskId).length, 1);

    failProjection = false;
    store.tasks.append({
      event: transition.event,
      projection: transition.task,
      expectedRevision: 0,
    });
    store.tasks.deleteProjection(task.taskId);
    assert.equal(store.tasks.get(task.taskId), null);
    assert.deepEqual(store.tasks.rebuildProjection(task.taskId), transition.task);
    assert.deepEqual(store.tasks.get(task.taskId), transition.task);
    store.tasks.deleteProjection(task.taskId);
    store.close();

    const database = new DatabaseSync(join(root, "studi.sqlite3"));
    try {
      const row = database
        .prepare("SELECT record_json FROM task_events WHERE sequence = 1")
        .get();
      const invalid = JSON.parse(row.record_json);
      invalid.payload.from = "queued";
      invalid.payload.to = "working";
      database
        .prepare("UPDATE task_events SET record_json = ? WHERE sequence = 1")
        .run(JSON.stringify(invalid));
    } finally {
      database.close();
    }

    const invalidStore = await openLocalStore(root);
    assert.throws(
      () => invalidStore.tasks.rebuildProjection(task.taskId),
      (error) => error.code === "invalid_event_stream",
    );
    assert.equal(invalidStore.tasks.get(task.taskId), null);
    invalidStore.close();
  });
});

test("artifact writes reject traversal, preserve the prior file on failure, and diagnose frontmatter", async () => {
  await withFixture(async (root) => {
    let failRename = false;
    const store = await openLocalStore(root, {
      failureInjector(point) {
        if (point === "artifact_before_rename" && failRename) {
          throw new Error("injected rename stop");
        }
      },
    });
    const original = preferenceArtifact("Original preference");
    await store.artifacts.write(original);
    assert.deepEqual(await store.artifacts.read("preference", "student-preferences"), original);

    await assert.rejects(
      store.artifacts.write({
        ...original,
        frontmatter: { ...original.frontmatter, artifactId: "../escape" },
      }),
      (error) => error.code === "invalid_artifact_path",
    );

    failRename = true;
    await assert.rejects(
      store.artifacts.write(preferenceArtifact("Replacement that must not commit")),
      (error) => error.code === "artifact_write_failed",
    );
    assert.deepEqual(await store.artifacts.read("preference", "student-preferences"), original);
    const entries = await readdir(join(root, "artifacts", "preferences"));
    assert.deepEqual(entries, ["student-preferences.md"]);

    const malformedPath = join(root, "artifacts", "preferences", "broken.md");
    await writeFile(malformedPath, "---\nkind: [not valid\n---\nbody", "utf8");
    await assert.rejects(
      store.artifacts.read("preference", "broken"),
      (error) =>
        error.code === "malformed_frontmatter" && error.message.includes("broken.md"),
    );
    store.close();
  });
});

test("backup validates before restore and a hard interruption recovers on the next open", async () => {
  await withFixture(async (workspace) => {
    const active = join(workspace, "active");
    const backupDirectory = join(workspace, "backup-one");
    const corruptBackup = join(workspace, "backup-corrupt");
    const store = await openLocalStore(active);
    store.assignments.put(assignment);
    await store.artifacts.write(preferenceArtifact("Backed up preference"));
    const backupResult = await store.backup(backupDirectory);
    assert.equal(backupResult.schemaVersion, 6);
    assert.equal(backupResult.artifactCount, 1);
    assert.deepEqual(await validateLocalStoreBackup(backupDirectory), backupResult);

    const laterAssignment = {
      ...assignment,
      assignmentId: "assignment-after-backup",
      title: "Created after backup",
    };
    store.assignments.put(laterAssignment);
    store.close();

    await cp(backupDirectory, corruptBackup, { recursive: true });
    await writeFile(join(corruptBackup, "studi.sqlite3"), "broken backup");
    await assert.rejects(
      restoreLocalStoreBackup(corruptBackup, active),
      (error) => error.code === "backup_invalid",
    );
    const unchanged = await openLocalStore(active);
    assert.deepEqual(unchanged.assignments.get(laterAssignment.assignmentId), laterAssignment);
    unchanged.close();

    const freshRestore = join(workspace, "fresh-restore");
    await restoreLocalStoreBackup(backupDirectory, freshRestore);
    const fresh = await openLocalStore(freshRestore);
    assert.deepEqual(fresh.assignments.get(assignment.assignmentId), assignment);
    assert.equal(
      (await fresh.artifacts.read("preference", "student-preferences")).content,
      "Backed up preference",
    );
    fresh.close();

    const interrupted = await runInterruptedRestore(backupDirectory, active);
    assert.deepEqual(interrupted, { code: 73, signal: null });
    const recovered = await openLocalStore(active);
    assert.deepEqual(recovered.assignments.get(assignment.assignmentId), assignment);
    assert.equal(recovered.assignments.get(laterAssignment.assignmentId), null);
    assert.equal(
      (await recovered.artifacts.read("preference", "student-preferences")).content,
      "Backed up preference",
    );
    recovered.close();
    assert.equal(await exists(`${active}.studi-restore-next`), false);
    assert.equal(await exists(`${active}.studi-restore-previous`), false);
    assert.equal(await exists(`${active}.studi-restore-journal.json`), false);
  });
});

function taskCreatedEvent() {
  return {
    schemaVersion: 1,
    eventId: "event-task-created-storage",
    aggregateType: "task",
    aggregateId: task.taskId,
    runId: "run-task-created-storage",
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
    ruleId: "rule-storage-global",
    scope: "global",
    mode: "attempt",
    updatedAt: timestamp,
  };
}

function preferenceArtifact(content) {
  return {
    frontmatter: {
      schemaVersion: 1,
      kind: "preference",
      artifactId: "student-preferences",
      updatedAt: timestamp,
    },
    content,
  };
}

async function runInterruptedRestore(backupDirectory, active) {
  const script = `
    import { restoreLocalStoreBackup } from ${JSON.stringify(storageModuleUrl)};
    await restoreLocalStoreBackup(
      process.argv[1],
      process.argv[2],
      { failureInjector(point) { if (point === "restore_after_previous_move") process.exit(73); } },
    );
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script, backupDirectory, active], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const exit = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("close", (code, signal) => resolveExit({ code, signal }));
  });
  assert.equal(stderr, "");
  return exit;
}

async function withFixture(run) {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-wp02-storage-")));
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.match(basename(root), /^studi-wp02-storage-/);
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function exists(path) {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (error.code === "EISDIR" || error.code === "EPERM") {
      return true;
    }
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
