import { z } from "zod";
import { OpaqueIdSchema } from "./ids.js";
import { IsoTimestampSchema } from "./schema-version.js";
import { LearnDateSchema, MasteryEvidenceSchema } from "./learn.js";

const text = z.string().trim().min(1).max(10000);
const steps = z.array(z.string().trim().min(1).max(300)).max(6).optional();
export const TUTOR_WRAP_SECONDS = 90;
export const TUTOR_TIME_UP = "Time is up. Call tutor_finish now with the evidence so far.";
export const TUTOR_TOOL_NAMES = ["tutor_say", "tutor_reply", "tutor_ask_choice", "tutor_ask_typed", "tutor_show_model", "tutor_show_page", "tutor_ask_explain", "tutor_update", "tutor_erase", "tutor_advance", "tutor_grade", "tutor_finish"] as const;
export const TutorToolNameSchema = z.enum(TUTOR_TOOL_NAMES);
/** A lesson moves forward through these. Only Check and On your own answers are unassisted, so only they count as evidence. */
export const TUTOR_PHASES = ["check", "learn", "practice", "independent", "wrap"] as const;
export const TutorPhaseSchema = z.enum(TUTOR_PHASES);
export type TutorPhase = z.infer<typeof TutorPhaseSchema>;
export const EVIDENCE_PHASES: readonly TutorPhase[] = ["check", "independent"];
export const TutorSayInputSchema = z.strictObject({ text, steps });
export const TutorReplyInputSchema = z.strictObject({ text: text.max(600) });
export const TutorAdvanceInputSchema = z.strictObject({ phase: z.enum(["learn", "practice", "independent"]) });
export const TutorGradeInputSchema = z.strictObject({ blockId: OpaqueIdSchema, correct: z.boolean(), met: z.array(z.boolean()).max(8).optional(), equivalentTo: z.string().trim().min(1).max(1000).optional() });
/** Where a question came from, shown under it: "Like problem 3 on the Midterm 1 review sheet". */
const topicScope = { topicId: OpaqueIdSchema.optional(), source: z.string().trim().min(1).max(300).optional() };
const questionNote = { note: z.string().trim().min(1).max(300).optional() };
const visualScope = { wait: z.boolean().optional(), under: OpaqueIdSchema.optional() };
export const TutorChoiceInputSchema = z.strictObject({ ...topicScope, ...questionNote, question: text, options: z.array(z.string().min(1).max(1000)).min(2).max(6), correct: z.number().int().min(0).max(5) })
  .refine(input => input.correct < input.options.length && new Set(input.options).size === input.options.length, "Choice needs unique options and a valid correct index");
