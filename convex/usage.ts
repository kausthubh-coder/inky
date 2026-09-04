import { v } from "convex/values";

import { mutation, query } from "./_generated/server.js";
import { requireIdentity } from "./identity.js";

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const dayPattern = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const tokenAllowance = { beta: 1_000_000, supporter: 5_000_000 } as const;
const usageCategory = v.union(
  v.literal("agent_tokens"),
  v.literal("browser_minutes"),
  v.literal("assignments"),
  v.literal("input_tokens"),
  v.literal("output_tokens"),
  v.literal("cached_tokens"),
  v.literal("tool_calls"),
  v.literal("inky_turns"),
);
const usageDay = v.object({ date: v.string(), tokens: v.number() });
const usageState = v.object({
  schemaVersion: v.literal(1),
  period: v.string(),
  plan: v.union(v.literal("beta"), v.literal("supporter")),
  tokenAllowance: v.number(),
  totalTokens: v.number(),
  inputTokens: v.number(),
  outputTokens: v.number(),
  cachedTokens: v.number(),
  toolCalls: v.number(),
  inkyTurns: v.number(),
  assignmentsWorked: v.number(),
  days: v.array(usageDay),
  updatedAt: v.union(v.string(), v.null()),
});

export const current = query({
  args: { period: v.string(), throughDate: v.string() },
  returns: usageState,
  handler: async (ctx, args) => {
    if (!monthPattern.test(args.period) || !dayPattern.test(args.throughDate) || !args.throughDate.startsWith(`${args.period}-`)) {
      throw new Error("Invalid usage period");
    }
    const identity = await requireIdentity(ctx);
    const [entitlement, monthly, daily] = await Promise.all([
      ctx.db
        .query("entitlements")
        .withIndex("by_clerk_subject", (q) => q.eq("clerkSubject", identity.subject))
        .unique(),
      ctx.db
        .query("usageSummary")
        .withIndex("by_clerk_subject_and_period_and_category", (q) =>
          q.eq("clerkSubject", identity.subject).eq("period", args.period),
        )
        .take(16),
      ctx.db
        .query("usageSummary")
        .withIndex("by_clerk_subject_and_period_and_category", (q) =>
          q.eq("clerkSubject", identity.subject).gte("period", `${args.period}-01`).lte("period", args.throughDate),
        )
        .take(256),
    ]);
    if (!entitlement) throw new Error("Approved entitlement required");

    const amount = (category: typeof monthly[number]["category"]) =>
      monthly.find((entry) => entry.category === category)?.amount ?? 0;
    const lastDay = Number(args.throughDate.slice(-2));
    const dailyTokens = new Map(
      daily.filter((entry) => entry.category === "agent_tokens").map((entry) => [entry.period, entry.amount]),
    );
    const updatedAt = monthly.reduce<number | null>(
      (latest, entry) => latest === null || entry.updatedAt > latest ? entry.updatedAt : latest,
      null,
    );

    return {
      schemaVersion: 1 as const,
      period: args.period,
      plan: entitlement.plan,
      tokenAllowance: tokenAllowance[entitlement.plan],
      totalTokens: amount("agent_tokens"),
      inputTokens: amount("input_tokens"),
      outputTokens: amount("output_tokens"),
      cachedTokens: amount("cached_tokens"),
      toolCalls: amount("tool_calls"),
      inkyTurns: amount("inky_turns"),
      assignmentsWorked: amount("assignments"),
      days: Array.from({ length: lastDay }, (_, index) => {
        const date = `${args.period}-${String(index + 1).padStart(2, "0")}`;
        return { date, tokens: dailyTokens.get(date) ?? 0 };
      }),
      updatedAt: updatedAt === null ? null : new Date(updatedAt).toISOString(),
    };
  },
});

