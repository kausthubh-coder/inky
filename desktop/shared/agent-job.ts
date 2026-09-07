import { z } from "zod";

import { IsoTimestampSchema } from "./schema-version.js";

const AgentIdentifierSchema = z.string().trim().min(1).max(256);

export const AgentTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("home") }),
  z.strictObject({ kind: z.literal("assignment"), assignmentId: AgentIdentifierSchema }),
  z.strictObject({ kind: z.literal("scan"), scanId: AgentIdentifierSchema }),
  z.strictObject({ kind: z.literal("tutor") }),
]);

export const ConversationTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("home") }),
  z.strictObject({ kind: z.literal("assignment"), assignmentId: AgentIdentifierSchema }),
]);

export const AgentJobPhaseSchema = z.enum([
  "idle",
  "conversing",
  "acquiring",
  "working",
  "needs_user",
  "review",
  "completed",
  "failed",
  "aborted",
  "not_supported",
]);

export const BrowserClaimSchema = z.strictObject({
  claimId: AgentIdentifierSchema,
  jobId: AgentIdentifierSchema,
  target: AgentTargetSchema,
  acquiredAt: IsoTimestampSchema,
  revision: z.number().int().positive(),
});

export const AssignmentReferenceSchema = z.strictObject({ assignmentId: AgentIdentifierSchema, title: z.string().min(1).max(1000) });
export type AssignmentReference = z.infer<typeof AssignmentReferenceSchema>;

export const AgentMessageSchema = z.strictObject({
  messageId: AgentIdentifierSchema,
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1).max(100_000),
  createdAt: IsoTimestampSchema,
  turnIndex: z.number().int().nonnegative(),
  clientMessageId: z.string().uuid().optional(),
  assignmentRefs: z.array(AssignmentReferenceSchema).max(20).optional(),
  recovery: z.enum(["failed","aborted"]).optional(),
});

export const AgentJobSchema = z.strictObject({
  ownerSubject: AgentIdentifierSchema.optional(),
  schemaVersion: z.literal(1),
  jobId: AgentIdentifierSchema,
  target: AgentTargetSchema,
  phase: AgentJobPhaseSchema,
  turnIndex: z.number().int().nonnegative(),
  runId: AgentIdentifierSchema,
  sessionId: AgentIdentifierSchema.nullable(),
  claim: BrowserClaimSchema.nullable(),
  messages: z.array(AgentMessageSchema),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});

export const AddressedSendResultSchema = z.strictObject({
  outcome: z.enum(["completed", "failed", "aborted"]),
  text: z.string(),
  job: AgentJobSchema,
});

export const SelectedConversationSchema = z.strictObject({
  target: ConversationTargetSchema,
  job: AgentJobSchema,
});

export type AgentTarget = z.infer<typeof AgentTargetSchema>;
export type ConversationTarget = z.infer<typeof ConversationTargetSchema>;
export type AgentJobPhase = z.infer<typeof AgentJobPhaseSchema>;
export type BrowserClaim = z.infer<typeof BrowserClaimSchema>;
export type AgentMessage = z.infer<typeof AgentMessageSchema>;
export type AgentJob = z.infer<typeof AgentJobSchema>;
export type AddressedSendResult = z.infer<typeof AddressedSendResultSchema>;
export type SelectedConversation = z.infer<typeof SelectedConversationSchema>;

export const ConversationStateSchema = z.strictObject({ job: AgentJobSchema, activity: z.enum(['idle','thinking','typing']) });
export type ConversationState = z.infer<typeof ConversationStateSchema>;
