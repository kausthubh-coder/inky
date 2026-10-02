import { z } from "zod";
import { OpaqueIdSchema, SafeSourceTargetSchema } from "./ids.js";
import { IsoTimestampSchema } from "./schema-version.js";

const title = z.string().trim().min(1).max(500);
export const LearnDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Use a real calendar date");
export const LearnSourceSchema = z.strictObject({
  sourceId: OpaqueIdSchema, courseId: OpaqueIdSchema.nullable(), title,
  kind: z.enum(["file", "paste", "typed", "scan", "drive"]),
  sourceTarget: SafeSourceTargetSchema.nullable(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  text: z.string().max(200_000),
  status: z.enum(["pending", "reading", "ready", "failed"]),
  extractedAt: IsoTimestampSchema.nullable(), error: z.string().max(2000).nullable(),
  createdAt: IsoTimestampSchema, updatedAt: IsoTimestampSchema,
  /** The goal the student added this to. Class sources reach every goal in that class. */
  examId: OpaqueIdSchema.nullable().default(null),
});
/** A learning goal: an exam, or a topic the student wants to learn outside a class. */
export const ExamSchema = z.strictObject({
  examId: OpaqueIdSchema, courseId: OpaqueIdSchema.nullable(), title,
  date: LearnDateSchema.nullable(), sourceId: OpaqueIdSchema.nullable(),
  dateOrigin: z.enum(["source", "student"]), updatedAt: IsoTimestampSchema,
  kind: z.enum(["exam", "topic"]).default("exam"),
  scopeNote: z.string().trim().max(2000).nullable().default(null),
  /** Removed by the student. Kept so a later syllabus read doesn't bring it back. */
  hidden: z.boolean().default(false),
});
export const LearnTopicSchema = z.strictObject({
  topicId: OpaqueIdSchema, examId: OpaqueIdSchema.nullable(), courseId: OpaqueIdSchema.nullable(),
  title, chapter: z.number().int().min(0).max(10000),
  weight: z.number().finite().positive().max(1_000_000).nullable(),
  sourceId: OpaqueIdSchema.nullable(), origin: z.enum(["source", "student", "homework_hint"]),
  updatedAt: IsoTimestampSchema,
  hidden: z.boolean().default(false),
});
export const MasteryEvidenceSchema = z.strictObject({
  sessionId: OpaqueIdSchema, blockId: OpaqueIdSchema,
  kind: z.enum(["typed", "explain"]), correct: z.boolean(),
  answer: z.string().min(1).max(10000), rationale: z.string().min(1).max(2000),
  hintsUsed: z.number().int().min(0).max(8), recordedAt: IsoTimestampSchema,
});
export const TopicReviewSchema = z.strictObject({ dueOn: LearnDateSchema, gapDays: z.number().int().min(1).max(30), lastRightOn: LearnDateSchema.nullable() });
export type TopicReview = z.infer<typeof TopicReviewSchema>;
export const TopicMasterySchema = z.strictObject({
  topicId: OpaqueIdSchema, level: z.number().int().min(0).max(4),
  evidence: z.array(MasteryEvidenceSchema).min(1).max(1000), updatedAt: IsoTimestampSchema, review: TopicReviewSchema.nullable().default(null),
});
export const TopicMasterySummarySchema = TopicMasterySchema.omit({ evidence: true }).extend({ evidenceCount: z.number().int().min(1).max(1000) });
export type TopicMasterySummary = z.infer<typeof TopicMasterySummarySchema>;
export const ReadinessSchema = z.strictObject({
  status: z.enum(["unknown", "partial", "known"]), percent: z.number().min(0).max(100).nullable(),
  knownWeight: z.number().min(0).max(1),
});
export type LearnSource = z.infer<typeof LearnSourceSchema>;
export type Exam = z.infer<typeof ExamSchema>;
export type LearnTopic = z.infer<typeof LearnTopicSchema>;
export type TopicMastery = z.infer<typeof TopicMasterySchema>;
export type MasteryEvidence = z.infer<typeof MasteryEvidenceSchema>;
export type Readiness = z.infer<typeof ReadinessSchema>;
export interface LearnSession { sessionId: string; topicId: string; startedAt: string; finishedAt: string | null; status: string }

/**
 * The backstop for when the model didn't name the saved exam it meant: whether two exams in the same class are the
 * same exam. The same name (ignoring case, a leading class code and bracketed notes) on the same or an unknown date;
 * the same kind of exam ("Final", "Midterm 2", "Exam 1") on the same date, however the rest is worded; or, when one
 * has no date, one name containing the other ("ST 370 Final Exam" and "Final Exam"). Two finals on different dates
 * (one per section) stay separate.
 */
export function sameExam(a: { title: string; date: string | null }, b: { title: string; date: string | null }): boolean {
  const core = (title: string) => title.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/^[a-z]{2,5}\s?\d{3}\w?\b/, " ").replace(/[^a-z0-9]+/g, " ").trim();
  const kind = (title: string) => title.match(/\b(final|midterm(?: \d+)?|(?:exam|test) \d+)\b/)?.[1] ?? null;
  const [first, second] = [core(a.title), core(b.title)];
  if (!first || !second) return false;
  if (first === second) return !a.date || !b.date || a.date === b.date;
  if (a.date && b.date) return a.date === b.date && kind(first) !== null && kind(first) === kind(second);
  return ` ${first} `.includes(` ${second} `) || ` ${second} `.includes(` ${first} `);
}

