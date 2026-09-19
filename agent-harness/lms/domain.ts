import { z } from "zod";

export const ServiceSchema = z.enum([
  "school",
  "statistics",
  "builds",
  "feedback",
]);
export type Service = z.infer<typeof ServiceSchema>;
export const WorkKindSchema = z.enum([
  "code",
  "discussion",
  "essay",
  "group_work",
  "problem_set",
  "quiz",
  "reading",
]);
export type WorkKind = z.infer<typeof WorkKindSchema>;
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
  requiredFileNames: z.array(z.string()).optional(),
  attachments: z.array(z.string()),
  prerequisites: z.array(z.string()),
  maxAttempts: z.number().int().positive(),
  workKind: WorkKindSchema.optional(),
  visibility: z.enum(["course", "announcement_only"]).optional(),
  requiredStudentFiles: z.array(z.string()).optional(),
  rubric: z.array(z.string()).optional(),
  wordLimit: z.number().int().positive().optional(),
  latePenalty: z.string().optional(),
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
export interface ExamTopic {
  id: string;
  title: string;
  chapter: number;
  weight: number;
}
export interface Exam {
  id: string;
  courseId: string;
  title: string;
  date: string;
  topics: ExamTopic[];
}
export interface Syllabus {
  courseId: string;
  assetId: string;
  updatedAt: string;
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
  exams?: Exam[];
  syllabi?: Syllabus[];
  drafts: Record<string, Draft>;
  submissions: Submission[];
  completed: string[];
  sessions: Record<Service, boolean>;
  revision: number;
  faults: {
    courseFailurePending: boolean;
    lostSubmitResponsePending: boolean;
    downloadFailurePending: boolean;
    assignmentTimeoutsRemaining?: number;
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
  const exams = new Set((state.exams ?? []).map((item) => item.id));
  if (
    courses.size !== state.courses.length ||
    activities.size !== state.activities.length ||
    assets.size !== state.assets.length ||
    exams.size !== (state.exams ?? []).length
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
  for (const syllabus of state.syllabi ?? []) {
    if (!courses.has(syllabus.courseId) || !assets.has(syllabus.assetId))
      throw new Error(`Invalid syllabus for ${syllabus.courseId}`);
  }
  for (const exam of state.exams ?? []) {
    if (!courses.has(exam.courseId) || !Number.isFinite(Date.parse(exam.date)))
      throw new Error(`Invalid exam ${exam.id}`);
    if (
      exam.topics.length === 0 ||
      new Set(exam.topics.map((topic) => topic.id)).size !== exam.topics.length ||
      exam.topics.some(
        (topic) =>
          !Number.isInteger(topic.chapter) ||
          topic.chapter < 1 ||
          !Number.isFinite(topic.weight) ||
          topic.weight <= 0,
      ) ||
      exam.topics.reduce((sum, topic) => sum + topic.weight, 0) !== 100
    )
      throw new Error(`Invalid weighted topics for ${exam.id}`);
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
