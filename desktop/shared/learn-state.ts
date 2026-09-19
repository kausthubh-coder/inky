import { z } from "zod";
import { ExamSchema, LearnDateSchema, LearnSourceSchema, LearnTopicSchema, ReadinessSchema, TopicMasterySummarySchema } from "./learn.js";
import { TutorSessionSummarySchema } from "./tutor.js";
export const LearnPlanSchema = z.strictObject({
  leadExam: ExamSchema.nullable(), todayTopic: LearnTopicSchema.nullable(), readiness: ReadinessSchema,
  recapDue: z.boolean(), recapTopic: LearnTopicSchema.nullable(),
  path: z.array(z.strictObject({ date: LearnDateSchema, kind: z.enum(["topic", "recap", "mock_exam"]), topicId: z.string().nullable(), minutes: z.number().int().positive() })).max(90),
});
export const LearnStateSchema = z.strictObject({
  sources: z.array(LearnSourceSchema.omit({ text: true })), exams: z.array(ExamSchema), topics: z.array(LearnTopicSchema),
  mastery: z.array(TopicMasterySummarySchema), sessions: z.array(TutorSessionSummarySchema), plan: LearnPlanSchema,
});
export type LearnState = z.infer<typeof LearnStateSchema>;
