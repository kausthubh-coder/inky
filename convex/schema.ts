import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  accounts: defineTable({
    clerkSubject: v.string(),
    email: v.union(v.string(), v.null()),
    name: v.union(v.string(), v.null()),
    createdAt: v.number(),
    lastSeenAt: v.number(),
  }).index("by_clerk_subject", ["clerkSubject"]),

  betaAccess: defineTable({
    clerkSubject: v.string(),
    approved: v.boolean(),
    reason: v.union(v.literal("approved"), v.literal("waitlist"), v.literal("revoked")),
    updatedAt: v.number(),
    updatedBy: v.string(),
  }).index("by_clerk_subject", ["clerkSubject"]),

  entitlements: defineTable({
    clerkSubject: v.string(),
    plan: v.union(v.literal("beta"), v.literal("supporter")),
    credits: v.number(),
    updatedAt: v.number(),
  }).index("by_clerk_subject", ["clerkSubject"]),

  usageSummary: defineTable({
    clerkSubject: v.string(),
    period: v.string(),
    category: v.union(
      v.literal("agent_tokens"),
      v.literal("browser_minutes"),
      v.literal("assignments"),
    ),
    amount: v.number(),
    updatedAt: v.number(),
  }).index("by_clerk_subject_and_period_and_category", [
    "clerkSubject",
    "period",
    "category",
  ]),

  feedback: defineTable({
    clerkSubject: v.string(),
    feedbackId: v.string(),
    message: v.string(),
    createdAt: v.number(),
  })
    .index("by_clerk_subject_and_created_at", ["clerkSubject", "createdAt"])
    .index("by_feedback_id", ["feedbackId"]),

  activeDevices: defineTable({
    clerkSubject: v.string(),
    deviceId: v.string(),
    registeredAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_clerk_subject", ["clerkSubject"])
    .index("by_device_id", ["deviceId"]),

  composioConnections: defineTable({
    clerkSubject: v.string(),
    toolkit: v.string(),
    sessionId: v.string(),
    connectedAccountId: v.union(v.string(), v.null()),
    status: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerk_subject_and_toolkit", ["clerkSubject", "toolkit"])
    .index("by_connected_account_id", ["connectedAccountId"]),

  waitlistEmails: defineTable({
    email: v.string(),
    createdAt: v.number(),
  }).index("by_email", ["email"]),
});
