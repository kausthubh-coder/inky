import { z } from "zod";

import { EventEnvelopeSchema } from "./event.js";
import { AssignmentIdSchema, EventIdSchema, RunIdSchema, TaskIdSchema } from "./ids.js";
import {
  IsoTimestampSchema,
  SchemaVersionSchema,
  STUDI_SCHEMA_VERSION,
} from "./schema-version.js";

export const TaskStateSchema = z.enum([
  "discovered",
  "ignored",
  "queued",
  "working",
  "needs_user",
  "ready_review",
  "submitting",
  "submitted",
  "preserved",
  "failed",
  "cancelled",
]);

export type TaskState = z.infer<typeof TaskStateSchema>;

export const TERMINAL_TASK_STATES = Object.freeze([
  "ignored",
  "submitted",
  "preserved",
  "failed",
  "cancelled",
] as const satisfies readonly TaskState[]);

export const TASK_TRANSITIONS = Object.freeze({
  discovered: Object.freeze(["ignored", "queued"]),
  ignored: Object.freeze([]),
  queued: Object.freeze(["working", "cancelled"]),
  working: Object.freeze(["needs_user", "ready_review", "submitting", "failed", "cancelled"]),
  needs_user: Object.freeze(["working", "queued", "preserved", "cancelled"]),
  ready_review: Object.freeze(["submitting", "submitted", "preserved", "needs_user", "cancelled"]),
  submitting: Object.freeze(["submitted", "needs_user", "working", "failed"]),
  submitted: Object.freeze([]),
  preserved: Object.freeze([]),
  failed: Object.freeze([]),
  cancelled: Object.freeze([]),
} as const satisfies Readonly<Record<TaskState, readonly TaskState[]>>);

export const TaskSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  taskId: TaskIdSchema,
  assignmentId: AssignmentIdSchema,
  state: TaskStateSchema,
  revision: z.number().int().nonnegative(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});

export type Task = z.infer<typeof TaskSchema>;

export const TaskCreatedEventPayloadSchema = z.strictObject({
  taskId: TaskIdSchema,
  assignmentId: AssignmentIdSchema,
  state: z.literal("discovered"),
  revision: z.literal(0),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});

export const TaskCreatedEventSchema = EventEnvelopeSchema.extend({
  aggregateType: z.literal("task"),
  type: z.literal("task_created"),
  payload: TaskCreatedEventPayloadSchema,
});

export type TaskCreatedEventPayload = z.infer<typeof TaskCreatedEventPayloadSchema>;
export type TaskCreatedEvent = z.infer<typeof TaskCreatedEventSchema>;

export const TaskTransitionCommandSchema = z.strictObject({
  type: z.literal("transition"),
  to: TaskStateSchema,
  eventId: EventIdSchema,
  runId: RunIdSchema,
  sequence: z.number().int().nonnegative(),
  occurredAt: IsoTimestampSchema,
  reason: z.string().min(1).max(1_000).optional(),
});

export type TaskTransitionCommand = z.infer<typeof TaskTransitionCommandSchema>;

export const TaskTransitionEventPayloadSchema = z.strictObject({
  taskId: TaskIdSchema,
  assignmentId: AssignmentIdSchema,
  from: TaskStateSchema,
  to: TaskStateSchema,
  revision: z.number().int().positive(),
  reason: z.string().min(1).max(1_000).optional(),
});

export type TaskTransitionEventPayload = z.infer<typeof TaskTransitionEventPayloadSchema>;

export const TaskTransitionEventSchema = EventEnvelopeSchema.extend({
  aggregateType: z.literal("task"),
  type: z.literal("task_state_changed"),
  payload: TaskTransitionEventPayloadSchema,
});

export type TaskTransitionEvent = z.infer<typeof TaskTransitionEventSchema>;

export const TaskEventSchema = z.discriminatedUnion("type", [
  TaskCreatedEventSchema,
  TaskTransitionEventSchema,
]);

export type TaskEvent = z.infer<typeof TaskEventSchema>;

export type TaskTransitionResult =
  | {
      readonly ok: true;
      readonly task: Task;
      readonly event: TaskTransitionEvent;
    }
  | {
      readonly ok: false;
      readonly rejection: {
        readonly code: "invalid_task_transition";
        readonly taskId: string;
        readonly from: TaskState;
        readonly to: TaskState;
        readonly allowed: readonly TaskState[];
      };
    };

export function transitionTask(current: Task, command: TaskTransitionCommand): TaskTransitionResult {
  const allowed = TASK_TRANSITIONS[current.state] as readonly TaskState[];
  if (!allowed.includes(command.to)) {
    return {
      ok: false,
      rejection: {
        code: "invalid_task_transition",
        taskId: current.taskId,
        from: current.state,
        to: command.to,
        allowed,
      },
    };
  }

  const task: Task = {
    ...current,
    state: command.to,
    revision: current.revision + 1,
    updatedAt: command.occurredAt,
  };
  const event: TaskTransitionEvent = {
    schemaVersion: STUDI_SCHEMA_VERSION,
    eventId: command.eventId,
    aggregateType: "task",
    aggregateId: current.taskId,
    runId: command.runId,
    sequence: command.sequence,
    occurredAt: command.occurredAt,
    type: "task_state_changed",
    payload: {
      taskId: current.taskId,
      assignmentId: current.assignmentId,
      from: current.state,
      to: command.to,
      revision: task.revision,
      ...(command.reason === undefined ? {} : { reason: command.reason }),
    },
  };

  return { ok: true, task, event };
}
