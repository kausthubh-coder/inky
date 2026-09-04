import assert from "node:assert/strict";
import test from "node:test";

import { createConnectedAppTools } from "../../dist/electron/agent/composio-tools.js";

test("connected app tools preserve the server schema and execute through the scoped gateway", async () => {
  const calls = [];
  const observations = [];
  const gateway = {
    connectedApps: async () => ({ configured: true, toolkits: [{ toolkit: "github" }] }),
    connectedAppConnection: async () => ({ toolkit: "github", sessionId: "session-1", connectedAccountId: "account-1", status: "ACTIVE", redirectUrl: null }),
    connectedAppTools: async () => [{
      toolkit: "github",
      slug: "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
      name: "List repositories for the authenticated user",
      description: "Lists repositories visible to the connected GitHub account.",
      version: "20260902_00",
      inputParameters: {
        type: "object",
        properties: { per_page: { type: "integer", minimum: 1, maximum: 100 } },
        additionalProperties: false,
      },
    }],
    executeConnectedAppTool: async (toolkit, toolSlug, arguments_) => {
      calls.push({ toolkit, toolSlug, arguments_ });
      return {
        toolkit,
        toolSlug,
        durationMs: 14,
        logId: "log-1",
        error: null,
        data: { value: { repositories: ["studi-2"] }, originalBytes: 28, retainedBytes: 28, sha256: "a".repeat(64), truncated: false },
      };
    },
  };

  const [tool] = await createConnectedAppTools(gateway, { observeExecution: (event) => observations.push(event) });
  assert.equal(tool.name, "composio_github_list_repositories_for_the_authenticated_user");
  assert.deepEqual(tool.parameters.properties.per_page, { type: "integer", minimum: 1, maximum: 100 });
  const result = await tool.execute("call-1", { per_page: 5 });
  assert.deepEqual(calls, [{ toolkit: "github", toolSlug: "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER", arguments_: { per_page: 5 } }]);
  assert.deepEqual(result.details.data.value, { repositories: ["studi-2"] });
  assert.deepEqual(observations, [{
    toolkit: "github",
    tool: "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
    status: "succeeded",
    durationMs: 14,
    originalBytes: 28,
    retainedBytes: 28,
    truncated: false,
    logId: "log-1",
  }]);
});

test("connected app tool failures are observable without exposing arguments", async () => {
  const observations = [];
  const gateway = {
    connectedApps: async () => ({ configured: true, toolkits: [{ toolkit: "notion" }] }),
    connectedAppConnection: async () => ({ toolkit: "notion", sessionId: "session-1", connectedAccountId: "account-1", status: "ACTIVE", redirectUrl: null }),
    connectedAppTools: async () => [{ toolkit: "notion", slug: "NOTION_SEARCH", name: "Search", version: "1", inputParameters: { type: "object" } }],
    executeConnectedAppTool: async () => ({
      toolkit: "notion",
      toolSlug: "NOTION_SEARCH",
      durationMs: 22,
      logId: "log-2",
      error: "Provider temporarily unavailable",
      data: { value: null, originalBytes: 0, retainedBytes: 0, sha256: "b".repeat(64), truncated: false },
    }),
  };
  const [tool] = await createConnectedAppTools(gateway, { observeExecution: (event) => observations.push(event) });
  await assert.rejects(() => tool.execute("call-2", { query: "secret class notes" }), /temporarily unavailable/);
  assert.equal(observations[0].status, "failed");
  assert.equal(observations[0].error, "Provider temporarily unavailable");
  assert.equal(JSON.stringify(observations).includes("secret class notes"), false);
});

test("connected app tools stay absent when the server or account is unavailable", async () => {
  assert.deepEqual(await createConnectedAppTools({ connectedApps: async () => ({ configured: false, toolkits: [] }) }), []);
  assert.deepEqual(await createConnectedAppTools({
    connectedApps: async () => ({ configured: true, toolkits: [{ toolkit: "github" }] }),
    connectedAppConnection: async () => ({ toolkit: "github", sessionId: "session-1", connectedAccountId: null, status: "DISCONNECTED", redirectUrl: null }),
    connectedAppTools: async () => { throw new Error("disconnected toolkits must not load tools"); },
  }), []);
});
