import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import { EventEnvelopeSchema, verifyEventOrder } from "../../dist/shared/index.js";

import { event } from "./fixtures.mjs";

test("event envelopes require non-negative integer sequences", () => {
  assert.equal(EventEnvelopeSchema.safeParse(event).success, true);
  assert.equal(EventEnvelopeSchema.safeParse({ ...event, sequence: -1 }).success, false);
  assert.equal(EventEnvelopeSchema.safeParse({ ...event, sequence: 1.5 }).success, false);
});

test("event envelopes use exactly the canonical run-correlated fields", () => {
  assert.deepEqual(Object.keys(EventEnvelopeSchema.parse(event)), [
    "schemaVersion",
    "eventId",
    "aggregateType",
    "aggregateId",
    "runId",
    "sequence",
    "occurredAt",
    "type",
    "payload",
  ]);
  assert.equal(EventEnvelopeSchema.safeParse({ ...event, runId: undefined }).success, false);
  assert.equal(
    EventEnvelopeSchema.safeParse({ ...event, type: undefined, eventType: event.type }).success,
    false,
  );
});

test("event order accepts the first or increasing sequence", () => {
  assert.deepEqual(verifyEventOrder(null, { sequence: 0 }), { ok: true, sequence: 0 });
  assert.deepEqual(verifyEventOrder(2, { sequence: 3 }), { ok: true, sequence: 3 });
  assert.deepEqual(verifyEventOrder(2, { sequence: 9 }), { ok: true, sequence: 9 });
});

test("event order rejects duplicate and decreasing sequences", () => {
  for (const receivedSequence of [4, 3, 0]) {
    assert.deepEqual(verifyEventOrder(4, { sequence: receivedSequence }), {
      ok: false,
      rejection: {
        code: "event_sequence_not_increasing",
        previousSequence: 4,
        receivedSequence,
      },
    });
  }
});

test("event ordering property accepts exactly the strictly increasing pairs", () => {
  fc.assert(
    fc.property(fc.nat(), fc.nat(), (previous, received) => {
      assert.equal(verifyEventOrder(previous, { sequence: received }).ok, received > previous);
    }),
  );
});
