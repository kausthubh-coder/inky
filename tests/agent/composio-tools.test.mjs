import assert from "node:assert/strict";
import test from "node:test";

import { createConnectedAppTools } from "../../dist/electron/agent/composio-tools.js";

test("connected app tools preserve the server schema and execute through the scoped gateway", async () => {
  const calls = [];
  const gateway = {
    connectedApps: async () => ({ configured: true, toolkits: [{ toolkit: "github" }] }),
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

  const [tool] = await createConnectedAppTools(gateway);
  assert.equal(tool.name, "composio_github_list_repositories_for_the_authenticated_user");
  assert.deepEqual(tool.parameters.properties.per_page, { type: "integer", minimum: 1, maximum: 100 });
  const result = await tool.execute("call-1", { per_page: 5 });
  assert.deepEqual(calls, [{ toolkit: "github", toolSlug: "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER", arguments_: { per_page: 5 } }]);
  assert.deepEqual(result.details.data.value, { repositories: ["studi-2"] });
});

test("connected app tools stay absent when the server or account is unavailable", async () => {
  assert.deepEqual(await createConnectedAppTools({ connectedApps: async () => ({ configured: false, toolkits: [] }) }), []);
  assert.deepEqual(await createConnectedAppTools({
    connectedApps: async () => ({ configured: true, toolkits: [{ toolkit: "github" }] }),
    connectedAppTools: async () => [],
  }), []);
});
