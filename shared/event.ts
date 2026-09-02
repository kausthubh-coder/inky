import { z } from "zod";

import { EventIdSchema, OpaqueIdSchema, RunIdSchema } from "./ids.js";
import { IsoTimestampSchema, SchemaVersionSchema } from "./schema-version.js";

export const EventAggregateTypeSchema = z.enum(["assignment", "task", "run"]);

export const EventEnvelopeSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  eventId: EventIdSchema,
  aggregateType: EventAggregateTypeSchema,
  aggregateId: OpaqueIdSchema,
  runId: RunIdSchema,
  sequence: z.number().int().nonnegative(),
  occurredAt: IsoTimestampSchema,
  type: z.string().min(1).max(256),
  payload: z.record(z.string(), z.json()),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

export type EventOrderResult =
  | { readonly ok: true; readonly sequence: number }
  | {
      readonly ok: false;
      readonly rejection: {
        readonly code: "event_sequence_not_increasing";
        readonly previousSequence: number;
        readonly receivedSequence: number;
      };
    };

export function verifyEventOrder(
  previousSequence: number | null,
  next: Pick<EventEnvelope, "sequence">,
): EventOrderResult {
  if (previousSequence === null || next.sequence > previousSequence) {
    return { ok: true, sequence: next.sequence };
  }

  return {
    ok: false,
    rejection: {
      code: "event_sequence_not_increasing",
      previousSequence,
      receivedSequence: next.sequence,
    },
  };
}
