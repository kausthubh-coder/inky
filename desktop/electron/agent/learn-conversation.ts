import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Unsafe } from "typebox";
import { z } from "zod";
import { LearnExamInputSchema, LearnSourceInputSchema } from "../../shared/learn.js";
import { TutorStartInputSchema, type PublicTutorSession, type TutorStartInput } from "../../shared/tutor.js";

export interface LearningConversationHooks {
  state(): unknown;
  setExam(input: z.infer<typeof LearnExamInputSchema>): unknown | Promise<unknown>;
  startSession(input: TutorStartInput): Promise<PublicTutorSession>;
  importSource(input: z.infer<typeof LearnSourceInputSchema>): unknown | Promise<unknown>;
}
const importInput = LearnSourceInputSchema.omit({ sourceId: true, kind: true });
export function createLearningConversationTools(hooks: LearningConversationHooks, guard: () => void,
  assertSource: (text: string, sourceTarget: string | null) => "paste" | "drive"): readonly ToolDefinition[] {
  const specs = [
    ["learn_set_exam", "Save the student's exam date", LearnExamInputSchema, (value: unknown) => hooks.setExam(LearnExamInputSchema.parse(value))],
    ["learn_start_session", "Start a real tutor topic, recap or mock exam session", TutorStartInputSchema, (value: unknown) => hooks.startSession(TutorStartInputSchema.parse(value))],
    ["learn_import_source", "Import exact syllabus text from the student or a connected-app read", importInput, (value: unknown) => {
      const input = importInput.parse(value), kind = assertSource(input.text, input.sourceTarget);
      return hooks.importSource({ ...input, kind });
    }],
  ] as const;
  return specs.map(([name, description, schema, execute]) => defineTool({ name, label: description, description,
    parameters: Unsafe<Record<string, unknown>>(z.toJSONSchema(schema, { target: "draft-7" })),
    execute: async (_id, input, signal) => {
      guard(); signal?.throwIfAborted();
      const result = await execute(input);
      guard(); signal?.throwIfAborted();
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result };
    },
  }));
}
