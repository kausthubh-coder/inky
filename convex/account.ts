import { v } from "convex/values";
import { mutation } from "./_generated/server.js";
import { nullableText, requireIdentity } from "./identity.js";

const accountResult = v.object({
  subject: v.string(),
  email: v.union(v.string(), v.null()),
  name: v.union(v.string(), v.null()),
  approved: v.boolean(),
  reason: v.union(v.literal("waitlist"), v.literal("device_conflict"), v.null()),
  plan: v.union(v.literal("beta"), v.literal("supporter"), v.null()),
  credits: v.union(v.number(), v.null()),
  checkedAt: v.number(),
});

export const bootstrap = mutation({
  args: { deviceId: v.string() },
  returns: accountResult,
  handler: async (ctx, { deviceId }) => {
    if (!isUuid(deviceId)) throw new Error("Invalid device identifier");
    const identity = await requireIdentity(ctx);
    const subject = identity.subject;
    const now = Date.now();
    const email = nullableText(identity.email);
    const name = nullableText(identity.name);
    const account = await ctx.db
      .query("accounts")
      .withIndex("by_clerk_subject", (query) => query.eq("clerkSubject", subject))
      .unique();
    if (account) {
      await ctx.db.patch(account._id, { email, name, lastSeenAt: now });
    } else {
      await ctx.db.insert("accounts", {
        clerkSubject: subject,
        email,
        name,
        createdAt: now,
        lastSeenAt: now,
      });
    }

    let access = await ctx.db
      .query("betaAccess")
      .withIndex("by_clerk_subject", (query) => query.eq("clerkSubject", subject))
      .unique();
    if (!access && process.env.STUDI_BETA_ADMIN_SUBJECT === subject) {
      const accessId = await ctx.db.insert("betaAccess", {
        clerkSubject: subject,
        approved: true,
        reason: "approved",
        updatedAt: now,
        updatedBy: subject,
      });
      access = await ctx.db.get(accessId);
    }
    if (!access?.approved) {
      return { subject, email, name, approved: false, reason: "waitlist" as const, plan: null, credits: null, checkedAt: now };
    }

    const activeDevice = await ctx.db
      .query("activeDevices")
      .withIndex("by_clerk_subject", (query) => query.eq("clerkSubject", subject))
      .unique();
    if (activeDevice && activeDevice.deviceId !== deviceId) {
      return { subject, email, name, approved: false, reason: "device_conflict" as const, plan: null, credits: null, checkedAt: now };
    }
    if (activeDevice) {
      await ctx.db.patch(activeDevice._id, { lastSeenAt: now });
    } else {
      await ctx.db.insert("activeDevices", {
        clerkSubject: subject,
        deviceId,
        registeredAt: now,
        lastSeenAt: now,
      });
    }

    let entitlement = await ctx.db
      .query("entitlements")
      .withIndex("by_clerk_subject", (query) => query.eq("clerkSubject", subject))
      .unique();
    if (!entitlement) {
      const entitlementId = await ctx.db.insert("entitlements", {
        clerkSubject: subject,
        plan: "beta",
        credits: 0,
        updatedAt: now,
      });
      entitlement = await ctx.db.get(entitlementId);
    }
    if (!entitlement) throw new Error("Entitlement write failed");
    return {
      subject,
      email,
      name,
      approved: true,
      reason: null,
      plan: entitlement.plan,
      credits: entitlement.credits,
      checkedAt: now,
    };
  },
});

export const setBetaAccess = mutation({
  args: {
    subject: v.string(),
    approved: v.boolean(),
    plan: v.union(v.literal("beta"), v.literal("supporter")),
    credits: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    if (!process.env.STUDI_BETA_ADMIN_SUBJECT || identity.subject !== process.env.STUDI_BETA_ADMIN_SUBJECT) {
      throw new Error("Admin access required");
    }
    if (!args.subject || args.subject.length > 256 || !Number.isInteger(args.credits) || args.credits < 0) {
      throw new Error("Invalid beta access input");
    }
    const now = Date.now();
    const access = await ctx.db
      .query("betaAccess")
      .withIndex("by_clerk_subject", (query) => query.eq("clerkSubject", args.subject))
      .unique();
    const accessValue = {
      clerkSubject: args.subject,
      approved: args.approved,
      reason: args.approved ? "approved" as const : "revoked" as const,
      updatedAt: now,
      updatedBy: identity.subject,
    };
    if (access) await ctx.db.patch(access._id, accessValue);
    else await ctx.db.insert("betaAccess", accessValue);

    const entitlement = await ctx.db
      .query("entitlements")
      .withIndex("by_clerk_subject", (query) => query.eq("clerkSubject", args.subject))
      .unique();
    const entitlementValue = {
      clerkSubject: args.subject,
      plan: args.plan,
      credits: args.credits,
      updatedAt: now,
    };
    if (entitlement) await ctx.db.patch(entitlement._id, entitlementValue);
    else await ctx.db.insert("entitlements", entitlementValue);

    if (!args.approved) {
      const activeDevice = await ctx.db
        .query("activeDevices")
        .withIndex("by_clerk_subject", (query) => query.eq("clerkSubject", args.subject))
        .unique();
      if (activeDevice) await ctx.db.delete(activeDevice._id);
    }
    return null;
  },
});

export const releaseDevice = mutation({
  args: { deviceId: v.string() },
  returns: v.null(),
  handler: async (ctx, { deviceId }) => {
    if (!isUuid(deviceId)) throw new Error("Invalid device identifier");
    const identity = await requireIdentity(ctx);
    const activeDevice = await ctx.db
      .query("activeDevices")
      .withIndex("by_clerk_subject", (query) => query.eq("clerkSubject", identity.subject))
      .unique();
    if (activeDevice?.deviceId === deviceId) await ctx.db.delete(activeDevice._id);
    return null;
  },
});

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
