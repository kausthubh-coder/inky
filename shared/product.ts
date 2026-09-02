import { z } from "zod";

import { AgentReasoningEffortSchema, AgentRunEventSchema, DEFAULT_AGENT_MODEL_ID, DEFAULT_AGENT_REASONING_EFFORT } from "./agent-runtime.js";
import { ArtifactFrontmatterSchema, ArtifactKindSchema } from "./artifact.js";
import { AssignmentSchema } from "./assignment.js";
import { AutomationScheduleSchema, AssignmentExecutionSchema, ExecutionAttemptSchema, SubmissionReceiptSchema } from "./lifecycle.js";
import { PermissionModeSchema, PermissionResolutionSchema, PermissionRuleSchema } from "./permission.js";
import { IsoTimestampSchema, SchemaVersionSchema } from "./schema-version.js";
import { TaskEventSchema, TaskSchema } from "./task.js";
import { RunSchema } from "./run.js";

export const BrowserLayoutModeSchema = z.enum(["hidden", "onboarding", "desk"]);
export type BrowserLayoutMode = z.infer<typeof BrowserLayoutModeSchema>;

export const ProductPreferencesSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  reviewMinutes: z.number().int().min(1).max(120),
  handoffMinutes: z.number().int().min(1).max(240),
  memoryVisibility: z.enum(["none", "selected", "all"]),
  agentModelId: z.string().min(1).max(128).default(DEFAULT_AGENT_MODEL_ID),
  agentReasoningEffort: AgentReasoningEffortSchema.default(DEFAULT_AGENT_REASONING_EFFORT),
  updatedAt: IsoTimestampSchema,
});
export type ProductPreferences = z.infer<typeof ProductPreferencesSchema>;

export const SaveProductPreferencesInputSchema = ProductPreferencesSchema.pick({
  reviewMinutes: true,
  handoffMinutes: true,
  memoryVisibility: true,
});

const PermissionRuleInputBaseSchema = z.strictObject({
  ruleId: z.string().min(1).max(256).optional(),
  mode: PermissionModeSchema,
});

export const SavePermissionRuleInputSchema = z.discriminatedUnion("scope", [
  PermissionRuleInputBaseSchema.extend({ scope: z.literal("global") }),
  PermissionRuleInputBaseSchema.extend({ scope: z.literal("course"), courseId: z.string().min(1).max(256) }),
  PermissionRuleInputBaseSchema.extend({ scope: z.literal("pattern"), courseId: z.string().min(1).max(256), patternId: z.string().min(1).max(256) }),
  PermissionRuleInputBaseSchema.extend({ scope: z.literal("assignment"), assignmentId: z.string().min(1).max(256) }),
]);

export const ProductSettingsStateSchema = z.strictObject({
  preferences: ProductPreferencesSchema,
  permissionRules: z.array(PermissionRuleSchema),
  schedule: AutomationScheduleSchema.nullable(),
});
export type ProductSettingsState = z.infer<typeof ProductSettingsStateSchema>;

export const ArtifactSummarySchema = z.strictObject({
  frontmatter: ArtifactFrontmatterSchema,
});

export const TaskSummarySchema = z.strictObject({
  task: TaskSchema,
  assignment: AssignmentSchema,
  execution: AssignmentExecutionSchema.nullable(),
  permission: PermissionResolutionSchema,
});

export const LibraryStateSchema = z.strictObject({
  tasks: z.array(TaskSummarySchema),
  artifacts: z.array(ArtifactSummarySchema),
});
export type LibraryState = z.infer<typeof LibraryStateSchema>;
export type TaskSummary = z.infer<typeof TaskSummarySchema>;

export const TaskDetailSchema = TaskSummarySchema.extend({
  events: z.array(TaskEventSchema),
  runs: z.array(RunSchema),
  attempts: z.array(ExecutionAttemptSchema),
  submissionReceipt: SubmissionReceiptSchema.nullable(),
  activity: z.array(AgentRunEventSchema).max(160),
});
export type TaskDetail = z.infer<typeof TaskDetailSchema>;

export const ReadArtifactInputSchema = z.strictObject({
  kind: ArtifactKindSchema,
  artifactId: z.string().min(1).max(128),
});

