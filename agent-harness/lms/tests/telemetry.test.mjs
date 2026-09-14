import assert from "node:assert/strict";
import { test } from "node:test";
import {
  telemetryBatch,
  exportTelemetry,
} from "../../../.studi-lms/build/telemetry.mjs";
const input = {
  runId: "test-run",
  scenarioId: "smoke",
  scenarioVersion: 1,
  events: [
    {
      sequence: 1,
      type: "draft_saved",
      at: "2026-09-13T16:00:00Z",
      activityId: "observation",
      detail: {
        answer: "private-canary",
        origin: "private-school.example",
        csrf: "secret-canary",
      },
    },
  ],
};
test("export retains correlation but excludes private details and uses stable event IDs", async () => {
  const batch = telemetryBatch(input);
  assert.doesNotMatch(
    JSON.stringify(batch),
    /private-canary|private-school|secret-canary/,
  );
  assert.equal(batch[0].properties.lms_run_id, input.runId);
  assert.equal(batch[0].uuid, telemetryBatch(input)[0].uuid);
  let received;
  const result = await exportTelemetry(input, {
    developmentProjectToken: "phc_test-only",
    fetch: async (url, options) => {
      received = { url, body: JSON.parse(options.body) };
      return new Response("{}", { status: 200 });
    },
  });
  assert.equal(result.exported, 1);
  assert.equal(received.url, "https://us.i.posthog.com/batch/");
  assert.equal(received.body.batch[0].properties.environment, "fake-lms");
});
test("missing config and delivery failure are explicit and do not mutate local events", async () => {
  const original = structuredClone(input);
  await assert.rejects(
    exportTelemetry(input, { developmentProjectToken: "" }),
    /development project/,
  );
  await assert.rejects(
    exportTelemetry(input, {
      developmentProjectToken: "phc_test-only",
      fetch: async () => new Response("unavailable", { status: 503 }),
    }),
    /local journal remains/,
  );
  assert.deepEqual(input, original);
});