export const TutorTypedInputSchema = z.strictObject({ ...topicScope, ...questionNote, question: text, steps, accept: z.array(z.string().trim().min(1).max(1000)).min(1).max(30), hints: z.array(z.string().min(1).max(2000)).max(8) });
export const TutorExplainInputSchema = z.strictObject({ ...topicScope, ...questionNote, prompt: text, steps, rubric: z.array(z.string().min(1).max(2000)).min(1).max(8) });
export const TutorModelInputSchema = z.discriminatedUnion("model", [
  z.strictObject({ ...topicScope, ...visualScope, model: z.literal("population_grid"), params: z.strictObject({ population: z.number().int().min(10).max(10000), sampleSize: z.number().int().min(1).max(500), proportion: z.number().min(0).max(1) }), controls: z.array(z.enum(["sample", "sampleSize", "reset"])).max(3) }),
  z.strictObject({ ...topicScope, ...visualScope, model: z.literal("flashcards"), params: z.strictObject({ cards: z.array(z.strictObject({ front: text, back: text })).min(1).max(30) }), controls: z.array(z.enum(["flip", "next", "previous"])).max(3) }),
  z.strictObject({ ...topicScope, ...visualScope, model: z.literal("number_line"), params: z.strictObject({ min: z.number().min(-10000).max(10000), max: z.number().min(-10000).max(10000), step: z.number().positive().max(1000), points: z.array(z.number().min(-10000).max(10000)).max(30) }), controls: z.array(z.enum(["move", "reset"])).max(2) }),
  z.strictObject({ ...topicScope, ...visualScope, model: z.literal("function_plot"), params: z.strictObject({ family: z.enum(["linear", "quadratic", "sine"]), a: z.number().min(-100).max(100), b: z.number().min(-100).max(100), c: z.number().min(-100).max(100), xMin: z.number().min(-100).max(100), xMax: z.number().min(-100).max(100),
    secant: z.strictObject({ x: z.number().min(-100).max(100), gap: z.number().min(0).max(200) }).optional(),
    labels: z.array(z.strictObject({ x: z.number().min(-100).max(100), text: z.string().trim().min(1).max(120) })).max(4).optional() }), controls: z.array(z.enum(["a", "b", "c", "gap", "reset"])).max(5) }),
  z.strictObject({ ...topicScope, ...visualScope, model: z.literal("table"), params: z.strictObject({ columns: z.array(z.string().trim().min(1).max(120)).min(1).max(8), rows: z.array(z.array(z.union([z.string().max(1000), z.number()])).max(8)).max(8) }), controls: z.array(z.string()).max(0) }),
  z.strictObject({ ...topicScope, ...visualScope, model: z.literal("code_runner"), params: z.strictObject({ language: z.literal("javascript"), code: z.string().max(12000), instructions: text, timeoutMs: z.number().int().min(50).max(1000) }), controls: z.array(z.enum(["edit", "run", "reset"])).max(3) }),
]).refine(input => {
  if (input.model === "table") return input.params.rows.every(row => row.length === input.params.columns.length);
  if (input.model === "function_plot") {
    const { xMin, xMax, secant, labels } = input.params;
    return xMin < xMax && (!secant || (secant.x >= xMin && secant.x + secant.gap <= xMax))
      && (!input.controls.includes("gap") || !!secant) && (labels ?? []).every(label => label.x >= xMin && label.x <= xMax);
  }
  return true;
}, "Table rows must match columns; plot points and controls must fit its bounds");
/** A study page Chalky writes for one idea: self-contained HTML that runs sandboxed with no network. */
export const TutorShowPageInputSchema = z.strictObject({ ...topicScope, ...visualScope, title: z.string().trim().min(1).max(120), purpose: z.string().trim().min(1).max(300), html: z.string().min(1).max(60_000) });
export const TutorUpdateInputSchema = z.strictObject({ id: OpaqueIdSchema, args: z.union([TutorModelInputSchema, TutorShowPageInputSchema]) });
export const TutorEraseInputSchema = z.strictObject({ id: OpaqueIdSchema });
export const TutorAssessmentSchema = z.strictObject({
  topic: OpaqueIdSchema, level: z.number().int().min(0).max(4),
  evidence: z.array(z.object({ blockId: OpaqueIdSchema, rationale: z.string().trim().min(1).max(2000) })).max(40),
  missing: z.array(z.string().min(1).max(1000)).max(20), next: z.string().min(1).max(2000), summary: text,
});
export const TutorFinishInputSchema = TutorAssessmentSchema.extend({
  clicked: z.array(z.strictObject({ before: z.string().trim().min(1).max(200), after: z.string().trim().min(1).max(200), wrongBlockId: OpaqueIdSchema, rightBlockId: OpaqueIdSchema })).max(2).optional(),
  assessments: z.array(TutorAssessmentSchema).max(30).optional(),
  /** For a goal outside school: the outline Chalky proposes after the first check. */
  outline: z.array(z.string().trim().min(1).max(200)).max(12).optional(),
  /** Facts worth memorising, added to the goal's cheat sheet. */
  cheatsheet: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
});
export const TutorCallSchema = z.discriminatedUnion("tool", [
  z.strictObject({ tool: z.literal("tutor_say"), args: TutorSayInputSchema }),
  z.strictObject({ tool: z.literal("tutor_reply"), args: TutorReplyInputSchema }),
  z.strictObject({ tool: z.literal("tutor_ask_choice"), args: TutorChoiceInputSchema }),
  z.strictObject({ tool: z.literal("tutor_ask_typed"), args: TutorTypedInputSchema }),
  z.strictObject({ tool: z.literal("tutor_show_model"), args: TutorModelInputSchema }),
  z.strictObject({ tool: z.literal("tutor_show_page"), args: TutorShowPageInputSchema }),
  z.strictObject({ tool: z.literal("tutor_ask_explain"), args: TutorExplainInputSchema }),
  z.strictObject({ tool: z.literal("tutor_update"), args: TutorUpdateInputSchema }),
  z.strictObject({ tool: z.literal("tutor_erase"), args: TutorEraseInputSchema }),
  z.strictObject({ tool: z.literal("tutor_advance"), args: TutorAdvanceInputSchema }),
  z.strictObject({ tool: z.literal("tutor_grade"), args: TutorGradeInputSchema }),
  z.strictObject({ tool: z.literal("tutor_finish"), args: TutorFinishInputSchema }),
]);
const explored = z.array(z.string().min(1).max(500)).max(50);
export const TutorBlockAnswerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("choice"), explored: explored.optional(), picked: z.number().int().min(0).max(5) }),
  z.strictObject({ kind: z.literal("typed"), explored: explored.optional(), answer: text }),
  z.strictObject({ kind: z.literal("explain"), explored: explored.optional(), text }),
  z.strictObject({ kind: z.literal("model"), explored }),
]);
export const TutorBlockResultSchema = z.strictObject({
  answer: TutorBlockAnswerSchema, correct: z.boolean().nullable(), hintsUsed: z.number().int().min(0).max(8), seconds: z.number().nonnegative(),
  explored: explored.optional(), met: z.array(z.boolean()).max(8).optional(), matched: z.boolean().optional(),
});
export const TutorAttemptSchema = TutorBlockResultSchema.pick({ answer: true, correct: true, hintsUsed: true, seconds: true });
const blockFields = {
  blockId: OpaqueIdSchema, toolCallId: OpaqueIdSchema, sequence: z.number().int().min(0),
  status: z.enum(["open", "answered", "complete", "cancelled"]),
  createdAt: IsoTimestampSchema, answeredAt: IsoTimestampSchema.nullable(),
  firstAnsweredAt: IsoTimestampSchema.nullable().default(null),
  erasedAt: IsoTimestampSchema.nullable().default(null), updatedAt: IsoTimestampSchema.nullable().default(null), explored: explored.default([]),
  elapsedAtCreation: z.number().nonnegative().default(0),
  phase: TutorPhaseSchema.default("independent"),
  hintsUsed: z.number().int().min(0).max(8), draft: z.string().max(10000), result: TutorBlockResultSchema.nullable(),
  attempts: z.array(TutorAttemptSchema).max(3).default([]),
};
export const TutorBlockSchema = z.discriminatedUnion("tool", [
  z.strictObject({ ...blockFields, tool: z.literal("tutor_say"), args: TutorSayInputSchema }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_reply"), args: TutorReplyInputSchema, replyTo: OpaqueIdSchema }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_ask_choice"), args: TutorChoiceInputSchema }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_ask_typed"), args: TutorTypedInputSchema }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_show_model"), args: TutorModelInputSchema }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_show_page"), args: TutorShowPageInputSchema }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_ask_explain"), args: TutorExplainInputSchema }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_finish"), args: TutorFinishInputSchema }),
]);
export const StoredTutorBlockSchema = TutorBlockSchema;
export const TutorSessionResultSchema = z.strictObject({
  summary: text, previousLevel: z.number().int().min(0).max(4).nullable(), level: z.number().int().min(0).max(4).nullable(),
  evidence: z.array(MasteryEvidenceSchema).max(120), missing: z.array(z.string()).max(100), next: z.string(),
  assessments: z.array(z.strictObject({ topicId: OpaqueIdSchema, previousLevel: z.number().int().min(0).max(4).nullable(), level: z.number().int().min(0).max(4).nullable(), dueOn: LearnDateSchema.nullable().default(null) })).max(30),
  clicked: z.array(z.strictObject({ before: z.string().max(200), after: z.string().max(200) })).max(2).default([]), cheatsheet: z.array(z.string().max(300)).max(10).default([]),
});
export const TutorMessageSchema = z.strictObject({ messageId: OpaqueIdSchema, text, createdAt: IsoTimestampSchema, delivered: z.boolean() });
export const TutorSessionSchema = z.strictObject({
  sessionId: OpaqueIdSchema, topicId: OpaqueIdSchema, goal: text,
  mode: z.enum(["topic", "recap", "mock_exam"]), topicIds: z.array(OpaqueIdSchema).min(1).max(30), examId: OpaqueIdSchema.nullable(),
  phase: TutorPhaseSchema.default("independent"),
  initialLevels: z.record(z.string(), z.number().int().min(0).max(4).nullable()),
  status: z.enum(["active", "paused", "completed", "cancelled", "expired", "failed"]),
  startedAt: IsoTimestampSchema, updatedAt: IsoTimestampSchema, finishedAt: IsoTimestampSchema.nullable(),
  budgetSeconds: z.number().int().min(60).max(3600), elapsedSeconds: z.number().nonnegative(),
  activeSince: IsoTimestampSchema.nullable(), wrapStartedAt: IsoTimestampSchema.nullable().default(null), initialLevel: z.number().int().min(0).max(4).nullable(),
  blocks: z.array(StoredTutorBlockSchema).max(120), messages: z.array(TutorMessageSchema).max(100),
  newestBlockId: OpaqueIdSchema.nullable().default(null),
  consecutiveNotes: z.number().int().min(0).max(2).optional(),
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
// Spacing after commas and a closing full stop or quotes don't change an answer: "[1,2,3]." matches "[1, 2, 3]".
export const normalizeTutorAnswer = (value: string) => value.normalize("NFKC").trim()
  .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").replace(/\.$/, "").replace(/\s*([,;:])\s*/g, "$1 ").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");

/** An accepted answer followed only by a unit word counts ("2 shifts", "O(n) time"); a hedge like "2 or 3" doesn't. */
export function typedAnswerMatches(accept: readonly string[], answer: string): boolean {
  const given = normalizeTutorAnswer(answer).replace(/^(?:(?:it's|it is|i get|i think|about|roughly)\s+|(?:x\s*)?=\s*|answer:\s*)/u, "");
  const numeric = (value: string): number | null => {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*\/\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+))?%?$/.test(value)) return null;
    const parts = value.replace(/%$/, "").split("/").map(Number);
    const number = parts[0]! / (parts[1] ?? 1) / (value.endsWith("%") ? 100 : 1);
    return Number.isFinite(number) ? number : null;
  };
  return accept.some(item => {
    const expected = normalizeTutorAnswer(item);
    if (given === expected) return true;
    const actualNumber = numeric(given), expectedNumber = numeric(expected);
    if (actualNumber !== null && expectedNumber !== null && Math.abs(actualNumber - expectedNumber) <= Number.EPSILON * Math.max(Math.abs(actualNumber), Math.abs(expectedNumber))) return true;
    const rest = given.startsWith(`${expected} `) ? given.slice(expected.length + 1) : null;
    return rest !== null && /^\p{L}+(?: \p{L}+)?$/u.test(rest) && !/\b(?:or|not|maybe)\b/.test(rest);
  });
}
export function tutorTimeLeft(session: Pick<TutorSession, "budgetSeconds" | "elapsedSeconds" | "activeSince">, now: string): number {
  return Math.max(0, session.budgetSeconds - session.elapsedSeconds - (session.activeSince ? Math.max(0, (Date.parse(now) - Date.parse(session.activeSince)) / 1000) : 0));
}
export function tutorExpiryTimeLeft(session: Pick<TutorSession, "budgetSeconds" | "elapsedSeconds" | "activeSince" | "wrapStartedAt">, now: string): number {
  const elapsed = session.wrapStartedAt ? (Date.parse(now) - Date.parse(session.wrapStartedAt)) / 1000
    : session.elapsedSeconds + (session.activeSince ? Math.max(0, (Date.parse(now) - Date.parse(session.activeSince)) / 1000) : 0) - session.budgetSeconds;
  return Math.max(0, TUTOR_WRAP_SECONDS - elapsed);
}

/** IPC-safe schema: never send stored tool arguments to the renderer. */
export const PublicTutorBlockSchema = z.discriminatedUnion("tool", [
  z.strictObject({ ...blockFields, tool: z.literal("tutor_say"), args: TutorSayInputSchema }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_reply"), args: TutorReplyInputSchema, replyTo: OpaqueIdSchema }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_ask_choice"), args: z.strictObject({ ...topicScope, ...questionNote, question: text, options: z.array(z.string()) }) }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_ask_typed"), args: z.strictObject({ ...topicScope, ...questionNote, question: text, steps, hints: z.array(z.string()), hasMoreHints: z.boolean() }) }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_ask_explain"), args: z.strictObject({ ...topicScope, ...questionNote, prompt: text, steps, points: z.array(z.strictObject({ text: z.string(), met: z.boolean() })).optional() }) }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_show_model"), args: TutorModelInputSchema }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_show_page"), args: TutorShowPageInputSchema }),
  z.strictObject({ ...blockFields, tool: z.literal("tutor_finish"), args: z.strictObject({ summary: text, missing: z.array(z.string()), next: z.string(), clicked: TutorSessionResultSchema.shape.clicked, cheatsheet: TutorSessionResultSchema.shape.cheatsheet }) }),
]);
export const PublicTutorSessionSchema = TutorSessionSchema.omit({ blocks: true, messages: true }).extend({ blocks: z.array(PublicTutorBlockSchema), messages: z.array(TutorMessageSchema.omit({ delivered: true })) });
export type PublicTutorSession = z.infer<typeof PublicTutorSessionSchema>;
export type PublicTutorBlock = z.infer<typeof PublicTutorBlockSchema>;
export type TutorQuestion = Extract<PublicTutorBlock, { tool: "tutor_ask_choice" | "tutor_ask_typed" | "tutor_ask_explain" }>;
export type TutorVisual = Extract<PublicTutorBlock, { tool: "tutor_show_model" | "tutor_show_page" }>;
export type TutorNote = Extract<PublicTutorBlock, { tool: "tutor_say" }>;
export type TutorBoardView = {
  /** The stop the board is on: a question, or a visual that waits for the student. */
  at: string | null;
  /** The stop after it, once Chalky has made one. */
  following: string | null;
  done: { blockId: string; question: string; answer: string | null; correct: boolean | null }[];
  /** What Chalky wrote since the student's last answer: the teaching that leads into this stop. */
  lead: TutorNote[];
  question: TutorQuestion | null;
  note: string | null;
  visuals: { block: TutorVisual; children: TutorVisual[] }[];
  tries: z.infer<typeof TutorAttemptSchema>[];
  /** Chalky's notes since this stop went up. */
  feedback: TutorNote[];
  newest: string | null;
  chat: ({ kind: "student"; id: string; text: string; createdAt: string } | { kind: "tutor"; id: string; text: string; createdAt: string; replyTo: string })[];
  move: "check" | "next" | "tried" | "finish" | "wait";
};

