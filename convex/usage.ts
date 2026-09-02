import { v } from "convex/values";
import { mutation } from "./_generated/server.js";
import { requireIdentity } from "./identity.js";

export const add = mutation({
  args: {
    deviceId: v.string(),
    period: v.string(),
    category: v.union(
      v.literal("agent_tokens"),
      v.literal("browser_minutes"),
      v.literal("assignments"),
    ),
    amount: v.number(),
  },
  returns: v.object({ amount: v.number() }),
  handler: async (ctx, args) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.period) || !Number.isInteger(args.amount) || args.amount <= 0) {
      throw new Error("Invalid aggregate usage input");
    }
    const identity = await requireIdentity(ctx);
    const access = await ctx.db
      .query("betaAccess")
      .withIndex("by_clerk_subject", (query) => query.eq("clerkSubject", identity.subject))
      .unique();
    const device = await ctx.db
      .query("activeDevices")
      .withIndex("by_clerk_subject", (query) => query.eq("clerkSubject", identity.subject))
      .unique();
    if (!access?.approved || device?.deviceId !== args.deviceId) throw new Error("Approved active device required");
    const summary = await ctx.db
      .query("usageSummary")
      .withIndex("by_clerk_subject_and_period_and_category", (query) =>
        query
          .eq("clerkSubject", identity.subject)
          .eq("period", args.period)
          .eq("category", args.category),
      )
      .unique();
    const amount = (summary?.amount ?? 0) + args.amount;
    if (summary) await ctx.db.patch(summary._id, { amount, updatedAt: Date.now() });
    else {
      await ctx.db.insert("usageSummary", {
        clerkSubject: identity.subject,
        period: args.period,
        category: args.category,
        amount,
        updatedAt: Date.now(),
      });
    }
    return { amount };
  },
});
