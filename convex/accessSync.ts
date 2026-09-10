import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server.js";
import type { Doc } from "./_generated/dataModel.js";

const decision = v.union(v.literal("approved"), v.literal("waitlist"), v.literal("revoked"));

// Called inside the same transaction that creates/updates the signed-in account.
export async function requestAccessSync(ctx: MutationCtx, account: Doc<"accounts">): Promise<void> {
  const now = Date.now();
  if (account.accessSyncRequestedAt && now - account.accessSyncRequestedAt < 60_000) return;
  await ctx.db.patch(account._id, { accessSyncRequestedAt: now });
  await ctx.scheduler.runAfter(0, internal.clerkAccess.reconcile, { subject: account.clerkSubject, requestedAt: now });
}

export const apply = internalMutation({
  args: { subject: v.string(), requestedAt: v.number(), decision },
  returns: v.null(),
  handler: async (ctx, args) => {
    const account = await ctx.db.query("accounts").withIndex("by_clerk_subject", (q) => q.eq("clerkSubject", args.subject)).unique();
    if (!account || account.accessSyncRequestedAt !== args.requestedAt) return null;
    const access = await ctx.db.query("betaAccess").withIndex("by_clerk_subject", (q) => q.eq("clerkSubject", args.subject)).unique();
    // A manual revocation must never be undone by an old Clerk invitation.
    if (access?.reason === "revoked" && access.updatedBy !== "clerk") return null;
    if (access && access.updatedAt > args.requestedAt) return null;
    const approved = args.decision === "approved";
    const now = Date.now();
    const value = { clerkSubject: args.subject, approved, reason: args.decision, updatedAt: now, updatedBy: "clerk" };
    if (access) await ctx.db.patch(access._id, value);
    else await ctx.db.insert("betaAccess", value);
    if (approved) {
      const entitlement = await ctx.db.query("entitlements").withIndex("by_clerk_subject", (q) => q.eq("clerkSubject", args.subject)).unique();
      if (!entitlement) await ctx.db.insert("entitlements", { clerkSubject: args.subject, plan: "beta", credits: 0, updatedAt: now });
    } else {
      const device = await ctx.db.query("activeDevices").withIndex("by_clerk_subject", (q) => q.eq("clerkSubject", args.subject)).unique();
      if (device) await ctx.db.delete(device._id);
    }
    return null;
  },
});

export const reconcileAccounts = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("accounts").paginate({ cursor, numItems: 10 });
    for (const account of page.page) await requestAccessSync(ctx, account);
    if (!page.isDone) await ctx.scheduler.runAfter(15_000, internal.accessSync.reconcileAccounts, { cursor: page.continueCursor });
    return null;
  },
});

export const status = internalQuery({
  args: { subject: v.string() },
  returns: v.object({ approved: v.boolean(), reason: v.union(decision, v.null()), plan: v.union(v.literal("beta"), v.literal("supporter"), v.null()) }),
  handler: async (ctx, { subject }) => {
    const access = await ctx.db.query("betaAccess").withIndex("by_clerk_subject", (q) => q.eq("clerkSubject", subject)).unique();
    const entitlement = await ctx.db.query("entitlements").withIndex("by_clerk_subject", (q) => q.eq("clerkSubject", subject)).unique();
    return { approved: access?.approved ?? false, reason: access?.reason ?? null, plan: entitlement?.plan ?? null };
  },
});
