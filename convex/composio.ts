"use node";

import { createHash } from "node:crypto";

import { Composio, SessionPreset } from "@composio/core";
import { v } from "convex/values";

import { internal } from "./_generated/api.js";
import { action, type ActionCtx } from "./_generated/server.js";
import { boundedComposioContent, readComposioPolicy, requireAllowedComposioTool, sanitizeComposioValue } from "./composioPolicy.js";

const statusResult = v.object({
  configured: v.boolean(),
  toolkits: v.array(v.object({ toolkit: v.string(), version: v.string(), tools: v.array(v.string()) })),
});

const connectionResult = v.object({
  toolkit: v.string(),
  sessionId: v.string(),
  connectedAccountId: v.union(v.string(), v.null()),
  status: v.string(),
  redirectUrl: v.union(v.string(), v.null()),
});

const contentResult = v.object({
  value: v.any(),
  originalBytes: v.number(),
  retainedBytes: v.number(),
  sha256: v.string(),
  truncated: v.boolean(),
});

export const tools = action({
  args: { toolkit: v.string() },
  returns: v.array(v.object({
    toolkit: v.string(),
    slug: v.string(),
    name: v.string(),
    description: v.union(v.string(), v.null()),
    version: v.string(),
    inputParameters: v.any(),
  })),
  handler: async (ctx, args) => {
    const identity = await requireApprovedIdentity(ctx);
    void identity;
    const toolkit = normalizeToolkit(args.toolkit);
    const policy = readComposioPolicy();
    const toolkitPolicy = requireAllowedComposioTool(policy, toolkit);
    const composio = createComposio(toolkit, toolkitPolicy.version);
    const definitions = await Promise.all(toolkitPolicy.tools.map((slug) =>
      composio.tools.getRawComposioToolBySlug(slug, { version: toolkitPolicy.version }),
    ));
    return definitions.map((definition) => ({
      toolkit,
      slug: definition.slug,
      name: definition.name,
      description: definition.description ?? null,
      version: toolkitPolicy.version,
      inputParameters: sanitizeComposioValue(definition.inputParameters ?? { type: "object", properties: {} }),
    }));
  },
});

export const status = action({
  args: {},
  returns: statusResult,
  handler: async (ctx) => {
    const identity = await requireApprovedIdentity(ctx);
    void identity;
    const policy = readComposioPolicy();
    return {
      configured: Boolean(process.env.COMPOSIO_API_KEY?.trim()) && Object.keys(policy).length > 0,
      toolkits: Object.entries(policy).map(([toolkit, item]) => ({ toolkit, version: item.version, tools: [...item.tools] })),
    };
  },
});

export const authorize = action({
  args: { toolkit: v.string() },
  returns: connectionResult,
  handler: async (ctx, args) => {
    const identity = await requireApprovedIdentity(ctx);
    const toolkit = normalizeToolkit(args.toolkit);
    const policy = readComposioPolicy();
    const toolkitPolicy = requireAllowedComposioTool(policy, toolkit);
    const session = await createSession(identity.subject, toolkit, toolkitPolicy);
    const request = await session.authorize(toolkit);
    await ctx.runMutation(internal.composioAccess.saveConnection, {
      clerkSubject: identity.subject,
      toolkit,
      sessionId: session.sessionId,
      connectedAccountId: request.id ?? null,
      status: request.status ?? "INITIATED",
    });
    return {
      toolkit,
      sessionId: session.sessionId,
      connectedAccountId: request.id ?? null,
      status: request.status ?? "INITIATED",
      redirectUrl: request.redirectUrl ?? null,
    };
  },
});

