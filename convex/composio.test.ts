/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";

const { search } = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("@composio/core", () => ({
  Composio: class {
    sessions = { create: vi.fn(async () => ({ search })) };
  },
}));
const modules = import.meta.glob("./**/*.ts");
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it.each(["all", "selected"])("normalizes toolkit case without bypassing %s policy", async (access) => {
  vi.stubEnv("COMPOSIO_API_KEY", "test-only-key");
  vi.stubEnv("STUDI_COMPOSIO_TOOL_POLICY_JSON", JSON.stringify({
    gmail: { version: "20260902_00", ...(access === "all" ? { access } : { tools: ["GMAIL_FETCH_EMAILS"] }) },
  }));
  search.mockResolvedValue({
    success: true, results: [], nextStepsGuidance: [],
    toolSchemas: {
      fetch: { toolkit: "GMAIL", toolSlug: "GMAIL_FETCH_EMAILS" },
      draft: { toolkit: "gmail", toolSlug: "GMAIL_CREATE_EMAIL_DRAFT" },
      other: { toolkit: "GOOGLEDRIVE", toolSlug: "GOOGLEDRIVE_LIST_FILES" },
    },
  });
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("betaAccess", {
      clerkSubject: "composio_test", approved: true, reason: "approved", updatedAt: 0, updatedBy: "test",
    });
  });
  const result = await t.withIdentity({ subject: "composio_test" }).action(api.composio.search, { toolkit: "gmail", query: "find emails" });
  expect(result.tools.map((tool) => tool.slug)).toEqual(access === "all"
    ? ["GMAIL_FETCH_EMAILS", "GMAIL_CREATE_EMAIL_DRAFT"] : ["GMAIL_FETCH_EMAILS"]);
  expect(result.tools.every((tool) => tool.toolkit === "gmail")).toBe(true);
});

it("refuses anonymous and unapproved callers before contacting Composio", async () => {
  const t = convexTest(schema, modules);
  const args = { toolkit: "gmail", query: "find emails" };
  await expect(t.action(api.composio.search, args)).rejects.toThrow("Unauthenticated");
  await expect(t.withIdentity({ subject: "unapproved_test" }).action(api.composio.search, args)).rejects.toThrow();
  expect(search).not.toHaveBeenCalled();
});
