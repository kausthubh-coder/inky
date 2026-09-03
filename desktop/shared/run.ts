import { z } from "zod";

import { RunIdSchema, TaskIdSchema } from "./ids.js";
import { IsoTimestampSchema, SchemaVersionSchema } from "./schema-version.js";

export const RunStateSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);

export const RunSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  runId: RunIdSchema,
  taskId: TaskIdSchema,
  state: RunStateSchema,
  revision: z.number().int().nonnegative(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});

export type RunState = z.infer<typeof RunStateSchema>;
export type Run = z.infer<typeof RunSchema>;
