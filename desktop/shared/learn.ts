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
});
export const ExamSchema = z.strictObject({
  examId: OpaqueIdSchema, courseId: OpaqueIdSchema.nullable(), title,
  date: LearnDateSchema.nullable(), sourceId: OpaqueIdSchema,
  dateOrigin: z.enum(["source", "student"]), updatedAt: IsoTimestampSchema,
});
export const LearnTopicSchema = z.strictObject({
  topicId: OpaqueIdSchema, examId: OpaqueIdSchema.nullable(), courseId: OpaqueIdSchema.nullable(),
  title, chapter: z.number().int().min(0).max(10000),
  weight: z.number().finite().positive().max(1_000_000).nullable(),
  sourceId: OpaqueIdSchema.nullable(), origin: z.enum(["source", "student", "homework_hint"]),
  updatedAt: IsoTimestampSchema,
});
export const MasteryEvidenceSchema = z.strictObject({
  sessionId: OpaqueIdSchema, blockId: OpaqueIdSchema,
  kind: z.enum(["typed", "explain"]), correct: z.boolean(),
  answer: z.string().min(1).max(10000), rationale: z.string().min(1).max(2000),
  hintsUsed: z.number().int().min(0).max(8), recordedAt: IsoTimestampSchema,
});
export const TopicMasterySchema = z.strictObject({
  topicId: OpaqueIdSchema, level: z.number().int().min(0).max(4),
  evidence: z.array(MasteryEvidenceSchema).min(1).max(1000), updatedAt: IsoTimestampSchema,
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
  recapDue: boolean; recapTopic: LearnTopic | null;
  path: { date: string; kind: "topic" | "recap" | "mock_exam"; topicId: string | null; minutes: number }[];
}
export function planLearn(input: {
  exams: readonly Exam[]; topics: readonly LearnTopic[]; mastery: readonly (TopicMastery | TopicMasterySummary)[];
  sessions: readonly LearnSession[]; today: string; selectedExamId?: string;
}): LearnPlan {
  const today = LearnDateSchema.parse(input.today);
  const exams = input.exams.filter(exam => exam.date && exam.date >= today && input.topics.some(t => t.examId === exam.examId && t.origin !== "homework_hint"))
    .sort((a, b) => a.date!.localeCompare(b.date!) || a.examId.localeCompare(b.examId));
  const leadExam = input.selectedExamId ? input.exams.find(exam => exam.examId === input.selectedExamId) ?? null : exams[0] ?? null;
  const topics = input.topics.filter(t => t.examId === leadExam?.examId && t.origin !== "homework_hint");
  const weights = normalizeTopicWeights(topics);
  const levels = new Map(input.mastery.map(item => [item.topicId, item.level]));
  const gap = (topic: LearnTopic) => weights ? (weights[topic.topicId] ?? 0) * (4 - (levels.get(topic.topicId) ?? 0)) / 4 : 0;
  const ordered = [...topics].sort((a, b) => gap(b) - gap(a) || a.chapter - b.chapter || a.topicId.localeCompare(b.topicId));
  const last = input.sessions.filter(session => session.status === "completed" && session.finishedAt && topics.some(t => t.topicId === session.topicId))
    .sort((a, b) => b.finishedAt!.localeCompare(a.finishedAt!) || b.sessionId.localeCompare(a.sessionId))[0];
  const recapTopic = topics.find(t => t.topicId === last?.topicId) ?? null;
  const day = (value: string) => Date.parse(`${value}T00:00:00.000Z`);
  const sinceLast = last ? Math.floor((day(today) - day(last.finishedAt!.slice(0, 10))) / 86_400_000) : 0;
  const recapDue = !!last && sinceLast >= 3;
  const path: LearnPlan["path"] = [];
  const days = leadExam?.date ? Math.min(90, Math.ceil((day(leadExam.date) - day(today)) / 86_400_000)) : 0;
  for (let index = 0; index < days; index++) {
    const date = new Date(day(today) + index * 86_400_000).toISOString().slice(0, 10);
    const mock = days - index === 2 && topics.length <= 30;
    const recap = !!recapTopic && (index === 0 ? recapDue : (index + sinceLast) % 3 === 0);
    path.push({ date, kind: mock ? "mock_exam" : recap ? "recap" : "topic",
      topicId: mock ? null : recap ? recapTopic!.topicId : ordered[index % ordered.length]?.topicId ?? null,
      minutes: recap && !mock ? 5 : 15 });
  }
  return { leadExam, todayTopic: ordered[0] ?? null, readiness: computeReadiness(topics, input.mastery), recapDue, recapTopic, path };
}

export const LearnSourceInputSchema = z.strictObject({
  sourceId: OpaqueIdSchema.optional(), courseId: OpaqueIdSchema.nullable(), title,
  kind: LearnSourceSchema.shape.kind, sourceTarget: SafeSourceTargetSchema.nullable(),
  text: z.string().trim().min(1).max(200_000),
});
export const LearnExamInputSchema = z.strictObject({
  examId: OpaqueIdSchema.optional(), courseId: OpaqueIdSchema.nullable(), title,
  date: LearnDateSchema.nullable(),
});
export const LearnExtractionSchema = z.strictObject({
  exams: z.array(z.strictObject({ key: title, title, date: LearnDateSchema.nullable(), quote: z.string().min(1).max(2000) })).max(30),
  topics: z.array(z.strictObject({ key: title, examKey: title.nullable(), title, chapter: LearnTopicSchema.shape.chapter,
    weight: LearnTopicSchema.shape.weight, quote: z.string().min(1).max(2000) })).max(300),
});
export type LearnExtraction = z.infer<typeof LearnExtractionSchema>;
