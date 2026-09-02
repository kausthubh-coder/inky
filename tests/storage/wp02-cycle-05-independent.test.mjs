import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  openLocalStore,
  restoreLocalStoreBackup,
} from "../../dist/electron/storage/index.js";
import { assignment, timestamp } from "../contracts/fixtures.mjs";

const storageModuleUrl = new URL("../../dist/electron/storage/index.js", import.meta.url).href;

test("fresh-target crash cleanup removes exact restore state and preserves neighboring paths", async () => {
  await withFixture(async (workspace) => {
    const sourceRoot = join(workspace, "source");
    const backupRoot = join(workspace, "backup");
    const source = await openLocalStore(sourceRoot);
    source.assignments.put(assignment);
    await source.artifacts.write(preferenceArtifact("complete artifact from backup"));
    await source.backup(backupRoot);
    source.close();

    for (const [point, exitCode, expectsPartialStage] of [
      ["restore_after_journal_publish", 111, false],
      ["restore_during_staging_population", 112, true],
    ]) {
      const targetRoot = join(workspace, `fresh-${exitCode}`);
      const paths = restorePaths(targetRoot);

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
      assert.equal(await pathExists(paths.next), expectsPartialStage);
      assert.equal(await pathExists(paths.previous), false);
      assert.equal(await pathExists(paths.journalTemporary), false);
      if (expectsPartialStage) {
        assert.equal(await pathExists(join(paths.next, "studi.sqlite3")), true);
        assert.equal(await pathExists(join(paths.next, "artifacts")), false);
      }

      const neighbors = Object.values(paths).map((path) => `${path}.not-owned`);
      for (const neighbor of neighbors) {
        await writeFile(neighbor, `preserve ${basename(neighbor)}`, "utf8");
      }

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const recovered = await openLocalStore(targetRoot);
        assert.equal(recovered.assignments.get(assignment.assignmentId), null);
        assert.equal(
          await recovered.artifacts.read("preference", "student-preferences"),
          null,
        );
        recovered.close();
        await assertNoRestoreState(targetRoot);
        await assertNeighborsRemain(neighbors);
      }

      await restoreLocalStoreBackup(backupRoot, targetRoot);
      const restored = await openLocalStore(targetRoot);
      assert.deepEqual(restored.assignments.get(assignment.assignmentId), assignment);
      assert.equal(
        (await restored.artifacts.read("preference", "student-preferences")).content,
        "complete artifact from backup",
      );
      restored.close();
      await assertNoRestoreState(targetRoot);
      await assertNeighborsRemain(neighbors);
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

async function assertNeighborsRemain(neighbors) {
  for (const neighbor of neighbors) {
    assert.equal(
      await readFile(neighbor, "utf8"),
      `preserve ${basename(neighbor)}`,
      `${neighbor} should remain byte-identical`,
    );
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
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-wp02-cycle-05-independent-")));
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.match(basename(root), /^studi-wp02-cycle-05-independent-/);
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
