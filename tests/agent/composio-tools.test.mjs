import assert from "node:assert/strict";
import test from "node:test";

import { createConnectedAppTools } from "../../dist/electron/agent/composio-tools.js";

test("connected apps expose lazy search and execute tools instead of flooding the prompt", async () => {
  const calls = [];
  const observations = [];
  const gateway = {
    connectedApps: async () => ({ configured: true, toolkits: [{ toolkit: "github" }, { toolkit: "gmail" }] }),
    connectedAppConnection: async (toolkit) => ({ toolkit, sessionId: "session-1", connectedAccountId: "account-1", status: "ACTIVE", redirectUrl: null }),
    searchConnectedAppTools: async (toolkit, query) => ({
      toolkit,
      query,
      tools: [{
        toolkit,
        slug: "GMAIL_SEND_EMAIL",
        name: "Send email",
        description: "Send an email.",
        version: "20260902_00",
        inputParameters: { type: "object", properties: { recipient: { type: "string" } }, required: ["recipient"] },
      }],
      guidance: ["Use the exact slug."],
    }),
    executeConnectedAppTool: async (toolkit, toolSlug, arguments_) => {
      calls.push({ toolkit, toolSlug, arguments_ });
      return {
        toolkit,
        toolSlug,
        durationMs: 14,
        logId: "log-1",
        error: null,
        data: { value: { sent: true }, originalBytes: 13, retainedBytes: 13, sha256: "a".repeat(64), truncated: false },
      };
    },
  };

  const tools = await createConnectedAppTools(gateway, { observeExecution: (event) => observations.push(event) });
  assert.deepEqual(tools.map((tool) => tool.name), ["connected_apps_search", "connected_apps_execute"]);
  assert.deepEqual(tools[0].parameters.properties.toolkit.enum, ["github", "gmail"]);
  const search = await tools[0].execute("call-search", { toolkit: "gmail", query: "send my professor an email" });
  assert.equal(search.details.tools[0].slug, "GMAIL_SEND_EMAIL");
  const result = await tools[1].execute("call-run", { toolkit: "gmail", toolSlug: "GMAIL_SEND_EMAIL", arguments: { recipient: "professor@example.edu" } });
  assert.deepEqual(calls, [{ toolkit: "gmail", toolSlug: "GMAIL_SEND_EMAIL", arguments_: { recipient: "professor@example.edu" } }]);
  assert.deepEqual(result.details.data.value, { sent: true });
  assert.equal(JSON.stringify(observations).includes("professor@example.edu"), false);
  assert.equal(observations[0].status, "succeeded");
});

test("connected app failures are observable without exposing arguments", async () => {
  const observations = [];
  const gateway = {
    connectedApps: async () => ({ configured: true, toolkits: [{ toolkit: "notion" }] }),
    connectedAppConnection: async () => ({ toolkit: "notion", sessionId: "session-1", connectedAccountId: "account-1", status: "ACTIVE", redirectUrl: null }),
    searchConnectedAppTools: async () => { throw new Error("not used"); },
    executeConnectedAppTool: async () => { throw new Error("Provider temporarily unavailable"); },
  };
  const [, execute] = await createConnectedAppTools(gateway, { observeExecution: (event) => observations.push(event) });
  await assert.rejects(() => execute.execute("call-2", { toolkit: "notion", toolSlug: "NOTION_CREATE_PAGE", arguments: { title: "secret class notes" } }), /temporarily unavailable/);
  assert.equal(observations[0].status, "failed");
  assert.equal(JSON.stringify(observations).includes("secret class notes"), false);
});

test("connected app tools stay absent when the server or every account is unavailable", async () => {
  assert.deepEqual(await createConnectedAppTools({ connectedApps: async () => ({ configured: false, toolkits: [] }) }), []);
  assert.deepEqual(await createConnectedAppTools({
    connectedApps: async () => ({ configured: true, toolkits: [{ toolkit: "github" }] }),
    connectedAppConnection: async () => ({ toolkit: "github", sessionId: "session-1", connectedAccountId: null, status: "DISCONNECTED", redirectUrl: null }),
    searchConnectedAppTools: async () => { throw new Error("disconnected toolkits must not search"); },
  }), []);
});
