import assert from "node:assert/strict";
import test from "node:test";

import {
  readComposioPolicy,
  requireAllowedComposioTool,
  sanitizeComposioValue,
  boundedComposioContent,
} from "../../convex/composioPolicy.ts";

test("Composio policy requires pinned versions and explicit tools", () => {
  const policy = readComposioPolicy(JSON.stringify({
    github: {
      version: "20260901_00",
      tools: ["GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER"],
    },
  }));
  assert.equal(policy.github.version, "20260901_00");
  assert.equal(requireAllowedComposioTool(policy, "github", "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER"), policy.github);
  assert.throws(() => requireAllowedComposioTool(policy, "github", "GITHUB_DELETE_REPOSITORY"), /not enabled/);
  assert.throws(() => readComposioPolicy('{"github":{"version":"latest","tools":["GITHUB_LIST"]}}'), /pinned/);
});

test("Composio payloads retain ordinary content and remove credentials", () => {
  const sanitized = sanitizeComposioValue({
    title: "Explain API design and token limits",
    nested: {
      api_key: "CANARY_KEY",
      authorization: "Bearer CANARY_BEARER",
      result: "Assignment answer 42",
    },
  });
  assert.deepEqual(sanitized, {
    title: "Explain API design and token limits",
    nested: {
      api_key: "[secret]",
      authorization: "[secret]",
      result: "Assignment answer 42",
    },
  });
});

test("Composio results are bounded by encoded bytes", () => {
  const content = boundedComposioContent({ text: "\u{1f642}".repeat(200_000) });
  assert.equal(content.truncated, true);
  assert.ok(content.retainedBytes <= 750_000);
  assert.ok(content.originalBytes > content.retainedBytes);
});