/**
 * What the board shows, with no layout and no private answer keys; the screen and the rule tests share it.
 * The lesson is a line of stops. `at` is the stop the student is on; without it, the newest.
 * Chalky can be ahead of the student, so a later stop only shows once they move to it.
 */
export function boardView(session: PublicTutorSession, at?: string | null): TutorBoardView {
  const isQuestion = (block: PublicTutorBlock): block is TutorQuestion => block.tool === "tutor_ask_choice" || block.tool === "tutor_ask_typed" || block.tool === "tutor_ask_explain";
  const isVisual = (block: PublicTutorBlock): block is TutorVisual => block.tool === "tutor_show_model" || block.tool === "tutor_show_page";
  const stops = session.blocks.filter(block => isQuestion(block) || (isVisual(block) && block.args.wait !== false && block.status !== "cancelled"));
  const found = stops.findIndex(block => block.blockId === at), index = found >= 0 ? found : stops.length - 1;
  const stop = stops[index] ?? null, following = stops[index + 1] ?? null, question = stop && isQuestion(stop) ? stop : null;
  const notes = (after: number, before: number) => session.blocks.filter((block): block is TutorNote => block.tool === "tutor_say" && block.sequence > after && block.sequence < before);
  // Notes written between tries were about a wrong answer; they fold with the question.
  const before = stops[index - 1] ?? null;
  const lead = notes(before?.sequence ?? -1, stop?.sequence ?? Infinity).filter(block => block.createdAt > (before?.answeredAt ?? ""));
  const feedback = stop ? notes(stop.sequence, following?.sequence ?? Infinity) : [];
  const visuals = session.blocks.filter((block): block is TutorVisual => isVisual(block) && !block.erasedAt && block.status !== "cancelled");
  // Each message, then Chalky's reply to it.
  const chat: TutorBoardView["chat"] = session.messages.flatMap(message => [{ kind: "student" as const, id: message.messageId, text: message.text, createdAt: message.createdAt },
    ...session.blocks.flatMap(block => block.tool === "tutor_reply" && block.replyTo === message.messageId ? [{ kind: "tutor" as const, id: block.blockId, text: block.args.text, createdAt: block.createdAt, replyTo: block.replyTo }] : [])]);
  const attempts = question?.attempts ?? [];
  const move = following ? "next" : !["active", "paused"].includes(session.status) ? "finish" : session.status === "paused" ? "wait"
    : stop?.status === "open" ? question ? "check" : "tried" : "wait";
  const visibleIds = new Set([stop?.blockId, ...lead.map(block => block.blockId), ...feedback.map(block => block.blockId), ...visuals.map(block => block.blockId)]);
  return {
    at: stop?.blockId ?? null, following: following?.blockId ?? null,
    done: stops.slice(0, Math.max(index, 0)).filter(isQuestion).map(block => {
      const answer = block.result?.answer;
      return { blockId: block.blockId, question: block.tool === "tutor_ask_explain" ? block.args.prompt : block.args.question,
        answer: !answer ? null : answer.kind === "typed" ? answer.answer : answer.kind === "explain" ? answer.text : answer.kind === "choice" && block.tool === "tutor_ask_choice" ? block.args.options[answer.picked] ?? null : null,
        correct: block.result?.correct ?? null };
    }),
    lead, question, note: question?.args.note ?? null,
    visuals: visuals.filter(block => !block.args.under).map(block => ({ block, children: visuals.filter(child => child.args.under === block.blockId) })),
    tries: question?.status === "open" ? attempts : attempts.slice(0, -1), feedback,
    newest: session.newestBlockId && visibleIds.has(session.newestBlockId) ? session.newestBlockId : null,
    chat, move,
  };
}
export function publicTutorSession(session: TutorSession): PublicTutorSession {
  return PublicTutorSessionSchema.parse({ ...session, messages: session.messages.map(({ delivered: _delivered, ...message }) => message), blocks: session.blocks.map(block => {
    switch (block.tool) {
      case "tutor_ask_choice": { const { correct: _correct, ...args } = block.args; return { ...block, args }; }
      case "tutor_ask_typed": { const { accept: _accept, hints, ...args } = block.args; return { ...block, args: { ...args, hints: hints.slice(0, block.hintsUsed), hasMoreHints: block.hintsUsed < hints.length } }; }
      case "tutor_ask_explain": {
        const { rubric, ...args } = block.args, met = block.result?.correct === null ? undefined : block.result?.met;
        return { ...block, args: { ...args, ...(met ? { points: rubric.map((text, index) => ({ text, met: met[index] })) } : {}) } };
      }
      case "tutor_finish": return { ...block, args: { summary: block.args.summary, missing: block.args.missing, next: block.args.next, clicked: session.result?.clicked ?? [], cheatsheet: session.result?.cheatsheet ?? [] } };
      default: return block;
    }
  }) });
}
