import { z } from "zod";
import { AssignmentIdSchema, CourseIdSchema, TaskIdSchema } from "./ids.js";
import { IsoTimestampSchema } from "./schema-version.js";

export const CorrectAssignmentInputSchema = z.discriminatedUnion("correction", [
  z.strictObject({ assignmentId: AssignmentIdSchema, correction: z.literal("due_date"), dueAt: IsoTimestampSchema }),
  z.strictObject({ assignmentId: AssignmentIdSchema, correction: z.enum(["not_homework", "already_done"]), reason: z.string().trim().min(1).max(500).optional() }),
]);
export const AddAssignmentInputSchema = z.strictObject({ text: z.string().trim().min(1).max(4096), courseId: CourseIdSchema.optional() });
export const SetAssignmentOwnerInputSchema = z.strictObject({ assignmentId: AssignmentIdSchema, owner: z.enum(["student", "inky"]) });
export const ReorderQueueInputSchema = z.strictObject({ taskIds: z.array(TaskIdSchema).min(1).max(1000).refine(ids => new Set(ids).size === ids.length, "Choose each task once") });
export type CorrectAssignmentInput = z.infer<typeof CorrectAssignmentInputSchema>;
export type AddAssignmentInput = z.infer<typeof AddAssignmentInputSchema>;
export type SetAssignmentOwnerInput = z.infer<typeof SetAssignmentOwnerInputSchema>;
