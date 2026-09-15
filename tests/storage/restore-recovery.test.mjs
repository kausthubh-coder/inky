import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
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
import {
  assignment,
  task,
  taskCreatedEvent,
  timestamp,
} from "../contracts/fixtures.mjs";

const storageModuleUrl = new URL("../../dist/electron/storage/index.js", import.meta.url).href;

test("pre-install restore crashes recover cleanly and do not block a later restore", async () => {
  await withFixture(async (workspace) => {
    const sourceRoot = join(workspace, "restore-source");
    const backupRoot = join(workspace, "restore-backup");
    const source = await openLocalStore(sourceRoot);
    source.assignments.put(assignment);
    await source.artifacts.write(preferenceArtifact("replacement artifact"));
    await source.backup(backupRoot);
    source.close();

    const temporaryTarget = join(workspace, "active-journal-temporary");
    const temporaryAssignment = {
      ...assignment,
      assignmentId: "assignment-journal-temporary",
    };
    const temporaryStore = await openLocalStore(temporaryTarget);
    temporaryStore.assignments.put(temporaryAssignment);
    temporaryStore.close();
    const temporaryPaths = restorePaths(temporaryTarget);
    const unownedNeighbor = `${temporaryPaths.journalTemporary}.not-owned`;
    await writeFile(temporaryPaths.journalTemporary, "{partial journal", "utf8");
    await writeFile(unownedNeighbor, "keep", "utf8");
    const temporaryRecovered = await openLocalStore(temporaryTarget);
    assert.deepEqual(
      temporaryRecovered.assignments.get(temporaryAssignment.assignmentId),
      temporaryAssignment,
    );
    temporaryRecovered.close();
    assert.equal(await pathExists(temporaryPaths.journalTemporary), false);
    assert.equal(await pathExists(unownedNeighbor), true);

    const crashPoints = [
      ["restore_after_journal_publish", false, 81],
      ["restore_during_staging_population", true, 82],
      ["restore_after_staging_population", true, 83],
    ];
    for (const [point, stageExpected, exitCode] of crashPoints) {
      const targetRoot = join(workspace, `active-${exitCode}`);
      const activeAssignment = {
        ...assignment,
        assignmentId: `assignment-active-${exitCode}`,
        title: `Active before ${point}`,
      };
      const target = await openLocalStore(targetRoot);
      target.assignments.put(activeAssignment);
      target.close();

      assert.deepEqual(await runInterruptedRestore(backupRoot, targetRoot, point, exitCode), {
        code: exitCode,
        signal: null,
      });
      const paths = restorePaths(targetRoot);
      assert.deepEqual(JSON.parse(await readFile(paths.journal, "utf8")), {
        format: "studi-local-restore",
        target: resolve(targetRoot),
        next: paths.next,
        previous: paths.previous,
      });
      assert.equal(await pathExists(paths.journalTemporary), false);
      assert.equal(await pathExists(paths.next), stageExpected);

      for (let openIndex = 0; openIndex < 2; openIndex += 1) {
        const recovered = await openLocalStore(targetRoot);
        assert.deepEqual(recovered.assignments.get(activeAssignment.assignmentId), activeAssignment);
        assert.equal(recovered.assignments.get(assignment.assignmentId), null);
        recovered.close();
        await assertNoRestoreState(targetRoot);
      }

      await restoreLocalStoreBackup(backupRoot, targetRoot);
      const restored = await openLocalStore(targetRoot);
      assert.deepEqual(restored.assignments.get(assignment.assignmentId), assignment);
      assert.equal(restored.assignments.get(activeAssignment.assignmentId), null);
      restored.close();
      await assertNoRestoreState(targetRoot);
    }
  });
});