export const record = mutation({
  args: {
    deviceId: v.string(),
    eventId: v.string(),
    occurredAt: v.number(),
    kind: v.union(
      v.literal("conversation"),
      v.literal("scan"),
      v.literal("assignment_turn"),
      v.literal("assignment_worked"),
    ),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cacheReadTokens: v.number(),
    cacheWriteTokens: v.number(),
    toolCalls: v.number(),
  },
  returns: v.object({ recorded: v.boolean() }),
  handler: async (ctx, args) => {
    const counts = [args.inputTokens, args.outputTokens, args.cacheReadTokens, args.cacheWriteTokens, args.toolCalls];
    if (
      args.eventId.length < 1 || args.eventId.length > 256 ||
      !Number.isFinite(args.occurredAt) ||
      counts.some((count) => !Number.isInteger(count) || count < 0) ||
      args.toolCalls > 100_000 || counts.slice(0, 4).some((count) => count > 100_000_000)
    ) {
      throw new Error("Invalid aggregate usage event");
    }
    const occurred = new Date(args.occurredAt);
    if (Number.isNaN(occurred.valueOf())) throw new Error("Invalid usage event time");
    const period = occurred.toISOString().slice(0, 7);
    const day = occurred.toISOString().slice(0, 10);
    const identity = await requireIdentity(ctx);
    const [access, device] = await Promise.all([
      ctx.db.query("betaAccess").withIndex("by_clerk_subject", (q) => q.eq("clerkSubject", identity.subject)).unique(),
      ctx.db.query("activeDevices").withIndex("by_clerk_subject", (q) => q.eq("clerkSubject", identity.subject)).unique(),
    ]);
    if (!access?.approved || device?.deviceId !== args.deviceId) throw new Error("Approved active device required");
    const existing = await ctx.db
      .query("usageReceipts")
      .withIndex("by_clerk_subject_and_event_id", (q) => q.eq("clerkSubject", identity.subject).eq("eventId", args.eventId))
      .unique();
    if (existing) return { recorded: false };

    const totalTokens = args.inputTokens + args.outputTokens + args.cacheReadTokens + args.cacheWriteTokens;
    const increments = [
      ["agent_tokens", totalTokens],
      ["input_tokens", args.inputTokens],
      ["output_tokens", args.outputTokens],
      ["cached_tokens", args.cacheReadTokens + args.cacheWriteTokens],
      ["tool_calls", args.toolCalls],
      ["inky_turns", args.kind === "conversation" ? 1 : 0],
      ["assignments", args.kind === "assignment_worked" ? 1 : 0],
    ] as const;
    const now = Date.now();
    await ctx.db.insert("usageReceipts", { clerkSubject: identity.subject, eventId: args.eventId, recordedAt: now });
    for (const [category, increment] of increments) {
      if (increment === 0) continue;
      const summary = await ctx.db
        .query("usageSummary")
        .withIndex("by_clerk_subject_and_period_and_category", (q) =>
          q.eq("clerkSubject", identity.subject).eq("period", period).eq("category", category),
        )
        .unique();
      if (summary) await ctx.db.patch(summary._id, { amount: summary.amount + increment, updatedAt: now });
      else await ctx.db.insert("usageSummary", { clerkSubject: identity.subject, period, category, amount: increment, updatedAt: now });
    }
    if (totalTokens > 0) {
      const daily = await ctx.db
        .query("usageSummary")
        .withIndex("by_clerk_subject_and_period_and_category", (q) =>
          q.eq("clerkSubject", identity.subject).eq("period", day).eq("category", "agent_tokens"),
        )
        .unique();
      if (daily) await ctx.db.patch(daily._id, { amount: daily.amount + totalTokens, updatedAt: now });
      else await ctx.db.insert("usageSummary", { clerkSubject: identity.subject, period: day, category: "agent_tokens", amount: totalTokens, updatedAt: now });
    }
    return { recorded: true };
  },
});

export const add = mutation({
  args: { deviceId: v.string(), period: v.string(), category: usageCategory, amount: v.number() },
  returns: v.object({ amount: v.number() }),
  handler: async (ctx, args) => {
    if (!monthPattern.test(args.period) || !Number.isInteger(args.amount) || args.amount <= 0) {
      throw new Error("Invalid aggregate usage input");
    }
    const identity = await requireIdentity(ctx);
    const [access, device] = await Promise.all([
      ctx.db.query("betaAccess").withIndex("by_clerk_subject", (q) => q.eq("clerkSubject", identity.subject)).unique(),
      ctx.db.query("activeDevices").withIndex("by_clerk_subject", (q) => q.eq("clerkSubject", identity.subject)).unique(),
    ]);
    if (!access?.approved || device?.deviceId !== args.deviceId) throw new Error("Approved active device required");
    const summary = await ctx.db
      .query("usageSummary")
      .withIndex("by_clerk_subject_and_period_and_category", (q) =>
        q.eq("clerkSubject", identity.subject).eq("period", args.period).eq("category", args.category),
      )
      .unique();
    const amount = (summary?.amount ?? 0) + args.amount;
    if (summary) await ctx.db.patch(summary._id, { amount, updatedAt: Date.now() });
    else await ctx.db.insert("usageSummary", { clerkSubject: identity.subject, period: args.period, category: args.category, amount, updatedAt: Date.now() });
    return { amount };
  },
});
