import { z } from "zod";

import { ManagerStateSchema } from "./manager.js";
import { TaskIdSchema } from "./ids.js";
import { SafeSourceTargetSchema } from "./ids.js";
import { IsoTimestampSchema, SchemaVersionSchema } from "./schema-version.js";

export const AutomationScheduleSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  scheduleId: z.literal("school-scan"),
  cadence: z.enum(["manual", "daily", "weekly"]),
  state: z.enum(["enabled", "paused"]),
  timezone: z.string().min(1).max(100),
  localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  weekday: z.number().int().min(0).max(6).optional(),
  nextRunAt: IsoTimestampSchema.optional(),
  lastClaimedOccurrence: IsoTimestampSchema.optional(),
  updatedAt: IsoTimestampSchema,
}).superRefine((schedule, context) => {
  if (schedule.cadence === "weekly" && schedule.weekday === undefined) {
    context.addIssue({ code: "custom", path: ["weekday"], message: "Weekly schedules require a weekday" });
  }
  if (schedule.cadence !== "weekly" && schedule.weekday !== undefined) {
    context.addIssue({ code: "custom", path: ["weekday"], message: "Only weekly schedules use a weekday" });
  }
  if (schedule.cadence === "manual" && schedule.nextRunAt !== undefined) {
    context.addIssue({ code: "custom", path: ["nextRunAt"], message: "Manual schedules do not have a next run" });
  }
});

export const BrowserCheckpointSchema = z.strictObject({
  revision: z.number().int().positive(),
  url: SafeSourceTargetSchema,
  title: z.string().max(500),
  capturedAt: IsoTimestampSchema,
  summary: z.string().trim().min(1).max(2_000),
});

export const ExecutionAttemptSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  taskId: TaskIdSchema,
  ordinal: z.number().int().min(1).max(2),
  plan: z.string().trim().min(1).max(1_000),
  result: z.string().trim().min(1).max(1_000),
  evidence: BrowserCheckpointSchema,
  recordedAt: IsoTimestampSchema,
});

export const CompletionRequirementSchema = z.strictObject({
  requirement: z.string().trim().min(1).max(500),
  evidence: z.string().trim().min(1).max(1_000),
});

export const AssignmentExecutionSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  taskId: TaskIdSchema,
  assignmentId: z.string().min(1).max(256),
  phase: z.enum([
    "working",
    "needs_user",
    "ready_review",
    "submitting",
    "submitted",
    "preserved",
    "failed",
  ]),
  taskBudget: z.strictObject({
    maxAgentTurns: z.number().int().min(2).max(24),
    maxRecoveryAttempts: z.literal(2),
  }),
  turnCount: z.number().int().min(0).max(24).default(0),
  attemptCount: z.number().int().min(0).max(2),
  returnPredicate: z.string().trim().min(1).max(1_000).optional(),
  reviewDeadline: IsoTimestampSchema.optional(),
  handoffDeadline: IsoTimestampSchema.optional(),
  reviewCheckpoint: BrowserCheckpointSchema.optional(),
  answerSnapshot: z.string().trim().min(1).max(20_000).optional(),
  completionChecklist: z.array(CompletionRequirementSchema).min(1).max(100).optional(),
  answerArtifactId: z.string().min(1).max(128).optional(),
  submissionReceiptId: z.string().min(1).max(256).optional(),
  submissionAttemptedAt: IsoTimestampSchema.optional(),
  workerSessionPath: z.string().min(1).optional(),
  lastError: z.string().trim().min(1).max(2_000).optional(),
  updatedAt: IsoTimestampSchema,
}).superRefine((execution, context) => {
  if (execution.phase === "ready_review" && (!execution.reviewDeadline || !execution.answerSnapshot || !execution.reviewCheckpoint)) {
    context.addIssue({ code: "custom", message: "Review-ready work requires answers and a deadline" });
  }
  if (execution.phase === "preserved" && !execution.answerArtifactId) {
    context.addIssue({ code: "custom", path: ["answerArtifactId"], message: "Preserved work requires its answer artifact" });
  }
  if (execution.phase === "submitted" && !execution.submissionReceiptId) {
    context.addIssue({ code: "custom", path: ["submissionReceiptId"], message: "Submitted work requires a verified receipt" });
  }
  if (execution.phase === "submitting" && !execution.submissionAttemptedAt) {
    context.addIssue({ code: "custom", path: ["submissionAttemptedAt"], message: "Submitting work requires a durable effect checkpoint" });
  }
});

export const NotificationIntentSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  notificationId: z.string().min(1).max(256),
  kind: z.enum(["handoff", "review_ready", "scan_result", "failure"]),
  target: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("task"), id: TaskIdSchema }),
    z.strictObject({ type: z.literal("scan"), id: z.string().min(1).max(256) }),
  ]),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(500),
  createdAt: IsoTimestampSchema,
  deliveredAt: IsoTimestampSchema.optional(),
  clickedAt: IsoTimestampSchema.optional(),
});

export const SubmissionReceiptSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  receiptId: z.string().min(1).max(256),
  taskId: TaskIdSchema,
  preSubmit: BrowserCheckpointSchema,
  postSubmit: BrowserCheckpointSchema,
  verifiedStatus: z.string().trim().min(1).max(500),
  submittedAt: IsoTimestampSchema,
});

export const LifecycleStateSchema = z.strictObject({
  windowVisible: z.boolean(),
  schedule: AutomationScheduleSchema.nullable(),
  execution: AssignmentExecutionSchema.nullable(),
  attempts: z.array(ExecutionAttemptSchema),
  submissionReceipt: SubmissionReceiptSchema.nullable(),
  latestNotification: NotificationIntentSchema.nullable(),
  manager: ManagerStateSchema,
});

export type AutomationSchedule = z.infer<typeof AutomationScheduleSchema>;
export type BrowserCheckpoint = z.infer<typeof BrowserCheckpointSchema>;
export type ExecutionAttempt = z.infer<typeof ExecutionAttemptSchema>;
export type CompletionRequirement = z.infer<typeof CompletionRequirementSchema>;
export type AssignmentExecution = z.infer<typeof AssignmentExecutionSchema>;
export type NotificationIntent = z.infer<typeof NotificationIntentSchema>;
export type SubmissionReceipt = z.infer<typeof SubmissionReceiptSchema>;
export type LifecycleState = z.infer<typeof LifecycleStateSchema>;

export const LIVE_EXECUTION_PHASES = ["working", "needs_user", "ready_review", "submitting"] as const;
export type LiveExecutionPhase = (typeof LIVE_EXECUTION_PHASES)[number];

export function isLivePhase(phase: AssignmentExecution["phase"] | string | undefined): phase is LiveExecutionPhase {
  return phase !== undefined && (LIVE_EXECUTION_PHASES as readonly string[]).includes(phase);
}
