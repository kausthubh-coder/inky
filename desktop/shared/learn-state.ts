import { z } from "zod";
import { ExamSchema, LearnSourceSchema, LearnTopicSchema, ReadinessSchema, TopicMasterySummarySchema } from "./learn.js";
import { TutorSessionSummarySchema } from "./tutor.js";
export const LearnPlanSchema = z.strictObject({
  leadExam: ExamSchema.nullable(), todayTopic: LearnTopicSchema.nullable(), readiness: ReadinessSchema,
  comingBack: z.array(LearnTopicSchema), topicsLeft: z.number().int().nonnegative(),
});
export const LearnStateSchema = z.strictObject({
  sources: z.array(LearnSourceSchema.omit({ text: true })), exams: z.array(ExamSchema), topics: z.array(LearnTopicSchema),
  mastery: z.array(TopicMasterySummarySchema), sessions: z.array(TutorSessionSummarySchema), plan: LearnPlanSchema,
});
export type LearnState = z.infer<typeof LearnStateSchema>;
