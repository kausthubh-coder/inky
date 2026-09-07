import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TelemetryService } from "../../dist/electron/telemetry/service.js";

function mockClient() {
  const captures = [];
  const identifies = [];
  const shutdownCalls = [];
  return {
    captures,
    identifies,
    shutdownCalls,
    capture(message) { captures.push(message); },
    identify(message) { identifies.push(message); },
    async shutdown(timeoutMs) { shutdownCalls.push(timeoutMs); },
  };
}

async function withService(run) {
  const directory = await mkdtemp(join(tmpdir(), "studi-wp16-"));
  const client = mockClient();
  const service = new TelemetryService({
    projectToken: "phc_test",
    host: "https://us.i.posthog.com",
    appVersion: "16.0.0",
    platform: "win32",
    settingsPath: join(directory, "telemetry-settings.json"),
    now: () => new Date("2026-09-01T12:00:00.000Z"),
    client,
  });
  try { await run({ directory, client, service }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("errors keep school context and strip only secrets", async () => {
  await withService(async ({ client, service }) => {
    service.setDebug(30);
    service.captureError(
      new Error("Calc 201 failed at https://moodle.ncsu.edu/course password=CANARY_PASSWORD cookie=CANARY_COOKIE token=CANARY_TOKEN"),
      "ipc",
      "ipc_request",
      { model: "gpt-5.6-sol", reasoning_effort: "high" },
    );
    assert.equal(client.captures.length, 1);
    const outbound = JSON.stringify(client.captures.at(-1));
    assert.match(outbound, /moodle\.ncsu\.edu/);
    assert.match(outbound, /Calc 201/);
    for (const forbidden of ["CANARY_PASSWORD", "CANARY_COOKIE", "CANARY_TOKEN"]) {
      assert.equal(outbound.includes(forbidden), false, `outbound payload contained ${forbidden}`);
    }
    const { error_details, ...properties } = client.captures.at(-1).properties;
    assert.equal(error_details.name, "Error");
    assert.match(error_details.stack, /telemetry-service.test.mjs/);
    assert.deepEqual(properties, {
      app_version: "16.0.0",
      platform: "win32",
      beta_debug: true,
      boundary: "ipc",
      operation: "ipc_request",
      code: "operation_failed",
      message: "Calc 201 failed at https://moodle.ncsu.edu/course [secret] [secret] [secret]",
      debug_summary: "Error stopped at ipc",
      model: "gpt-5.6-sol",
      reasoning_effort: "high",
    });
    assert.equal(
      service.capture("studi_auth_gate", { status: "signed_out", cookie: "CANARY_COOKIE" }),
      false,
    );
    assert.equal(service.capture("studi_arbitrary_event", {}), false);
    assert.equal(client.captures.length, 1);
  });
});

test("scan and assignment envelopes keep model, cost, and consented school facts", async () => {
  await withService(async ({ client, service }) => {
    service.identifyClerk({
      subject: "user_wp16",
      email: "ada@ncsu.edu",
      name: "Ada",
    });
    assert.equal(service.state().identity, "clerk");
    assert.equal(client.identifies.at(-1).distinctId, "user_wp16");
    assert.equal(client.identifies.at(-1).properties.email, "ada@ncsu.edu");
    assert.equal(client.identifies.at(-1).properties.name, "Ada");
    assert.match(client.identifies.at(-1).properties.$anon_distinct_id, /^anonymous-/);

    service.capture("studi_scan_finished", {
      mode: "start",
      state: "partial",
      duration_ms: 84_000,
      course_count: 2,
      assignment_count: 5,
      linked_system_count: 1,
      model: "gpt-5.6-sol",
      reasoning_effort: "high",
      input_tokens: 12_000,
      output_tokens: 3_400,
      cost_usd: 0.42,
      tool_calls: 18,
      student_name: "Ada",
      school_root: "https://moodle.ncsu.edu",
      course_titles: "Calc 201 | Physics 2",
      scan_id: "scan-1",
      failure_count: 1,
      failures: ["WebAssign assignments could not be listed"],
      coverage: [{ target: "WebAssign", status: "partial", failure: "Sign-in required" }],
      handoff: { kind: "linked_system_sign_in", reason: "Sign in to WebAssign" },
      current_step: "Need WebAssign sign-in",
    });
    service.capture("studi_assignment_finished", {
      task_id: "task-1",
      phase: "ready_review",
      assignment_title: "Week 3 homework",
      course_label: "Calc 201",
      model: "gpt-5.6-sol",
      reasoning_effort: "xhigh",
      duration_ms: 210_000,
      input_tokens: 8_000,
      output_tokens: 2_000,
      cost_usd: 0.18,
      tool_calls: 11,
    });
    const scan = client.captures.find((item) => item.event === "studi_scan_finished");
    const assignment = client.captures.find((item) => item.event === "studi_assignment_finished");
    assert.equal(scan.properties.student_name, "Ada");
    assert.equal(scan.properties.school_root, "https://moodle.ncsu.edu");
    assert.equal(scan.properties.model, "gpt-5.6-sol");
    assert.equal(scan.properties.cost_usd, 0.42);
    assert.equal(scan.properties.duration_ms, 84_000);
    assert.deepEqual(scan.properties.failures, ["WebAssign assignments could not be listed"]);
    assert.equal(scan.properties.coverage[0].failure, "Sign-in required");
    assert.equal(scan.properties.handoff.reason, "Sign in to WebAssign");
    assert.equal(assignment.properties.assignment_title, "Week 3 homework");
    assert.equal(assignment.properties.reasoning_effort, "xhigh");
    assert.equal(assignment.properties.duration_ms, 210_000);

    const longStep = `Verified assignment: ${"A".repeat(520)}`;
    assert.equal(
      service.capture("studi_scan_finished", {
        mode: "start",
        state: "succeeded",
        duration_ms: 12_000,
        course_count: 1,
        assignment_count: 1,
        linked_system_count: 0,
        current_step: longStep,
      }),
      true,
    );
    const complete = client.captures.at(-1);
    assert.equal(complete.event, "studi_scan_finished");
    assert.equal(complete.properties.current_step, longStep);
    assert.equal(complete.properties.state, "succeeded");
  });
});

test("agent traces retain ordinary content and remove nested credentials", async () => {
  const { AgentTrace } = await import("../../dist/agent-system/index.js");
  await withService(async ({ client, service }) => {
    const trace = new AgentTrace({ now: () => "2026-09-01T12:00:00.000Z" });
    const stop = service.subscribeToTrace(trace);
    await trace.emit({
      jobId: "job-1",
      runId: "run-1",
      turnIndex: 2,
      type: "tool_finished",
      payload: {
        userMessage: "Explain token limits and keep this exact answer: 42",
        prompt: "Use the student's CSC 316 notes.",
        reply: "The answer is 42.",
        tool: {
          name: "composio_github_list_issues",
          arguments: { owner: "student", api_key: "CANARY_NESTED_KEY" },
          result: { title: "Fix token limit display", authorization: "Bearer CANARY_BEARER" },
        },
        usage: { model: "gpt-5.6-sol", reasoning: "high", inputTokens: 120, outputTokens: 40 },
      },
    });
    stop();

    const outbound = client.captures.at(-1);
    assert.equal(outbound.event, "studi_agent_trace");
    assert.equal(outbound.properties.payload.userMessage, "Explain token limits and keep this exact answer: 42");
    assert.equal(outbound.properties.payload.prompt, "Use the student's CSC 316 notes.");
    assert.equal(outbound.properties.payload.reply, "The answer is 42.");
    assert.equal(outbound.properties.payload.tool.arguments.api_key, "[secret]");
    assert.equal(outbound.properties.payload.tool.result.authorization, "[secret]");
    assert.equal(JSON.stringify(outbound).includes("CANARY_NESTED_KEY"), false);
    assert.equal(JSON.stringify(outbound).includes("CANARY_BEARER"), false);
  });
});

test("error reports include nested causes and exact operation context even without debug mode", async () => {
  await withService(async ({ service, client }) => {
    const cause = { expectedTools: ["browser_snapshot", "write"], activeTools: ["write"], token: "CANARY_CAUSE" };
    cause.circular = cause;
    const error = new Error("Assignment could not start", { cause });
    assert.equal(service.captureError(error, "ipc", "ipc_request", { ipc_channel: "studi:start-assignment", task_id: "task-1" }), true);
    const payload = client.captures.at(-1).properties;
    assert.equal(payload.beta_debug, false);
    assert.equal(payload.task_id, "task-1");
    assert.match(payload.error_details.stack, /Assignment could not start/);
    assert.deepEqual(payload.error_details.cause.expectedTools, ["browser_snapshot", "write"]);
    assert.equal(payload.error_details.cause.circular, "[circular]");
    assert.doesNotMatch(JSON.stringify(payload), /CANARY_CAUSE/);
  });
});

test("failed chat tools also produce searchable errors linked to their run", async () => {
  const { AgentTrace } = await import("../../dist/agent-system/index.js");
  await withService(async ({ service, client }) => {
    const trace = new AgentTrace();
    service.subscribeToTrace(trace);
    await trace.emit({ jobId: "job-home", runId: "run-1", turnIndex: 0, type: "tool_finished", payload: {
      name: "queue_start", outcome: "failed", result: { content: [{ type: "text", text: "Tool boundary mismatch" }] },
    } });
    assert.deepEqual(client.captures.map((event) => event.event), ["studi_agent_trace", "studi_error"]);
    const error = client.captures.at(-1).properties;
    assert.equal(error.message, "Tool boundary mismatch");
    assert.equal(error.run_id, "run-1");
    assert.equal(error.tool_name, "queue_start");
  });
});

test("connected-app telemetry keeps scoped account state and timing without credentials", async () => {
  await withService(async ({ client, service }) => {
    assert.equal(service.capture("studi_connected_app", {
      toolkit: "github",
      operation: "refresh",
      status: "ACTIVE",
      connected_account_id: "ca_test_account",
      duration_ms: 318,
    }), true);
    const outbound = client.captures.at(-1);
    assert.equal(outbound.event, "studi_connected_app");
    assert.equal(outbound.properties.toolkit, "github");
    assert.equal(outbound.properties.operation, "refresh");
    assert.equal(outbound.properties.status, "ACTIVE");
    assert.equal(outbound.properties.connected_account_id, "ca_test_account");
    assert.equal(outbound.properties.duration_ms, 318);
  });
});

test("Composio execution telemetry is chartable without tool arguments or credentials", async () => {
  await withService(async ({ client, service }) => {
    assert.equal(service.capture("studi_composio_tool", {
      toolkit: "googledrive",
      tool: "GOOGLEDRIVE_FIND_FILE",
      status: "succeeded",
      duration_ms: 541,
      original_bytes: 19_210,
      retained_bytes: 8_192,
      truncated: true,
      log_id: "log_drive_1",
    }), true);
    const outbound = client.captures.at(-1);
    assert.equal(outbound.event, "studi_composio_tool");
    assert.equal(outbound.properties.toolkit, "googledrive");
    assert.equal(outbound.properties.tool, "GOOGLEDRIVE_FIND_FILE");
    assert.equal(outbound.properties.truncated, true);
    assert.equal(Object.hasOwn(outbound.properties, "arguments"), false);
  });
});

test("opt-out stops capture immediately, identity reset rotates anonymous state, and the choice survives restart", async () => {
  await withService(async ({ directory, client, service }) => {
    service.identifyClerk({ subject: "user_wp16" });
    service.capture("studi_auth_gate", { status: "approved" });
    assert.equal(service.state().identity, "clerk");
    service.setPreferences(false, false);
    assert.equal(service.capture("studi_app_started", { launch: "desktop" }), false);
    assert.equal(client.captures.length, 1);
    service.resetIdentity();
    const reset = service.state();
    assert.equal(reset.identity, "anonymous");
    assert.match(reset.distinctId, /^anonymous-/);
    assert.notEqual(reset.distinctId, "user_wp16");

    const restarted = new TelemetryService({
      projectToken: "phc_test",
      host: "https://us.i.posthog.com",
      appVersion: "16.0.0",
      platform: "win32",
      settingsPath: join(directory, "telemetry-settings.json"),
      client: mockClient(),
    });
    assert.equal(restarted.state().enabled, false);
    assert.equal(restarted.state().replayEnabled, false);
    assert.equal(restarted.state().distinctId, reset.distinctId);
  });
});

test("the inspector is bounded to upload-eligible envelopes and shutdown is awaited once", async () => {
  await withService(async ({ client, service }) => {
    for (let index = 0; index < 35; index += 1) {
      service.capture("studi_dashboard_viewed", { section: index % 2 ? "workspace" : "auth_gate" });
    }
    assert.equal(service.state().inspector.length, 30);
    await Promise.all([service.shutdown(750), service.shutdown(100)]);
    assert.deepEqual(client.shutdownCalls, [750]);
  });
});

test("renderer replay records Studi text, still masks passwords, and never enters the school view", async () => {
  const { build } = await import("esbuild");
  const bundled = await build({ entryPoints: ["desktop/src/telemetry/renderer.ts"], bundle: true, write: false, format: "esm", platform: "node", packages: "external" });
  const { filterRendererTelemetryEvent } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
  const [renderer, main, app] = await Promise.all([
    readFile(new URL("../../desktop/src/telemetry/renderer.ts", import.meta.url), "utf8"),
    readFile(new URL("../../desktop/electron/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../../desktop/src/app/StudiApp.tsx", import.meta.url), "utf8"),
  ]);
  for (const policy of [
    /maskTextSelector:\s*"\*"/,
    /maskAllInputs:\s*true/,
    /mask_all_text:\s*false/,
    /recordHeaders:\s*false/,
    /recordBody:\s*false/,
    /recordCrossOriginIframes:\s*false/,
    /capture_performance:\s*true/,
    /enable_recording_console_log:\s*false/,
    /bootstrap:\s*\{\s*distinctID:\s*state\.distinctId,\s*isIdentifiedID:/,
  ]) assert.match(renderer, policy);
  const schoolView = main.slice(main.indexOf("function createSchoolBrowser"), main.indexOf("function loadRenderer"));
  assert.doesNotMatch(schoolView, /preload|posthog|executeJavaScript/i);
  assert.match(app, /rendererTelemetry\.reset\(\)[\s\S]*?studi\.signOut\(\)/);
  assert.match(app, /rendererTelemetry\.disable\(\)[\s\S]*?setTelemetryPreferences/);

  const timestamp = new Date("2026-09-01T12:00:00.000Z");
  const identify = filterRendererTelemetryEvent({
    uuid: "01991a94-4000-7000-8000-000000000001",
    event: "$identify",
    timestamp,
    properties: {
      token: "phc_test",
      distinct_id: "user_wp16",
      $anon_distinct_id: "anonymous-wp16",
      $process_person_profile: true,
      $device_id: "device-wp16",
      $session_id: "session-wp16",
      $window_id: "window-wp16",
      email: "ada@ncsu.edu",
      name: "Ada",
      password: "CANARY_PASSWORD",
      undeclared: "CANARY_VALUE",
    },
    $set: { email: "ada@ncsu.edu" },
    $set_once: { name: "Ada" },
  });
  assert.equal(identify.properties.token, "phc_test");
  assert.equal(identify.properties.distinct_id, "user_wp16");
  assert.equal(identify.properties.password, "[secret]");
  assert.equal(identify.properties.undeclared, "CANARY_VALUE");
  assert.deepEqual(identify.$set, { email: "ada@ncsu.edu" });
  assert.deepEqual(identify.$set_once, { name: "Ada" });
  assert.equal(identify.timestamp, timestamp);
  assert.ok(filterRendererTelemetryEvent({ event: "$identify", properties: { token: "phc_test", distinct_id: "user_wp16" } }));
  const click = filterRendererTelemetryEvent({ event: "$autocapture", properties: {
    token: "phc_test", distinct_id: "user_wp16", $elements: [{ tag_name: "button", $el_text: "Scan courses" }],
    $current_url: "https://school.test/course?id=2&ticket=SECRET_TICKET", $session_id: "session-wp16",
  } });
  assert.equal(click.properties.token, "phc_test");
  assert.equal(click.properties.distinct_id, "user_wp16");
  assert.equal(click.properties.$elements[0].$el_text, "Scan courses");
  assert.equal(click.properties.$current_url.includes("SECRET_TICKET"), false);
  assert.ok(filterRendererTelemetryEvent({ event: "$performance_event", properties: { duration: 123 } }));

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
      $session_id: "session-wp16",
      $window_id: "window-wp16",
      $el_text: "Start scan",
    },
  }), {
    uuid: "01991a94-4000-7000-8000-000000000004",
    event: "$autocapture",
    properties: {
      $event_type: "click",
      $session_id: "session-wp16",
      $window_id: "window-wp16",
      $el_text: "Start scan",
    },
  });
});

