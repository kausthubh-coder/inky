import { v } from "convex/values";
import { internalAction } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { admissionDecision, clerkUserSchema, verifiedPrimaryEmail, waitlistPageSchema } from "./clerkAdmission.js";

async function clerkGet(path: string): Promise<Response> {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("Clerk admission sync is not configured");
  const response = await fetch(`https://api.clerk.com/v1${path}`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok && response.status !== 404) throw new Error(`Clerk admission lookup failed (${response.status})`);
  return response;
}

export const reconcile = internalAction({
  args: { subject: v.string(), requestedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const response = await clerkGet(`/users/${encodeURIComponent(args.subject)}`);
    if (response.status === 404) {
      await ctx.runMutation(internal.accessSync.apply, { ...args, decision: "revoked" });
      return null;
    }
    const user = clerkUserSchema.parse(await response.json());
    if (user.id !== args.subject) throw new Error("Clerk admission identity mismatch");
    const email = verifiedPrimaryEmail(user);
    const entries = [] as ReturnType<typeof waitlistPageSchema.parse>["data"];
    if (email && !user.banned && !user.locked) {
      // Clerk's query is fuzzy. Paginate it, then require an exact verified email.
      for (let offset = 0; offset < 1_000; offset += 100) {
        const response = await clerkGet(`/waitlist_entries?${new URLSearchParams({ query: email, limit: "100", offset: String(offset) })}`);
        if (!response.ok) throw new Error("Clerk waitlist lookup unavailable");
        const page = waitlistPageSchema.parse(await response.json());
        entries.push(...page.data);
        if (offset + page.data.length >= page.total_count) break;
        if (page.data.length === 0 || offset === 900) throw new Error("Clerk admission lookup exceeded its page limit");
      }
    }
    await ctx.runMutation(internal.accessSync.apply, { ...args, decision: admissionDecision(user, entries) });
    return null;
  },
});
