import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({ entryPoints: ["desktop/src/telemetry/renderer.ts"], bundle: true, write: false, format: "esm", platform: "node", packages: "external" });
const { RendererTelemetry } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const state = { rendererConfig: { projectToken: "phc_test", host: "https://us.i.posthog.com" }, enabled: true, replayEnabled: true, distinctId: "user_test", identity: "clerk" };

function mockSdk() {
  const calls = [];
  let callback, options, optedOut = true, id;
  const client = {
    init(_token, config) { options = config; optedOut = config.opt_out_capturing_by_default; id = config.bootstrap.distinctID; },
    opt_in_capturing() { optedOut = false; calls.push("opt-in"); },
    opt_out_capturing() { optedOut = true; calls.push("opt-out"); },
    has_opted_out_capturing() { return optedOut; },
    identify(next) { id = next; },
    get_distinct_id() { return id; },
    get_session_id() { return "session-1"; },
    sessionRecordingStarted() { return false; },
    reset() { id = "anonymous-new"; },
    startSessionRecording() { calls.push("record"); },
    stopSessionRecording() { calls.push("stop"); },
    capture(event, props) { calls.push({ event, props }); },
    onSessionId(fn) { callback = fn; fn("session-1", "window-1"); },
  };
  return { client, calls, get options() { return options; }, rotate() { callback("session-2", "window-1"); } };
}

test("renderer correlates rotated sessions, preserves ordinary replay content and respects opt-out", async () => {
  const previousWindow = globalThis.window;
  const contexts = [];
  globalThis.window = { studi: { async captureUiTelemetry(value) { contexts.push(value); return true; } } };
  try {
    const sdk = mockSdk();
    const renderer = new RendererTelemetry(async () => ({ default: sdk.client }));
    await renderer.sync(state);
    assert.equal(contexts.at(-1).distinctId, "user_test");
    assert.equal(contexts.at(-1).sessionId, "session-1");
    sdk.rotate();
    assert.equal(contexts.at(-1).sessionId, "session-2");
    renderer.page("library", "workspace");
    assert.deepEqual(sdk.calls.at(-1), { event: "$pageview", props: { screen: "library", section: "workspace" } });
    const recording = sdk.options.session_recording;
    assert.equal(recording.maskInputOptions.password, true);
    assert.equal(recording.maskInputFn("PASSWORD_CANARY", { getAttribute: () => "password", closest: () => null }), "[secret]");
    assert.equal(recording.maskInputFn("My exact prompt", { getAttribute: () => "text", closest: () => null }), "My exact prompt");
    assert.equal(recording.maskTextFn("Math error token=TOKEN_CANARY"), "Math error [secret]");
    assert.equal(recording.maskInputFn("DEVICE_CODE", { getAttribute: () => "text", closest: () => ({}) }), "[secret]");
    await renderer.sync({ ...state, enabled: false });
    const count = contexts.length;
    sdk.rotate();
    renderer.page("settings", "workspace");
    assert.equal(contexts.length, count);
    assert.equal(sdk.calls.at(-1), "opt-out");
  } finally { globalThis.window = previousWindow; }
});

test("opting out while the SDK loads cannot start recording or capturing", async () => {
  const sdk = mockSdk();
  let resolve;
  const loading = new Promise(done => { resolve = done; });
  const renderer = new RendererTelemetry(() => loading);
  const syncing = renderer.sync(state);
  renderer.disable();
  resolve({ default: sdk.client });
  await syncing;
  assert.equal(sdk.options.opt_out_capturing_by_default, true);
  assert.equal(sdk.options.disable_session_recording, true);
  assert.equal(sdk.calls.includes("opt-in"), false);
  assert.equal(sdk.calls.includes("record"), false);
});


test("renderer reports requested but unavailable replay once and retries a failed SDK load", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  const sdk = mockSdk();
  let attempts = 0;
  const renderer = new RendererTelemetry(async () => {
    if (++attempts === 1) throw new Error("SDK chunk unavailable");
    return { default: sdk.client };
  });
  try {
  await assert.rejects(renderer.sync(state), /SDK chunk unavailable/);
  await renderer.sync(state);
  await renderer.sync(state);
  const status = sdk.calls.filter(call => call.event === "studi_replay_status");
  assert.deepEqual(status, [{ event: "studi_replay_status", props: { requested: true, recording: false } }]);
  } finally { globalThis.window = previousWindow; }
});
