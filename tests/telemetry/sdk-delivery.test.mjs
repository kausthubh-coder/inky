import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { TelemetryService } from "../../dist/electron/telemetry/service.js";

test("the real PostHog SDK sends identities, diagnostic content, AI events and replay IDs without credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-sdk-delivery-"));
  const originalFetch = globalThis.fetch;
  const batches = [];
  globalThis.fetch = async (_url, options) => {
    if (options?.body) {
      let bytes = Buffer.from(options.body);
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
      const body = JSON.parse(bytes.toString());
      if (body.batch) batches.push(...body.batch);
    }
    return new Response(JSON.stringify({ status: 1 }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const service = new TelemetryService({
    projectToken: "phc_test", host: "https://us.i.posthog.com", appVersion: "0.1.3",
    platform: "win32", settingsPath: join(root, "settings.json"),
  });
  try {
    service.identifyClerk({ subject: "user_delivery", email: "friend@example.test", name: "Friend" });
    service.setReplayContext("user_delivery", "replay-delivery", "window-delivery");
    service.captureDiagnostic({ source: "runtime", kind: "provider_request", at: new Date().toISOString(), payload: { prompt: "Exact prompt", authorization: "CREDENTIAL_CANARY" } });
    service.capture("$ai_generation", {
      $ai_trace_id: "run", $ai_span_id: "span", $ai_session_id: "pi-session", $ai_model: "gpt-6-astra", $ai_provider: "openai-codex",
      $ai_input: [{ role: "user", content: "Exact prompt" }], $ai_output_choices: [{ role: "assistant", content: "Exact reply" }],
      $ai_input_tokens: 1, $ai_output_tokens: 2, $ai_cache_read_input_tokens: 0, $ai_cache_creation_input_tokens: 0,
      $ai_total_cost_usd: 0, $ai_latency: 0.5, $ai_is_error: false, stop_reason: "stop",
    });
    await service.flush();
    assert.equal(batches.find(event => event.event === "$identify").properties.$set.email, "friend@example.test");
    const diagnostic = batches.find(event => event.event === "studi_diagnostic");
    assert.equal(diagnostic.properties.payload.prompt, "Exact prompt");
    assert.equal(diagnostic.properties.payload.authorization, "[secret]");
    const generation = batches.find(event => event.event === "$ai_generation");
    assert.equal(generation.properties.$ai_output_choices[0].content, "Exact reply");
    assert.equal(generation.properties.$session_id, "replay-delivery");
    assert.equal(generation.distinct_id, "user_delivery");
    assert.equal(JSON.stringify(batches).includes("CREDENTIAL_CANARY"), false);
  } finally {
    await service.shutdown();
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});
