import { z } from "zod";

import { AgentReasoningEffortSchema, AgentRunEventSchema, DEFAULT_AGENT_MODEL_ID, DEFAULT_AGENT_REASONING_EFFORT } from "./agent-runtime.js";
import { ArtifactFrontmatterSchema, ArtifactKindSchema } from "./artifact.js";
import { AssignmentSchema } from "./assignment.js";
import { AutomationScheduleSchema, AssignmentExecutionSchema, ExecutionAttemptSchema, NotificationIntentSchema, SubmissionReceiptSchema } from "./lifecycle.js";
import { PermissionModeSchema, PermissionResolutionSchema, PermissionRuleSchema } from "./permission.js";
import { IsoTimestampSchema, SchemaVersionSchema } from "./schema-version.js";
import { TaskEventSchema, TaskSchema } from "./task.js";
import { RunSchema } from "./run.js";

export const BrowserLayoutModeSchema = z.enum(["hidden", "onboarding", "desk"]);
export type BrowserLayoutMode = z.infer<typeof BrowserLayoutModeSchema>;

export const SchoolPageBoundsSchema = z.strictObject({
  x: z.number().int().min(0).max(10_000),
  y: z.number().int().min(0).max(10_000),
  width: z.number().int().min(1).max(10_000),
  height: z.number().int().min(1).max(10_000),
});
export type SchoolPageBounds = z.infer<typeof SchoolPageBoundsSchema>;

export const NotificationKindSchema = NotificationIntentSchema.shape.kind;
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

export const NotificationSoundIdSchema = z.enum([
  "silent",
  "os",
  "inky_nudge",
  "inky_done",
  "inky_soft",
  "inky_uh_oh",
]);
export type NotificationSoundId = z.infer<typeof NotificationSoundIdSchema>;

export const NotificationKindPreferenceSchema = z.strictObject({
  banner: z.boolean(),
  sound: NotificationSoundIdSchema,
});

export const NotificationPreferencesSchema = z.strictObject({
  enabled: z.boolean(),
  kinds: z.strictObject({
    handoff: NotificationKindPreferenceSchema,
    review_ready: NotificationKindPreferenceSchema,
    scan_result: NotificationKindPreferenceSchema,
    failure: NotificationKindPreferenceSchema,
  }),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: true,
  kinds: {
    handoff: { banner: true, sound: "inky_nudge" },
    review_ready: { banner: true, sound: "inky_done" },
    scan_result: { banner: true, sound: "inky_soft" },
    failure: { banner: true, sound: "inky_uh_oh" },
  },
};

export function shouldShowNotificationBanner(
  preferences: NotificationPreferences,
  kind: NotificationKind,
): boolean {
  return preferences.enabled && preferences.kinds[kind].banner;
}

export function resolveNotificationSound(
  preferences: NotificationPreferences,
  kind: NotificationKind,
  bundledExists: (soundId: NotificationSoundId) => boolean,
): { readonly silent: boolean; readonly playSoundId: NotificationSoundId | null } {
  const sound = preferences.kinds[kind].sound;
  if (sound === "silent") return { silent: true, playSoundId: null };
  if (sound !== "os" && bundledExists(sound)) return { silent: true, playSoundId: sound };
  return { silent: false, playSoundId: null };
}

export const NotificationTestReceiptSchema = z.strictObject({
  notification: NotificationIntentSchema,
  shown: z.boolean(),
  sound: NotificationSoundIdSchema,
  supported: z.boolean(),
});
export type NotificationTestReceipt = z.infer<typeof NotificationTestReceiptSchema>;

export const LIFECYCLE_ACTIVATED_CHANNEL = "studi:lifecycle-activated" as const;
export const PLAY_NOTIFICATION_SOUND_CHANNEL = "studi:play-notification-sound" as const;

export const ProductPreferencesSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  reviewMinutes: z.number().int().min(1).max(120),
  handoffMinutes: z.number().int().min(1).max(240),
  memoryVisibility: z.enum(["none", "selected", "all"]),
  homeworkRoot: z.string().trim().min(1).max(1_024).nullable().default(null),
  agentModelId: z.string().min(1).max(128).default(DEFAULT_AGENT_MODEL_ID),
  agentReasoningEffort: AgentReasoningEffortSchema.default(DEFAULT_AGENT_REASONING_EFFORT),
  notifications: NotificationPreferencesSchema.default(DEFAULT_NOTIFICATION_PREFERENCES),
  updatedAt: IsoTimestampSchema,
});
export type ProductPreferences = z.infer<typeof ProductPreferencesSchema>;

export const SaveProductPreferencesInputSchema = ProductPreferencesSchema.pick({
  reviewMinutes: true,
  handoffMinutes: true,
  memoryVisibility: true,
});

export const SaveNotificationPreferencesInputSchema = NotificationPreferencesSchema;

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

