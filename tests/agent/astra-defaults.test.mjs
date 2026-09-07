import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { PiAgentRuntime } from "../../dist/electron/agent/runtime.js";

test("real Pi sessions send Astra medium priority, including after resume, without changing other models", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-astra-test-"));
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false,
  });
  const requests = [];
  const diagnostics = [];
  // Fabricated token: enough to exercise the real provider's request builder.
  // Stop inside onPayload before any network request or real authentication.
  const token = `test.${Buffer.from(JSON.stringify({
    "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" },
  })).toString("base64url")}.test`;
  modelRuntime.registerNativeProvider({
    ...modelRuntime.getProvider("openai-codex"),
    auth: { apiKey: { resolve: async () => ({ apiKey: token }) } },
  });
  modelRuntime.streamSimple = (model, context, options) => streamSimple(model, context, {
    ...options,
    apiKey: token,
    onPayload: async (body, requestModel) => {
      requests.push((await options.onPayload?.(body, requestModel)) ?? body);
      throw new Error("Fixture captured request before network");
    },
  });
  let session;
  try {
    const runtime = await PiAgentRuntime.create({ cwd: root, agentDir: join(root, "agent"), modelRuntime, onDiagnostic: event => diagnostics.push(event) });
    assert.equal(runtime.selectedModelId, "gpt-6-astra");
    assert.equal(runtime.selectedReasoningEffort, "medium");
    assert.ok(runtime.getProviderModels("openai-codex").some((model) => model.id === "gpt-6-astra"));
    session = await runtime.createSession();
    await session.prompt("Check request defaults.");
    await session.replace({ resumeSessionPath: session.sessionPath });
    await session.prompt("Check resumed request defaults.");
    assert.equal(requests.length, 2);
    const diagnosticRequests = diagnostics.filter(event => event.kind === "provider_request");
    assert.equal(diagnosticRequests.length, 2);
    assert.deepEqual(diagnosticRequests.map(event => event.payload.request), requests);
    assert.notEqual(diagnosticRequests[0].run_id, diagnosticRequests[1].run_id);
    assert.ok(diagnostics.some(event => event.kind === "session_created" && event.payload.system_prompt.includes("Studi")));
    assert.ok(diagnostics.some(event => event.kind === "message_end" && JSON.stringify(event.payload).includes("Check request defaults.")));
    for (const request of requests) {
      assert.equal(request.model, "gpt-6-astra");
      assert.equal(request.reasoning.effort, "medium");
      assert.equal(request.service_tier, "priority");
    }
    session.dispose();
    runtime.selectModel("openai-codex", "gpt-5.6-sol");
    runtime.setReasoningEffort("high");
    session = await runtime.createSession();
    await session.prompt("Check explicit selection.");
    assert.equal(requests.at(-1).model, "gpt-5.6-sol");
    assert.equal(requests.at(-1).reasoning.effort, "high");
    assert.equal(requests.at(-1).service_tier, undefined);
  } finally {
    session?.dispose();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
