import { v } from "convex/values";
import { mutation } from "./_generated/server.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export const join = mutation({
  args: { email: v.string() },
  returns: v.object({ alreadyJoined: v.boolean() }),
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    if (email.length < 5 || email.length > 320 || !emailPattern.test(email)) {
      throw new Error("Enter a real email address");
    }

    const existing = await ctx.db
      .query("waitlistEmails")
      .withIndex("by_email", (query) => query.eq("email", email))
      .unique();
    if (existing) return { alreadyJoined: true };

    await ctx.db.insert("waitlistEmails", {
      email,
      createdAt: Date.now(),
    });
    return { alreadyJoined: false };
  },
});
