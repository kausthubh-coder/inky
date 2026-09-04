import { z } from "zod";
import {
  AgentJobPhaseSchema,
  AgentJobSchema,
  AgentMessageSchema,
  AgentTargetSchema,
  BrowserClaimSchema,
  type AgentJob,
  type AgentJobPhase,
  type AgentMessage,
  type AgentTarget,
  type BrowserClaim,
} from "../shared/agent-job.js";

export {
  AgentJobPhaseSchema,
  AgentJobSchema,
  AgentMessageSchema,
  AgentTargetSchema,
  BrowserClaimSchema,
};

const IdSchema = z.string().trim().min(1).max(256);

export const HarnessCommandSchema = z.discriminatedUnion("command", [
  z.strictObject({ command: z.literal("send"), target: AgentTargetSchema, text: z.string().trim().min(1).max(100_000) }),
  z.strictObject({ command: z.literal("start_assignment"), assignmentId: IdSchema }),
  z.strictObject({ command: z.literal("start_scan"), scanId: IdSchema }),
  z.strictObject({ command: z.literal("inspect") }),
  z.strictObject({ command: z.literal("restart") }),
  z.strictObject({ command: z.literal("abort") }),
  z.strictObject({ command: z.literal("quit") }),
]);

export const HarnessCommandNameSchema = z.enum([
  "send",
  "start_assignment",
  "start_scan",
  "inspect",
  "restart",
  "abort",
  "quit",
]);

export const AgentHostSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  activeJobId: IdSchema.nullable(),
  jobs: z.array(AgentJobSchema),
  browserClaim: BrowserClaimSchema.nullable(),
});

export const HarnessReplySchema = z.strictObject({
  schemaVersion: z.literal(1),
  ok: z.boolean(),
  command: HarnessCommandNameSchema,
  state: AgentHostSnapshotSchema,
  reply: z.string().optional(),
  error: z.string().optional(),
  toolNames: z.array(z.string().min(1)).optional(),
  traceId: IdSchema.optional(),
  quit: z.boolean().optional(),
});

export type { AgentTarget, AgentJobPhase, BrowserClaim, AgentMessage, AgentJob };
export type HarnessCommand = z.infer<typeof HarnessCommandSchema>;
export type AgentHostSnapshot = z.infer<typeof AgentHostSnapshotSchema>;
export type HarnessReply = z.infer<typeof HarnessReplySchema>;
