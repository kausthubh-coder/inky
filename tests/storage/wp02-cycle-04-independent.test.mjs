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
import {
  TaskEventSchema,
  TaskSchema,
  transitionTask,
} from "../../dist/shared/index.js";
import {
  assignment,
  task,
  taskCreatedEvent,
  timestamp,
} from "../contracts/fixtures.mjs";

const storageModuleUrl = new URL("../../dist/electron/storage/index.js", import.meta.url).href;

test("published restore journals survive both pre-move crash windows and remain retryable", async () => {
  await withFixture(async (workspace) => {
    const sourceRoot = join(workspace, "crash-source");
    const backupRoot = join(workspace, "crash-backup");
    const source = await openLocalStore(sourceRoot);
    source.assignments.put(assignment);
    await source.backup(backupRoot);
    source.close();

    for (const [point, exitCode] of [
      ["restore_after_journal_publish", 91],
      ["restore_after_staging_population", 92],
    ]) {
      const targetRoot = join(workspace, `crash-target-${exitCode}`);
      const activeAssignment = {
        ...assignment,
        assignmentId: `assignment-active-${exitCode}`,
        title: `Active record for ${point}`,
      };
      const target = await openLocalStore(targetRoot);
      target.assignments.put(activeAssignment);
      target.close();

      assert.deepEqual(await interruptRestore(backupRoot, targetRoot, point, exitCode), {
        code: exitCode,
        signal: null,
      });

      const paths = restorePaths(targetRoot);
      const journal = JSON.parse(await readFile(paths.journal, "utf8"));
      assert.deepEqual(journal, {
        format: "studi-local-restore",
        target: resolve(targetRoot),
        next: paths.next,
        previous: paths.previous,
      });
      assert.equal(await pathExists(paths.journalTemporary), false);

      const recovered = await openLocalStore(targetRoot);
      assert.deepEqual(recovered.assignments.get(activeAssignment.assignmentId), activeAssignment);
      assert.equal(recovered.assignments.get(assignment.assignmentId), null);
      recovered.close();
      await assertNoRestoreState(targetRoot);

      await restoreLocalStoreBackup(backupRoot, targetRoot);
      const restored = await openLocalStore(targetRoot);
      assert.deepEqual(restored.assignments.get(assignment.assignmentId), assignment);
      assert.equal(restored.assignments.get(activeAssignment.assignmentId), null);
      restored.close();
      await assertNoRestoreState(targetRoot);
    }
  });
});