export const connection = action({
  args: { toolkit: v.string() },
  returns: connectionResult,
  handler: async (ctx, args) => {
    const identity = await requireApprovedIdentity(ctx);
    const toolkit = normalizeToolkit(args.toolkit);
    const policy = readComposioPolicy();
    const toolkitPolicy = requireAllowedComposioTool(policy, toolkit);
    const session = await createSession(identity.subject, toolkit, toolkitPolicy);
    const states = await session.toolkits({ toolkits: [toolkit] });
    const state = states.items.find((item) => item.slug === toolkit);
    const connectedAccountId = state?.connection?.connectedAccount?.id ?? null;
    const status = state?.connection?.connectedAccount?.status ?? (state?.isNoAuth ? "ACTIVE" : "DISCONNECTED");
    await ctx.runMutation(internal.composioAccess.saveConnection, {
      clerkSubject: identity.subject,
      toolkit,
      sessionId: session.sessionId,
      connectedAccountId,
      status,
    });
    return { toolkit, sessionId: session.sessionId, connectedAccountId, status, redirectUrl: null };
  },
});

export const execute = action({
  args: {
    toolkit: v.string(),
    toolSlug: v.string(),
    arguments: v.any(),
  },
  returns: v.object({
    toolkit: v.string(),
    toolSlug: v.string(),
    durationMs: v.number(),
    logId: v.string(),
    error: v.union(v.string(), v.null()),
    data: contentResult,
  }),
  handler: async (ctx, args) => {
    const identity = await requireApprovedIdentity(ctx);
    const toolkit = normalizeToolkit(args.toolkit);
    const toolSlug = normalizeTool(args.toolSlug);
    const policy = readComposioPolicy();
    const toolkitPolicy = requireAllowedComposioTool(policy, toolkit, toolSlug);
    if (!args.arguments || typeof args.arguments !== "object" || Array.isArray(args.arguments)) {
      throw new Error("Composio tool arguments must be an object");
    }
    const session = await createSession(identity.subject, toolkit, toolkitPolicy);
    const started = Date.now();
    const result = await session.execute(toolSlug, sanitizeComposioValue(args.arguments) as Record<string, unknown>);
    const sanitizedResult = sanitizeComposioValue(result.data);
    return {
      toolkit,
      toolSlug,
      durationMs: Date.now() - started,
      logId: result.logId,
      error: result.error,
      data: {
        ...boundedComposioContent(sanitizedResult),
        sha256: createHash("sha256").update(JSON.stringify(sanitizedResult)).digest("hex"),
      },
    };
  },
});

async function requireApprovedIdentity(ctx: ActionCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthenticated");
  await ctx.runQuery(internal.composioAccess.requireApproved, { clerkSubject: identity.subject });
  return identity;
}

function requireApiKey(): string {
  const key = process.env.COMPOSIO_API_KEY?.trim();
  if (!key) throw new Error("Composio is not configured");
  return key;
}

async function createSession(
  userId: string,
  toolkit: string,
  policy: { readonly version: string; readonly tools: readonly string[] },
) {
  const composio = createComposio(toolkit, policy.version);
  return composio.sessions.create(userId, {
    sessionPreset: SessionPreset.DIRECT_TOOLS,
    toolkits: [toolkit],
    tools: { [toolkit]: [...policy.tools] },
    manageConnections: false,
    sandbox: { enable: false },
    preload: { tools: [...policy.tools] },
  });
}

function createComposio(toolkit: string, version: string): Composio {
  return new Composio({
    apiKey: requireApiKey(),
    allowTracking: false,
    disableVersionCheck: true,
    dangerouslyAllowAutoUploadDownloadFiles: false,
    fileUploadDirs: false,
    toolkitVersions: { [toolkit]: version },
    host: "studi-convex",
  });
}

function normalizeToolkit(value: string): string {
  const normalized = value.trim().toLocaleLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(normalized)) throw new Error("Invalid Composio toolkit");
  return normalized;
}

function normalizeTool(value: string): string {
  const normalized = value.trim().toLocaleUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_]{0,255}$/.test(normalized)) throw new Error("Invalid Composio tool");
  return normalized;
}