/** Missing weights are unknown. Never silently invent equal exam shares. */
export function normalizeTopicWeights(topics: readonly LearnTopic[]): Record<string, number> | null {
  if (!topics.length || new Set(topics.map(topic => topic.topicId)).size !== topics.length || topics.some(topic => topic.weight === null || !Number.isFinite(topic.weight) || topic.weight <= 0 || topic.origin === "homework_hint")) return null;
  const sum = topics.reduce((total, topic) => total + (topic.weight ?? 0), 0);
  if (!Number.isFinite(sum) || sum <= 0) return null;
  return Object.fromEntries(topics.map(topic => [topic.topicId, (topic.weight ?? 0) / sum]));
}

/** Partial evidence has coverage, but no misleading whole-exam score. */
export function computeReadiness(topics: readonly LearnTopic[], mastery: readonly (TopicMastery | TopicMasterySummary)[]): Readiness {
  const weights = normalizeTopicWeights(topics);
  if (!weights) return { status: "unknown", percent: null, knownWeight: 0 };
  const levels = new Map(mastery.map(item => [item.topicId, item]));
  let knownWeight = 0, score = 0;
  for (const topic of topics) {
    const record = levels.get(topic.topicId);
    if (!record || !("evidenceCount" in record ? record.evidenceCount : record.evidence.length)) continue;
    const weight = weights[topic.topicId] ?? 0;
    knownWeight += weight;
    score += weight * record.level / 4;
  }
  const complete = topics.every(topic => { const record = levels.get(topic.topicId); return record && ("evidenceCount" in record ? record.evidenceCount : record.evidence.length) > 0; });
  return { status: complete ? "known" : knownWeight > 0 ? "partial" : "unknown",
    percent: complete ? Math.round(score * 100) : null, knownWeight: Math.min(1, knownWeight) };
}

