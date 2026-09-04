import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server.js";

export const requireApproved = internalQuery({
  args: { clerkSubject: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const access = await ctx.db
      .query("betaAccess")
      .withIndex("by_clerk_subject", (query) => query.eq("clerkSubject", args.clerkSubject))
      .unique();
    if (!access?.approved) throw new Error("Approved beta access required");
    return null;
  },
});

export const saveConnection = internalMutation({
  args: {
    clerkSubject: v.string(),
    toolkit: v.string(),
    sessionId: v.string(),
    connectedAccountId: v.union(v.string(), v.null()),
    status: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await ctx.db
      .query("composioConnections")
      .withIndex("by_clerk_subject_and_toolkit", (query) =>
        query.eq("clerkSubject", args.clerkSubject).eq("toolkit", args.toolkit),
      )
      .unique();
    const now = Date.now();
    if (current) {
      await ctx.db.patch(current._id, {
        sessionId: args.sessionId,
        connectedAccountId: args.connectedAccountId,
        status: args.status,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("composioConnections", { ...args, createdAt: now, updatedAt: now });
    }
    return null;
  },
});