test("schema-valid task rows with an invalid stream or divergent projection are rejected before movement", async () => {
  await withFixture(async (workspace) => {
    const sourceRoot = join(workspace, "semantic-source");
    const backupRoot = join(workspace, "semantic-backup");
    const targetRoot = join(workspace, "semantic-target");
    const source = await openLocalStore(sourceRoot);
    source.tasks.append({ event: taskCreatedEvent, projection: task, expectedRevision: null });
    const queued = transitionTask(task, {
      type: "transition",
      to: "queued",
      eventId: "event-independent-semantic",
      runId: "run-independent-semantic",
      sequence: 1,
      occurredAt: "2026-08-30T12:36:56.000Z",
    });
    assert.equal(queued.ok, true);
    source.tasks.append({
      event: queued.event,
      projection: queued.task,
      expectedRevision: task.revision,
    });
    await source.backup(backupRoot);
    source.close();

    const protectedAssignment = {
      ...assignment,
      assignmentId: "assignment-semantic-target",
      title: "Must survive semantic rejection",
    };
    const target = await openLocalStore(targetRoot);
    target.assignments.put(protectedAssignment);
    target.close();

    const cases = [
      {
        name: "invalid-stream",
        sql: `UPDATE task_events
              SET record_json = json_set(
                record_json, '$.payload.from', 'queued', '$.payload.to', 'working'
              )
              WHERE type = 'task_state_changed'`,
        assertRowsAreValid(database) {
          const row = database
            .prepare("SELECT record_json FROM task_events WHERE type = 'task_state_changed'")
            .get();
          TaskEventSchema.parse(JSON.parse(row.record_json));
        },
      },
      {
        name: "divergent-projection",
        sql: `UPDATE task_projections
              SET state = 'working', revision = 2,
                  record_json = json_set(record_json, '$.state', 'working', '$.revision', 2)`,
        assertRowsAreValid(database) {
          const row = database.prepare("SELECT record_json FROM task_projections").get();
          TaskSchema.parse(JSON.parse(row.record_json));
        },
      },
    ];

    for (const current of cases) {
      const damagedRoot = join(workspace, `semantic-${current.name}`);
      await cp(backupRoot, damagedRoot, { recursive: true });
      const database = new DatabaseSync(join(damagedRoot, "studi.sqlite3"));
      try {
        database.exec(current.sql);
        current.assertRowsAreValid(database);
      } finally {
        database.close();
      }

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
    assert.deepEqual(
      unchanged.assignments.get(protectedAssignment.assignmentId),
      protectedAssignment,
    );
    unchanged.close();
  });
});

test("artifact links at root, kind, and child boundaries cannot copy, restore, or reach external files", async () => {
  await withFixture(async (workspace) => {
    const sourceRoot = join(workspace, "links-source");
    const validBackup = join(workspace, "links-valid-backup");
    const targetRoot = join(workspace, "links-target");
    const source = await openLocalStore(sourceRoot);
    await source.artifacts.write(preferenceArtifact("valid linked fixture"));
    await source.backup(validBackup);
    source.close();

    const target = await openLocalStore(targetRoot);
    target.assignments.put({
      ...assignment,
      assignmentId: "assignment-links-target",
      title: "Must survive linked backups",
    });
    await target.artifacts.write(preferenceArtifact("safe active artifact"));
    target.close();

    for (const level of ["root", "kind", "child"]) {
      const candidate = join(workspace, `links-candidate-${level}`);
      const external = join(workspace, `links-external-${level}`);
      await cp(validBackup, candidate, { recursive: true });
      await makeLinkedArtifactBoundary(candidate, external, level);
      const before = await externalPayload(external, level);

      const copySource = await openLocalStore(candidate);
      const copyDestination = join(workspace, `links-copy-${level}`);
      await assert.rejects(
        copySource.backup(copyDestination),
        (error) => error.code === "backup_invalid",
      );
      copySource.close();
      assert.equal(await pathExists(copyDestination), false);

      await assert.rejects(
        validateLocalStoreBackup(candidate),
        (error) => error.code === "backup_invalid",
      );
      await assert.rejects(
        restoreLocalStoreBackup(candidate, targetRoot),
        (error) => error.code === "backup_invalid",
      );
      await assertNoRestoreState(targetRoot);
      assert.equal(await externalPayload(external, level), before);
    }

    const safeTarget = await openLocalStore(targetRoot);
    await safeTarget.artifacts.write(preferenceArtifact("safe write after rejection"));
    assert.equal(
      (await safeTarget.artifacts.read("preference", "student-preferences")).content,
      "safe write after rejection",
    );
    safeTarget.close();

    for (const level of ["root", "kind", "child"]) {
      const external = join(workspace, `links-external-${level}`);
      assert.equal(await externalPayload(external, level), "valid linked fixture");
    }
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

async function makeLinkedArtifactBoundary(candidate, external, level) {
  const artifacts = join(candidate, "artifacts");
  const preferences = join(artifacts, "preferences");
  const artifact = join(preferences, "student-preferences.md");
  const linkType = process.platform === "win32" ? "junction" : "dir";

  if (level === "root") {
    await cp(artifacts, external, { recursive: true });
    await rm(artifacts, { recursive: true });
    await symlink(external, artifacts, linkType);
    return;
  }
  if (level === "kind") {
    await cp(preferences, external, { recursive: true });
    await rm(preferences, { recursive: true });
    await symlink(external, preferences, linkType);
    return;
  }

  await mkdir(external);
  await writeFile(join(external, "payload.txt"), "valid linked fixture", "utf8");
  await rm(artifact);
  await symlink(external, artifact, linkType);
}

async function externalPayload(external, level) {
  if (level === "root") {
    return artifactContent(join(external, "preferences", "student-preferences.md"));
  }
  if (level === "kind") {
    return artifactContent(join(external, "student-preferences.md"));
  }
  return readFile(join(external, "payload.txt"), "utf8");
}

async function artifactContent(path) {
  const source = await readFile(path, "utf8");
  return source.slice(source.indexOf("\n---\n", 4) + 5);
}

async function interruptRestore(backupRoot, targetRoot, requestedPoint, exitCode) {
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
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
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
  for (const path of Object.values(restorePaths(target))) {
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
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-wp02-cycle-04-independent-")));
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.match(basename(root), /^studi-wp02-cycle-04-independent-/);
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