test('handled chat errors use PostHog exception tracking and retain ordinary context',async()=>{
 await withService(async({client,service})=>{
  const exceptions=[];client.captureException=(error,id,props)=>exceptions.push({error,id,props});
  service.captureError(new Error('Math chat failed password=HIDDEN_CREDENTIAL'),'ipc','ipc_request');
  assert.equal(exceptions.length,1);assert.match(exceptions[0].error.message,/Math chat/);assert.equal(exceptions[0].error.stack.includes('HIDDEN_CREDENTIAL'),false);assert.equal(exceptions[0].id,service.state().distinctId);
  service.setPreferences(false,false);service.captureError(new Error('Muted'),'ipc','ipc_request');assert.equal(exceptions.length,1);
 });
});


test("large diagnostics preserve exact content in correlated chunks and stop at opt-out", async () => {
  await withService(async ({ service, client }) => {
    service.identifyClerk({ subject: "user_content", email: "friend@example.test", name: "Friend" });
    assert.equal(service.setReplayContext("wrong-user", "wrong-session", "wrong-window"), false);
    assert.equal(service.setReplayContext("user_content", "replay-1", "window-1"), true);
    const text = "Exact coursework prompt and response. ".repeat(8000);
    service.captureDiagnostic({ source: "runtime", kind: "message_end", session_id: "pi-1", run_id: "run-1",
      at: "2026-09-07T12:00:00.000Z", payload: { text, nested: { access_token: "CREDENTIAL_CANARY" } } });
    const chunks = client.captures.map(event => event.properties);
    assert.ok(chunks.length > 1);
    assert.equal(new Set(chunks.map(chunk => chunk.diagnostic_id)).size, 1);
    assert.equal(chunks.every(chunk => chunk.$session_id === "replay-1" && chunk.$window_id === "window-1"), true);
    const reconstructed = JSON.parse(chunks.sort((a, b) => a.chunk_index - b.chunk_index).map(chunk => chunk.payload).join(""));
    assert.equal(reconstructed.text, text);
    assert.equal(reconstructed.nested.access_token, "[secret]");
    service.resetIdentity();
    service.capture("studi_app_started", { launch: "desktop" });
    assert.equal(client.captures.at(-1).properties.$session_id, undefined);
    const count = client.captures.length;
    service.setPreferences(false, false);
    assert.equal(service.captureDiagnostic({ source: "browser", kind: "page_loaded", at: "2026-09-07T12:00:00.000Z", payload: { url: "https://school.test" } }), false);
    assert.equal(client.captures.length, count);
    assert.equal(service.setReplayContext(service.state().distinctId, "replay-2", "window-2"), false);
  });
});

test("native AI generation events retain replay correlation", async () => {
  await withService(async ({ service, client }) => {
    service.setReplayContext(service.state().distinctId, "replay-generation", "window-generation");
    service.captureDiagnostic({ source: "runtime", kind: "generation", at: "2026-09-07T12:00:00.000Z", payload: {
      $ai_trace_id: "run", $ai_span_id: "call", $ai_session_id: "pi-session", $ai_model: "gpt-6-astra", $ai_provider: "openai-codex",
      $ai_input: [{ role: "user", content: "Explain my Math homework" }], $ai_output_choices: [{ role: "assistant", content: "Full answer" }],
      $ai_input_tokens: 42, $ai_output_tokens: 12, $ai_cache_read_input_tokens: 0, $ai_cache_creation_input_tokens: 0,
      $ai_total_cost_usd: 0.01, $ai_latency: 1.2, $ai_is_error: false, stop_reason: "stop",
    } });
    const event = client.captures.find(item => item.event === "$ai_generation");
    assert.equal(event.properties.$ai_input[0].content, "Explain my Math homework");
    assert.equal(event.properties.$session_id, "replay-generation");
  });
});
