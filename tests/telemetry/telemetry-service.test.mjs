import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TelemetryService } from "../../dist/electron/telemetry/service.js";

function mockClient() {
  const captures = [];
  const shutdownCalls = [];
  return {
    captures,
    shutdownCalls,
    capture(message) { captures.push(message); },
    async shutdown(timeoutMs) { shutdownCalls.push(timeoutMs); },
  };
}

async function withService(run) {
  const directory = await mkdtemp(join(tmpdir(), "studi-wp11-"));
  const client = mockClient();
  const service = new TelemetryService({
    projectToken: "phc_test",
    host: "https://us.i.posthog.com",
    appVersion: "11.0.0",
    platform: "win32",
    settingsPath: join(directory, "telemetry-settings.json"),
    now: () => new Date("2026-09-01T12:00:00.000Z"),
    client,
  });
  try { await run({ directory, client, service }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("the outbound envelope strips raw failure canaries and rejects undeclared fields", async () => {
  await withService(async ({ client, service }) => {
    service.setDebug(30);
    service.captureError(
      new Error("password=CANARY_PASSWORD; cookie=CANARY_COOKIE; https://school.example.edu/course?token=CANARY_TOKEN <html>CANARY_ANSWER</html>"),
      "ipc",
      "ipc_request",
    );
    assert.equal(client.captures.length, 1, "only the scrubbed error reaches the client");
    const outbound = JSON.stringify(client.captures.at(-1));
    for (const forbidden of ["CANARY", "password", "cookie", "school.example.edu", "<html>", "ANSWER"]) {
      assert.equal(outbound.includes(forbidden), false, `outbound payload contained ${forbidden}`);
    }
    assert.deepEqual(client.captures.at(-1).properties, {
      app_version: "11.0.0",
      platform: "win32",
      beta_debug: true,
      boundary: "ipc",
      operation: "ipc_request",
      code: "operation_failed",
      debug_summary: "Error stopped at ipc",
    });
    assert.throws(
      () => service.capture("studi_auth_gate", { status: "signed_out", cookie: "CANARY_COOKIE" }),
      /unrecognized|expected|invalid/i,
    );
    assert.throws(() => service.capture("studi_arbitrary_event", {}), /Invalid option|expected/i);
  });
});

test("opt-out stops capture immediately, identity reset rotates anonymous state, and the choice survives restart", async () => {
  await withService(async ({ directory, client, service }) => {
    service.identifyClerk("user_wp11");
    service.capture("studi_auth_gate", { status: "approved" });
    assert.equal(service.state().identity, "clerk");
    service.setPreferences(false, false);
    assert.equal(service.capture("studi_app_started", { launch: "desktop" }), false);
    assert.equal(client.captures.length, 1);
    service.resetIdentity();
    const reset = service.state();
    assert.equal(reset.identity, "anonymous");
    assert.match(reset.distinctId, /^anonymous-/);
    assert.notEqual(reset.distinctId, "user_wp11");

    const restarted = new TelemetryService({
      projectToken: "phc_test",
      host: "https://us.i.posthog.com",
      appVersion: "11.0.0",
      platform: "win32",
      settingsPath: join(directory, "telemetry-settings.json"),
      client: mockClient(),
    });
    assert.equal(restarted.state().enabled, false);
    assert.equal(restarted.state().replayEnabled, false);
    assert.equal(restarted.state().distinctId, reset.distinctId);
  });
});

test("the inspector is bounded to upload-eligible scrubbed envelopes and shutdown is awaited once", async () => {
  await withService(async ({ client, service }) => {
    for (let index = 0; index < 35; index += 1) {
      service.capture("studi_dashboard_viewed", { section: index % 2 ? "workspace" : "auth_gate" });
    }
    assert.equal(service.state().inspector.length, 30);
    await Promise.all([service.shutdown(750), service.shutdown(100)]);
    assert.deepEqual(client.shutdownCalls, [750]);
  });
});

test("renderer replay policy masks text and inputs, disables console and network capture, and never enters the school view", async () => {
  const { filterRendererTelemetryEvent } = await import("../../src/telemetry/renderer.ts");
  const [renderer, main, app] = await Promise.all([
    readFile(new URL("../../src/telemetry/renderer.ts", import.meta.url), "utf8"),
    readFile(new URL("../../electron/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/app/StudiApp.tsx", import.meta.url), "utf8"),
  ]);
  for (const policy of [
    /maskTextSelector:\s*"\*"/,
    /maskAllInputs:\s*true/,
    /recordHeaders:\s*false/,
    /recordBody:\s*false/,
    /recordCrossOriginIframes:\s*false/,
    /capture_performance:\s*false/,
    /enable_recording_console_log:\s*false/,
    /bootstrap:\s*\{\s*distinctID:\s*state\.distinctId,\s*isIdentifiedID:/,
  ]) assert.match(renderer, policy);
  const schoolView = main.slice(main.indexOf("function createSchoolBrowser"), main.indexOf("function loadRenderer"));
  assert.doesNotMatch(schoolView, /preload|posthog|telemetry/i);
  assert.match(app, /rendererTelemetry\.reset\(\)[\s\S]*?studi\.signOut\(\)/);
  assert.match(app, /rendererTelemetry\.disable\(\)[\s\S]*?setTelemetryPreferences/);

  const timestamp = new Date("2026-09-01T12:00:00.000Z");
  const identify = filterRendererTelemetryEvent({
    uuid: "01991a94-4000-7000-8000-000000000001",
    event: "$identify",
    timestamp,
    properties: {
      token: "phc_test",
      distinct_id: "user_wp11",
      $anon_distinct_id: "anonymous-wp11",
      $process_person_profile: true,
      $device_id: "device-wp11",
      $session_id: "session-wp11",
      $window_id: "window-wp11",
      $current_url: "https://school.example.edu/CANARY",
      password: "CANARY_PASSWORD",
      undeclared: "CANARY_VALUE",
    },
    $set: { email: "CANARY@example.edu" },
    $set_once: { name: "CANARY_STUDENT" },
  });
  assert.deepEqual(identify, {
    uuid: "01991a94-4000-7000-8000-000000000001",
    event: "$identify",
    timestamp,
    properties: {
      token: "phc_test",
      distinct_id: "user_wp11",
      $anon_distinct_id: "anonymous-wp11",
      $process_person_profile: true,
      $device_id: "device-wp11",
      $session_id: "session-wp11",
      $window_id: "window-wp11",
    },
  });
  assert.equal(filterRendererTelemetryEvent({
    uuid: "01991a94-4000-7000-8000-000000000002",
    event: "$identify",
    properties: {
      token: "phc_test",
      distinct_id: "user_wp11",
      $process_person_profile: true,
    },
  }), null);

  const snapshot = {
    uuid: "01991a94-4000-7000-8000-000000000003",
    event: "$snapshot",
    properties: { snapshot_data: "opaque" },
  };
  assert.equal(filterRendererTelemetryEvent(snapshot), snapshot);
  assert.deepEqual(filterRendererTelemetryEvent({
    uuid: "01991a94-4000-7000-8000-000000000004",
    event: "$autocapture",
    properties: {
      $event_type: "click",
      $session_id: "session-wp11",
      $window_id: "window-wp11",
      $el_text: "CANARY_TEXT",
    },
  }), {
    uuid: "01991a94-4000-7000-8000-000000000004",
    event: "$autocapture",
    properties: {
      $event_type: "click",
      $session_id: "session-wp11",
      $window_id: "window-wp11",
    },
  });
});
