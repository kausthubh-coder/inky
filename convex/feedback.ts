import { v } from "convex/values";
import { mutation } from "./_generated/server.js";
import { requireIdentity } from "./identity.js";

export const submit = mutation({
  args: { deviceId: v.string(), feedbackId: v.string(), message: v.string() },
  returns: v.object({ accepted: v.literal(true), feedbackId: v.string() }),
  handler: async (ctx, args) => {
    if (!isUuid(args.deviceId) || !isUuid(args.feedbackId)) throw new Error("Invalid feedback input");
    const message = args.message.trim();
    if (!message || message.length > 1_000) throw new Error("Feedback must be 1 to 1000 characters");
    const identity = await requireIdentity(ctx);
    const duplicate = await ctx.db
      .query("feedback")
      .withIndex("by_feedback_id", (query) => query.eq("feedbackId", args.feedbackId))
      .unique();
    if (!duplicate) {
      await ctx.db.insert("feedback", {
        clerkSubject: identity.subject,
        feedbackId: args.feedbackId,
        message,
        source: "desktop",
        createdAt: Date.now(),
      });
    }
    return { accepted: true as const, feedbackId: args.feedbackId };
  },
});

export const submitWeb = mutation({
  args: { feedbackId: v.string(), message: v.string() },
  returns: v.object({ accepted: v.literal(true), feedbackId: v.string() }),
  handler: async (ctx, args) => {
    if (!isUuid(args.feedbackId)) throw new Error("Invalid feedback input");
    const message = args.message.trim();
    if (!message || message.length > 1_000) throw new Error("Feedback must be 1 to 1000 characters");
    const identity = await requireIdentity(ctx);
    const duplicate = await ctx.db
      .query("feedback")
      .withIndex("by_feedback_id", (query) => query.eq("feedbackId", args.feedbackId))
      .unique();
    if (!duplicate) {
      await ctx.db.insert("feedback", {
        clerkSubject: identity.subject,
        feedbackId: args.feedbackId,
        message,
        source: "web",
        createdAt: Date.now(),
      });
    }
    return { accepted: true as const, feedbackId: args.feedbackId };
  },
});

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
