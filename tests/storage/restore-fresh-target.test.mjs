import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  openLocalStore,
  restoreLocalStoreBackup,
} from "../../dist/electron/storage/index.js";
import { assignment, timestamp } from "../contracts/fixtures.mjs";

const storageModuleUrl = new URL("../../dist/electron/storage/index.js", import.meta.url).href;

test("fresh-target restore crashes discard incomplete state and allow a complete retry", async () => {
  await withFixture(async (workspace) => {
    const sourceRoot = join(workspace, "source");
    const backupRoot = join(workspace, "backup");
    const source = await openLocalStore(sourceRoot);
    source.assignments.put(assignment);
    await source.artifacts.write(preferenceArtifact("replacement artifact survives retry"));
    await source.backup(backupRoot);
    source.close();

    for (const [point, exitCode, stageExpected] of [
      ["restore_after_journal_publish", 101, false],
      ["restore_during_staging_population", 102, true],
    ]) {
      const targetRoot = join(workspace, `fresh-target-${exitCode}`);
      const paths = restorePaths(targetRoot);
      assert.equal(await pathExists(targetRoot), false);

      assert.deepEqual(await interruptRestore(backupRoot, targetRoot, point, exitCode), {
        code: exitCode,
        signal: null,
      });
      assert.deepEqual(JSON.parse(await readFile(paths.journal, "utf8")), {
        format: "studi-local-restore",
        target: resolve(targetRoot),
        next: paths.next,
        previous: paths.previous,
        targetExistedAtStart: false,
      });
      assert.equal(await pathExists(targetRoot), false);
      assert.equal(await pathExists(paths.next), stageExpected);
      assert.equal(await pathExists(paths.previous), false);
      assert.equal(await pathExists(paths.journalTemporary), false);
      if (stageExpected) {
        assert.equal(await pathExists(join(paths.next, "studi.sqlite3")), true);
        assert.equal(await pathExists(join(paths.next, "artifacts")), false);
      }

      for (let openIndex = 0; openIndex < 2; openIndex += 1) {
        const fresh = await openLocalStore(targetRoot);
        assert.equal(fresh.assignments.get(assignment.assignmentId), null);
        fresh.close();
        await assertNoRestoreState(targetRoot);
      }

      await restoreLocalStoreBackup(backupRoot, targetRoot);
      const restored = await openLocalStore(targetRoot);
      assert.deepEqual(restored.assignments.get(assignment.assignmentId), assignment);
      assert.equal(
        (await restored.artifacts.read("preference", "student-preferences")).content,
        "replacement artifact survives retry",
      );
      restored.close();
      await assertNoRestoreState(targetRoot);
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
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-wp02-cycle-05-")));
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.match(basename(root), /^studi-wp02-cycle-05-/);
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