test("backup validation replays task histories and checks stored projections", async () => {
  await withFixture(async (workspace) => {
    const sourceRoot = join(workspace, "history-source");
    const backupRoot = join(workspace, "history-backup");
    const targetRoot = join(workspace, "history-target");
    const source = await openLocalStore(sourceRoot);
    source.tasks.append({ event: taskCreatedEvent, projection: task, expectedRevision: null });
    const transition = transitionTask(task, {
      type: "transition",
      to: "queued",
      eventId: "event-cycle-04-transition",
      runId: "run-cycle-04-transition",
      sequence: 1,
      occurredAt: "2026-08-30T12:35:56.000Z",
    });
    assert.equal(transition.ok, true);
    source.tasks.append({
      event: transition.event,
      projection: transition.task,
      expectedRevision: task.revision,
    });
    await source.backup(backupRoot);
    source.close();

    const protectedAssignment = {
      ...assignment,
      assignmentId: "assignment-history-target",
      title: "Target survives invalid task history",
    };
    const target = await openLocalStore(targetRoot);
    target.assignments.put(protectedAssignment);
    target.close();

    const corruptions = [
      [
        "origin-sequence",
        `UPDATE task_events
         SET sequence = 5, record_json = json_set(record_json, '$.sequence', 5)
         WHERE type = 'task_created'`,
      ],
      ["missing-origin", "DELETE FROM task_events WHERE type = 'task_created'"],
      [
        "invalid-transition",
        `UPDATE task_events
         SET record_json = json_set(
           record_json, '$.payload.from', 'queued', '$.payload.to', 'working'
         )
         WHERE type = 'task_state_changed'`,
      ],
      [
        "projection-disagreement",
        `UPDATE task_projections
         SET state = 'working', revision = 2,
             record_json = json_set(record_json, '$.state', 'working', '$.revision', 2)`,
      ],
    ];

    for (const [name, sql] of corruptions) {
      const damagedRoot = join(workspace, `history-${name}`);
      await cp(backupRoot, damagedRoot, { recursive: true });
      mutateDatabase(damagedRoot, sql);
      await assert.rejects(
        validateLocalStoreBackup(damagedRoot),
        (error) => error.code === "backup_invalid",
      );
      await assert.rejects(
        restoreLocalStoreBackup(damagedRoot, targetRoot),
        (error) => error.code === "backup_invalid",
      );
      await assertNoRestoreState(targetRoot);
    }

    const unchanged = await openLocalStore(targetRoot);
    assert.deepEqual(unchanged.assignments.get(protectedAssignment.assignmentId), protectedAssignment);
    unchanged.close();
  });
});

test("artifact validation and copying reject a kind-directory junction by lstat", async (context) => {
  await withFixture(async (workspace) => {
    const sourceRoot = join(workspace, "artifact-source");
    const validBackup = join(workspace, "artifact-valid-backup");
    const copyDestination = join(workspace, "artifact-copy-rejected");
    const source = await openLocalStore(sourceRoot);
    await source.artifacts.write(preferenceArtifact("owned preference"));
    await source.backup(validBackup);

    const external = join(workspace, "external-preferences");
    await mkdir(external);
    await cp(
      join(sourceRoot, "artifacts", "preferences", "student-preferences.md"),
      join(external, "student-preferences.md"),
    );
    const sourceKind = join(sourceRoot, "artifacts", "preferences");
    await rm(sourceKind, { recursive: true });
    try {
      await symlink(external, sourceKind, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EACCES", "ENOSYS", "EPERM"].includes(error.code)) {
        source.close();
        context.skip(`Directory links are unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    assert.equal((await lstat(sourceKind)).isSymbolicLink(), true);
    await assert.rejects(source.backup(copyDestination), (error) => error.code === "backup_invalid");
    assert.equal(await pathExists(copyDestination), false);
    source.close();

    const linkedBackup = join(workspace, "artifact-linked-backup");
    await cp(validBackup, linkedBackup, { recursive: true });
    const linkedKind = join(linkedBackup, "artifacts", "preferences");
    await rm(linkedKind, { recursive: true });
    await symlink(external, linkedKind, process.platform === "win32" ? "junction" : "dir");
    assert.equal((await lstat(linkedKind)).isSymbolicLink(), true);
    await assert.rejects(
      validateLocalStoreBackup(linkedBackup),
      (error) => error.code === "backup_invalid",
    );
  });
});

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

async function runInterruptedRestore(backupRoot, targetRoot, requestedPoint, exitCode) {
  const script = `
    import { restoreLocalStoreBackup } from ${JSON.stringify(storageModuleUrl)};
    await restoreLocalStoreBackup(process.argv[1], process.argv[2], {
      failureInjector(point) {
        if (point === process.argv[3]) process.exit(Number(process.argv[4]));
      },
    });
  `;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      script,
      backupRoot,
      targetRoot,
      requestedPoint,
      String(exitCode),
    ],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const result = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("close", (code, signal) => resolveExit({ code, signal }));
  });
  assert.equal(stderr, "");
  return result;
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
    next: `${target}.studi-restore-next`,
    previous: `${target}.studi-restore-previous`,
    journal: `${target}.studi-restore-journal.json`,
    journalTemporary: `${target}.studi-restore-journal.json.tmp`,
  };
}

async function assertNoRestoreState(target) {
  const paths = restorePaths(target);
  for (const path of Object.values(paths)) {
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
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-wp02-cycle-04-")));
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.match(basename(root), /^studi-wp02-cycle-04-/);
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
