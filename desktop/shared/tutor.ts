import { z } from "zod";
import { OpaqueIdSchema } from "./ids.js";
import { IsoTimestampSchema } from "./schema-version.js";
import { MasteryEvidenceSchema } from "./learn.js";

const text = z.string().trim().min(1).max(10000);
export const TUTOR_TOOL_NAMES = ["tutor_say", "tutor_ask_choice", "tutor_ask_typed", "tutor_show_model", "tutor_ask_explain", "tutor_finish"] as const;
export const TutorToolNameSchema = z.enum(TUTOR_TOOL_NAMES);
export const TutorSayInputSchema = z.strictObject({ text });
const topicScope = { topicId: OpaqueIdSchema.optional() };
export const TutorChoiceInputSchema = z.strictObject({ ...topicScope, question: text, options: z.array(z.string().min(1).max(1000)).min(2).max(6), correct: z.number().int().min(0).max(5) })
  .refine(input => input.correct < input.options.length && new Set(input.options).size === input.options.length, "Choice needs unique options and a valid correct index");
export const TutorTypedInputSchema = z.strictObject({ ...topicScope, question: text, accept: z.array(z.string().trim().min(1).max(1000)).min(1).max(30), hints: z.array(z.string().min(1).max(2000)).max(8) });
export const TutorExplainInputSchema = z.strictObject({ ...topicScope, prompt: text, rubric: z.array(z.string().min(1).max(2000)).min(1).max(8) });
export const TutorModelInputSchema = z.discriminatedUnion("model", [
  z.strictObject({ ...topicScope, model: z.literal("population_grid"), params: z.strictObject({ population: z.number().int().min(10).max(10000), sampleSize: z.number().int().min(1).max(500), proportion: z.number().min(0).max(1) }), controls: z.array(z.enum(["sample", "sampleSize", "reset"])).max(3) }),
  z.strictObject({ ...topicScope, model: z.literal("flashcards"), params: z.strictObject({ cards: z.array(z.strictObject({ front: text, back: text })).min(1).max(30) }), controls: z.array(z.enum(["flip", "next", "previous"])).max(3) }),
  z.strictObject({ ...topicScope, model: z.literal("number_line"), params: z.strictObject({ min: z.number().min(-10000).max(10000), max: z.number().min(-10000).max(10000), step: z.number().positive().max(1000), points: z.array(z.number().min(-10000).max(10000)).max(30) }), controls: z.array(z.enum(["move", "reset"])).max(2) }),
  z.strictObject({ ...topicScope, model: z.literal("function_plot"), params: z.strictObject({ family: z.enum(["linear", "quadratic", "sine"]), a: z.number().min(-100).max(100), b: z.number().min(-100).max(100), c: z.number().min(-100).max(100), xMin: z.number().min(-100).max(100), xMax: z.number().min(-100).max(100) }), controls: z.array(z.enum(["a", "b", "c", "reset"])).max(4) }),
  z.strictObject({ ...topicScope, model: z.literal("code_runner"), params: z.strictObject({ language: z.literal("javascript"), code: z.string().max(12000), instructions: text, timeoutMs: z.number().int().min(50).max(1000) }), controls: z.array(z.enum(["edit", "run", "reset"])).max(3) }),
]);
export const TutorAssessmentSchema = z.strictObject({
  topic: OpaqueIdSchema, level: z.number().int().min(0).max(4),
  evidence: z.array(z.strictObject({ blockId: OpaqueIdSchema, correct: z.boolean(), rationale: z.string().trim().min(1).max(2000) })).max(40),
  missing: z.array(z.string().min(1).max(1000)).max(20), next: z.string().min(1).max(2000), summary: text,
});
export const TutorFinishInputSchema = TutorAssessmentSchema.extend({ assessments: z.array(TutorAssessmentSchema).max(30).optional() });
export const TutorCallSchema = z.discriminatedUnion("tool", [
  z.strictObject({ tool: z.literal("tutor_say"), args: TutorSayInputSchema }),
  z.strictObject({ tool: z.literal("tutor_ask_choice"), args: TutorChoiceInputSchema }),
  z.strictObject({ tool: z.literal("tutor_ask_typed"), args: TutorTypedInputSchema }),
  z.strictObject({ tool: z.literal("tutor_show_model"), args: TutorModelInputSchema }),
  z.strictObject({ tool: z.literal("tutor_ask_explain"), args: TutorExplainInputSchema }),
  z.strictObject({ tool: z.literal("tutor_finish"), args: TutorFinishInputSchema }),
]);
export const TutorBlockAnswerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("choice"), picked: z.number().int().min(0).max(5) }),
  z.strictObject({ kind: z.literal("typed"), answer: text }),
  z.strictObject({ kind: z.literal("explain"), text }),
  z.strictObject({ kind: z.literal("model"), explored: z.array(z.string().min(1).max(500)).max(50) }),
]);
export const TutorBlockResultSchema = z.strictObject({
  answer: TutorBlockAnswerSchema, correct: z.boolean().nullable(), hintsUsed: z.number().int().min(0).max(8), seconds: z.number().nonnegative(),
});
const blockFields = {
  blockId: OpaqueIdSchema, toolCallId: OpaqueIdSchema, sequence: z.number().int().min(0),
  status: z.enum(["open", "answered", "complete", "cancelled"]),
  createdAt: IsoTimestampSchema, answeredAt: IsoTimestampSchema.nullable(),
  elapsedAtCreation: z.number().nonnegative().default(0),
  hintsUsed: z.number().int().min(0).max(8), draft: z.string().max(10000), result: TutorBlockResultSchema.nullable(),
};
export const TutorBlockSchema = z.discriminatedUnion("tool", [
  z.strictObject({ ...blockFields, tool: z.literal("tutor_say"), args: TutorSayInputSchema }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_ask_choice"), args: TutorChoiceInputSchema }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_ask_typed"), args: TutorTypedInputSchema }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_show_model"), args: TutorModelInputSchema }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_ask_explain"), args: TutorExplainInputSchema }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_finish"), args: TutorFinishInputSchema }),
]);
export const StoredTutorBlockSchema = TutorBlockSchema;
export const TutorSessionResultSchema = z.strictObject({
  summary: text, previousLevel: z.number().int().min(0).max(4).nullable(), level: z.number().int().min(0).max(4).nullable(),
  evidence: z.array(MasteryEvidenceSchema).max(120), missing: z.array(z.string()).max(100), next: z.string(),
  assessments: z.array(z.strictObject({ topicId: OpaqueIdSchema, previousLevel: z.number().int().min(0).max(4).nullable(), level: z.number().int().min(0).max(4).nullable() })).max(30),
});
export const TutorMessageSchema = z.strictObject({ messageId: OpaqueIdSchema, text, createdAt: IsoTimestampSchema, delivered: z.boolean() });
export const TutorSessionSchema = z.strictObject({
  sessionId: OpaqueIdSchema, topicId: OpaqueIdSchema, goal: text,
  mode: z.enum(["topic", "recap", "mock_exam"]), topicIds: z.array(OpaqueIdSchema).min(1).max(30), examId: OpaqueIdSchema.nullable(),
  initialLevels: z.record(z.string(), z.number().int().min(0).max(4).nullable()),
  status: z.enum(["active", "paused", "completed", "cancelled", "expired", "failed"]),
  startedAt: IsoTimestampSchema, updatedAt: IsoTimestampSchema, finishedAt: IsoTimestampSchema.nullable(),
  budgetSeconds: z.number().int().min(60).max(3600), elapsedSeconds: z.number().nonnegative(),
  activeSince: IsoTimestampSchema.nullable(), initialLevel: z.number().int().min(0).max(4).nullable(),
  blocks: z.array(StoredTutorBlockSchema).max(120), messages: z.array(TutorMessageSchema).max(100),
  result: TutorSessionResultSchema.nullable(), error: z.string().max(2000).nullable(),
});
export const TutorSessionSummarySchema = TutorSessionSchema.pick({ sessionId: true, topicId: true, mode: true, goal: true, status: true, updatedAt: true, startedAt: true, finishedAt: true }).extend({
  result: z.strictObject({ summary: z.string().max(500), next: z.string().max(500), level: TutorSessionResultSchema.shape.level }).nullable(),
});
export type TutorSessionSummary = z.infer<typeof TutorSessionSummarySchema>;
export const TutorStartInputSchema = z.strictObject({ topicId: OpaqueIdSchema.optional(), topic: text.optional(), examId: OpaqueIdSchema.optional(), mode: z.enum(["topic", "recap", "mock_exam"]).default("topic"), goal: text.optional(), minutes: z.number().int().min(1).max(60).default(15) })
  .refine(input => input.mode === "mock_exam" ? !!input.examId && !input.topicId && !input.topic : !!input.topicId !== !!input.topic, "Provide examId for a mock exam, otherwise topicId or a free topic");
