import { z } from "zod";

import {
  AssignmentIdSchema,
  CourseIdSchema,
  PatternIdSchema,
  TaskIdSchema,
} from "./ids.js";
import { PermissionResolutionSchema } from "./permission.js";
import { IsoTimestampSchema, SchemaVersionSchema } from "./schema-version.js";

export const ConfirmedPatternMatchSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  assignmentId: AssignmentIdSchema,
  courseId: CourseIdSchema,
  patternId: PatternIdSchema,
  confirmedAt: IsoTimestampSchema,
});

export const ManagerQueueEntrySchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  taskId: TaskIdSchema,
  assignmentId: AssignmentIdSchema,
  courseId: CourseIdSchema,
  dueAt: IsoTimestampSchema.optional(),
  priority: z.number().int().nonnegative(),
  enqueuedAt: IsoTimestampSchema,
  permission: PermissionResolutionSchema,
});

export const BrowserWorkerLeaseSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  leaseId: z.literal("browser-worker"),
  taskId: TaskIdSchema,
  state: z.enum(["acquiring", "active"]),
  acquiredAt: IsoTimestampSchema,
  workerSessionId: z.string().min(1).optional(),
  workerSessionPath: z.string().min(1).optional(),
}).superRefine((lease, context) => {
  if (lease.state === "active" && (!lease.workerSessionId || !lease.workerSessionPath)) {
    context.addIssue({
      code: "custom",
      message: "An active browser-worker lease requires its worker session identity and path",
    });
  }
  if (lease.state === "acquiring" && (lease.workerSessionId || lease.workerSessionPath)) {
    context.addIssue({
      code: "custom",
      message: "An acquiring browser-worker lease cannot claim a worker session",
    });
  }
});

export const ManagerSessionLinkSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  sessionId: z.string().min(1),
  sessionPath: z.string().min(1),
  updatedAt: IsoTimestampSchema,
});

export const ManagerStateSchema = z.strictObject({
  entries: z.array(ManagerQueueEntrySchema),
  lease: BrowserWorkerLeaseSchema.nullable(),
});

export type ConfirmedPatternMatch = z.infer<typeof ConfirmedPatternMatchSchema>;
export type ManagerQueueEntry = z.infer<typeof ManagerQueueEntrySchema>;
export type BrowserWorkerLease = z.infer<typeof BrowserWorkerLeaseSchema>;
export type ManagerSessionLink = z.infer<typeof ManagerSessionLinkSchema>;
export type ManagerState = z.infer<typeof ManagerStateSchema>;
