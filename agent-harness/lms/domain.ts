import { z } from "zod";

export const ServiceSchema = z.enum([
  "school",
  "statistics",
  "builds",
  "feedback",
]);
export type Service = z.infer<typeof ServiceSchema>;
export const CourseSchema = z.object({
  id: z.string(),
  title: z.string(),
  code: z.string(),
  aliases: z.array(z.string()),
});
export const ActivitySchema = z.object({
  id: z.string(),
  courseId: z.string(),
  title: z.string(),
  module: z.string(),
  instructions: z.string(),
  kind: z.enum(["assignment", "quiz", "lesson", "forum", "external"]),
  service: ServiceSchema,
  dueAt: z.string().nullable(),
  dueText: z.string(),
  closeAt: z.string().nullable(),
  status: z.enum(["unknown", "not_started", "draft", "submitted", "graded"]),
  grade: z.number().nullable(),
  gradeVisible: z.boolean(),
  submissionChannel: z.enum([
    "lms",
    "vendor",
    "repository",
    "in_person",
    "none",
  ]),
  requirements: z.array(z.string()),
  requiredFiles: z.array(z.string()),
  attachments: z.array(z.string()),
  prerequisites: z.array(z.string()),
  maxAttempts: z.number().int().positive(),
  announcement: z.string().optional(),
  dashboardDueText: z.string().optional(),
  extensionAt: z.string().optional(),
});
export type Activity = z.infer<typeof ActivitySchema>;
export type Course = z.infer<typeof CourseSchema>;
export interface Asset {
  id: string;
  name: string;
  mime: string;
  text: string;
  format: "text" | "pdf";
}
export interface Upload {
  id: string;
  name: string;
  mime: string;
  hash: string;
  bytes: number;
}
export interface Draft {
  answer: string;
  files: Upload[];
  revision: number;
}
export interface Submission {
  id: string;
  activityId: string;
  submittedAt: string;
  answer: string;
  files: Upload[];
  idempotencyKey: string;
  fingerprint: string;
}
export interface Effect {
  sequence: number;
  type: string;
  at: string;
  activityId?: string;
  detail: Record<string, unknown>;
}
export interface SchoolState {
  schemaVersion: 1;
  scenarioId: string;
  scenarioVersion: number;
  seed: number;
  clock: string;
  timezone: string;
  courses: Course[];
  activities: Activity[];
  assets: Asset[];
  drafts: Record<string, Draft>;
  submissions: Submission[];
  completed: string[];
  sessions: Record<Service, boolean>;
  revision: number;
  faults: {
    courseFailurePending: boolean;
    lostSubmitResponsePending: boolean;
    downloadFailurePending: boolean;
  };
  builds: {
    revision: string;
    state: "queued" | "failed" | "success";
    description: string;
  }[];
}
export class SchoolError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export function activityById(state: SchoolState, id: string): Activity {
  const activity = state.activities.find((item) => item.id === id);
  if (!activity) throw new SchoolError(404, "Activity not found.");
  return activity;
}
export function unavailableReason(
  state: SchoolState,
  activity: Activity,
): string | null {
  if (activity.prerequisites.some((id) => !state.completed.includes(id)))
    return "Complete the required activities to unlock this work.";
  if (activity.closeAt && state.clock > activity.closeAt)
    return "This activity is closed. New submissions are not accepted.";
  if (["none", "in_person", "repository"].includes(activity.submissionChannel))
    return "No submission is accepted on this page. Follow the stated submission channel.";
  const submittedAttempts = Math.max(
    state.submissions.filter((item) => item.activityId === activity.id).length,
    ["submitted", "graded"].includes(activity.status) ? 1 : 0,
  );
  if (submittedAttempts >= activity.maxAttempts)
    return "No attempts remain. This work has already been submitted.";
  return null;
}
export function validateState(state: SchoolState): void {
  if (state.schemaVersion !== 1 || !Number.isFinite(Date.parse(state.clock)))
    throw new Error("Invalid school state or clock");
  const courses = new Set(
    state.courses.map((item) => CourseSchema.parse(item).id),
  );
  const activities = new Set(
    state.activities.map((item) => ActivitySchema.parse(item).id),
  );
  const assets = new Set(state.assets.map((item) => item.id));
  if (
    courses.size !== state.courses.length ||
    activities.size !== state.activities.length ||
    assets.size !== state.assets.length
  )
    throw new Error("Duplicate entity IDs");
  for (const activity of state.activities) {
    if (!courses.has(activity.courseId))
      throw new Error(`Missing course for ${activity.id}`);
    if (activity.attachments.some((id) => !assets.has(id)))
      throw new Error(`Missing asset for ${activity.id}`);
    if (activity.prerequisites.some((id) => !activities.has(id)))
      throw new Error(`Missing prerequisite for ${activity.id}`);
    for (const date of [activity.dueAt, activity.closeAt, activity.extensionAt])
      if (date && !Number.isFinite(Date.parse(date)))
        throw new Error(`Invalid date for ${activity.id}`);
  }
  const visiting = new Set<string>(),
    visited = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) throw new Error("Prerequisite cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    activityById(state, id).prerequisites.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  }
  state.activities.forEach((item) => visit(item.id));
}
