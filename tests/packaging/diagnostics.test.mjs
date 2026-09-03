import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildDiagnosticsSnapshot,
  writeDiagnosticsSnapshot,
} from "../../dist/electron/diagnostics.js";

test("diagnostic export keeps consented school facts and strips only secrets", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "studi-diagnostics-"));
  const destination = join(workspace, "diagnostics.json");
  const canaries = {
    account: "student@example.edu",
    path: "C:\\Users\\student\\AppData\\Roaming\\Studi",
    school: "https://school.example.edu/course/secret",
    token: "Bearer top-secret-value",
    task: "school-task-secret",
    distinctId: "user_clerk_secret",
  };
  const snapshot = buildDiagnosticsSnapshot({
    appVersion: "0.1.0",
    electronVersion: "37.10.3",
    chromeVersion: "138.0.0.0",
    nodeVersion: "22.21.1",
    platform: "win32",
    architecture: "x64",
    packaged: true,
    storage: {
      status: "ok",
      schemaVersion: 4,
      databasePath: join(canaries.path, "studi.sqlite3"),
      integrity: "ok",
    },
    telemetryConfigured: true,
    telemetryEnabled: true,
    replayEnabled: false,
    diagnostics: [{
      capturedAt: "2026-09-01T22:00:00.000Z",
      event: "studi_error",
      distinctId: canaries.distinctId,
      properties: {
        app_version: "0.1.0",
        boundary: "ipc",
        operation: "ipc_request",
        code: "operation_failed",
        task_id: canaries.task,
        email: canaries.account,
        school_root: canaries.school,
        debug_summary: `${canaries.account} ${canaries.path} ${canaries.school} ${canaries.token}`,
      },
    }],
    now: new Date("2026-09-01T22:01:00.000Z"),
  });

  await writeDiagnosticsSnapshot(destination, snapshot);
  const document = JSON.parse(await readFile(destination, "utf8"));
  const serialized = JSON.stringify(document);

  assert.deepEqual(document.storage, { status: "ok", schemaVersion: 4, integrity: "ok" });
  assert.equal(document.diagnostics[0].properties.task_id, canaries.task);
  assert.equal(document.diagnostics[0].properties.email, canaries.account);
  assert.equal(document.diagnostics[0].properties.school_root, canaries.school);
  assert.match(document.diagnostics[0].properties.debug_summary, /student@example\.edu/);
  assert.match(document.diagnostics[0].properties.debug_summary, /\[secret\]/);
  assert.doesNotMatch(serialized, /Bearer top-secret-value/i);
  assert.doesNotMatch(serialized, new RegExp(escapeRegExp(canaries.distinctId)));
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