export type TutorCall = z.infer<typeof TutorCallSchema>;
export type TutorBlock = z.infer<typeof StoredTutorBlockSchema>;
export type TutorBlockAnswer = z.infer<typeof TutorBlockAnswerSchema>;
export type TutorBlockResult = z.infer<typeof TutorBlockResultSchema>;
export type TutorSession = z.infer<typeof TutorSessionSchema>;
export type TutorSessionResult = z.infer<typeof TutorSessionResultSchema>;
export type TutorFinishInput = z.infer<typeof TutorFinishInputSchema>;
export type TutorStartInput = z.input<typeof TutorStartInputSchema>;
export const normalizeTutorAnswer = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
export function tutorTimeLeft(session: Pick<TutorSession, "budgetSeconds" | "elapsedSeconds" | "activeSince">, now: string): number {
  return Math.max(0, session.budgetSeconds - session.elapsedSeconds - (session.activeSince ? Math.max(0, (Date.parse(now) - Date.parse(session.activeSince)) / 1000) : 0));
}

/** IPC-safe schema: never send stored tool arguments to the renderer. */
export const PublicTutorBlockSchema = z.discriminatedUnion("tool", [
  z.strictObject({ ...blockFields, tool: z.literal("tutor_say"), args: TutorSayInputSchema }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_ask_choice"), args: z.strictObject({ ...topicScope, question: text, options: z.array(z.string()) }) }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_ask_typed"), args: z.strictObject({ ...topicScope, question: text, hints: z.array(z.string()), hasMoreHints: z.boolean() }) }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_ask_explain"), args: z.strictObject({ ...topicScope, prompt: text }) }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_show_model"), args: TutorModelInputSchema }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_finish"), args: z.strictObject({ summary: text, missing: z.array(z.string()), next: z.string() }) }),
]);
export const PublicTutorSessionSchema = TutorSessionSchema.omit({ blocks: true }).extend({ blocks: z.array(PublicTutorBlockSchema) });
export type PublicTutorSession = z.infer<typeof PublicTutorSessionSchema>;
export type PublicTutorBlock = z.infer<typeof PublicTutorBlockSchema>;
export function publicTutorSession(session: TutorSession): PublicTutorSession {
  return PublicTutorSessionSchema.parse({ ...session, blocks: session.blocks.map(block => {
    switch (block.tool) {
      case "tutor_ask_choice": { const { correct: _correct, ...args } = block.args; return { ...block, args }; }
      case "tutor_ask_typed": { const { accept: _accept, hints, ...args } = block.args; return { ...block, args: { ...args, hints: hints.slice(0, block.hintsUsed), hasMoreHints: block.hintsUsed < hints.length } }; }
      case "tutor_ask_explain": { const { rubric: _rubric, ...args } = block.args; return { ...block, args }; }
      case "tutor_finish": return { ...block, args: { summary: block.args.summary, missing: block.args.missing, next: block.args.next } };
      default: return block;
    }
  }) });
}