export interface LearnPlan {
  leadExam: Exam | null; todayTopic: LearnTopic | null; readiness: Readiness;
  comingBack: LearnTopic[]; topicsLeft: number;
}
const day = (value: string) => Date.parse(`${value}T00:00:00.000Z`);
/** The calendar day on this machine, the same day the Learn page shows. */
export function localDay(iso: string): string {
  const date = new Date(iso);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
export function nextReview(previous: TopicReview | null, input: { today: string; examDate: string | null; right: boolean }): TopicReview {
  const today = LearnDateSchema.parse(input.today), examDate = input.examDate === null ? null : LearnDateSchema.parse(input.examDate);
  const daysLeft = examDate ? (day(examDate) - day(today)) / 86_400_000 : null;
  if (input.right && previous?.lastRightOn && previous.dueOn > today) return previous;
  const gapDays = !input.right ? 1 : !previous?.lastRightOn
    ? daysLeft === null ? 2 : Math.max(1, Math.min(14, Math.round(daysLeft / 4)))
    : Math.min(30, previous.gapDays * 2);
  let due = day(today) + gapDays * 86_400_000;
  if (examDate && daysLeft! > 1 && due >= day(examDate)) due = day(examDate) - 86_400_000;
  return { dueOn: new Date(due).toISOString().slice(0, 10), gapDays, lastRightOn: input.right ? today : null };
}
export function planLearn(input: {
  exams: readonly Exam[]; topics: readonly LearnTopic[]; mastery: readonly (TopicMastery | TopicMasterySummary)[];
  sessions: readonly LearnSession[]; today: string; selectedExamId?: string;
}): LearnPlan {
  const today = LearnDateSchema.parse(input.today);
  const leadExam = input.selectedExamId ? input.exams.find(exam => exam.examId === input.selectedExamId) ?? null : orderGoals(input.exams, today)[0] ?? null;
  const topics = input.topics.filter(t => t.examId === leadExam?.examId && t.origin !== "homework_hint");
  const weights = normalizeTopicWeights(topics);
  const records = new Map(input.mastery.map(item => [item.topicId, item]));
  // Without stated shares every topic counts the same for ordering only; readiness stays unknown.
  const gap = (topic: LearnTopic) => (weights ? weights[topic.topicId] ?? 0 : 1) * (4 - (records.get(topic.topicId)?.level ?? 0)) / 4;
  const needsWork = topics.filter(topic => (records.get(topic.topicId)?.level ?? 0) < 3);
  const ordered = needsWork.filter(topic => !records.get(topic.topicId)?.review || records.get(topic.topicId)!.review!.dueOn <= today)
    .sort((a, b) => gap(b) - gap(a) || a.chapter - b.chapter || a.topicId.localeCompare(b.topicId));
  const comingBack = topics.filter(topic => (records.get(topic.topicId)?.level ?? 0) >= 3 && !!records.get(topic.topicId)?.review && records.get(topic.topicId)!.review!.dueOn <= today)
    .sort((a, b) => records.get(a.topicId)!.review!.dueOn.localeCompare(records.get(b.topicId)!.review!.dueOn) || a.chapter - b.chapter || a.topicId.localeCompare(b.topicId));
  return { leadExam, todayTopic: ordered[0] ?? null, readiness: computeReadiness(topics, input.mastery), comingBack, topicsLeft: needsWork.length };
}

/** Upcoming exams by date, then undated exams, then topic goals. Past exams are only shown when chosen. */
export function orderGoals<T extends Exam>(exams: readonly T[], today: string): T[] {
  const rank = (exam: Exam) => exam.hidden ? 3 : exam.kind === "topic" ? 2 : exam.date ? (exam.date >= today ? 0 : 3) : 1;
  return exams.filter(exam => rank(exam) < 3)
    .sort((a, b) => rank(a) - rank(b) || (a.date ?? "").localeCompare(b.date ?? "") || b.updatedAt.localeCompare(a.updatedAt) || a.examId.localeCompare(b.examId));
}

export const LearnSourceInputSchema = z.strictObject({
  sourceId: OpaqueIdSchema.optional(), courseId: OpaqueIdSchema.nullable(), examId: OpaqueIdSchema.nullable().default(null), title,
  kind: LearnSourceSchema.shape.kind, sourceTarget: SafeSourceTargetSchema.nullable(),
  text: z.string().trim().min(1).max(200_000),
});
export const LearnExamInputSchema = z.strictObject({
  examId: OpaqueIdSchema.optional(), courseId: OpaqueIdSchema.nullable(), title,
  date: LearnDateSchema.nullable(),
  kind: ExamSchema.shape.kind.optional(), scopeNote: z.string().trim().max(2000).nullable().optional(),
});
export const LearnExtractionSchema = z.strictObject({
  exams: z.array(z.strictObject({ key: title, title, date: LearnDateSchema.nullable(), quote: z.string().min(1).max(2000),
    /** The saved exam this is, when the model recognised it among the class's known exams. */
    sameAs: z.string().min(1).max(200).nullable().optional() })).max(30),
  topics: z.array(z.strictObject({ key: title, examKey: title.nullable(), title, chapter: LearnTopicSchema.shape.chapter,
    weight: LearnTopicSchema.shape.weight, quote: z.string().min(1).max(2000) })).max(300),
});
export type LearnExtraction = z.infer<typeof LearnExtractionSchema>;
