import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import {
  TASK_TRANSITIONS,
  TERMINAL_TASK_STATES,
  TaskStateSchema,
  TaskTransitionEventSchema,
  transitionTask,
} from "../../dist/shared/index.js";

import { task, taskTransitionCommand } from "./fixtures.mjs";

const expectedTransitions = {
  discovered: ["ignored", "queued"],
  ignored: [],
  queued: ["working", "cancelled"],
  working: ["needs_user", "ready_review", "submitting", "failed", "cancelled"],
  needs_user: ["working", "queued", "preserved", "cancelled"],
  ready_review: ["submitting", "submitted", "preserved", "needs_user", "cancelled"],
  submitting: ["submitted", "needs_user", "working", "failed"],
  submitted: [],
  preserved: [],
  failed: [],
  cancelled: [],
};
const states = TaskStateSchema.options;

function command(to) {
  return { ...taskTransitionCommand, to };
}

test("task transition and terminal tables exactly match the dossier", () => {
  assert.deepEqual(TASK_TRANSITIONS, expectedTransitions);
  assert.deepEqual([...TERMINAL_TASK_STATES], ["ignored", "submitted", "preserved", "failed", "cancelled"]);
});

test("every allowed transition returns a new task and event", () => {
  for (const from of states) {
    for (const to of expectedTransitions[from]) {
      const current = { ...task, state: from, revision: 7 };
      const before = structuredClone(current);
      const result = transitionTask(current, command(to));

      assert.equal(result.ok, true, `${from} -> ${to} rejected`);
      assert.deepEqual(current, before, `${from} -> ${to} mutated input`);
      assert.notEqual(result.task, current);
      assert.equal(result.task.state, to);
      assert.equal(result.task.revision, 8);
      assert.deepEqual(
        {
          from: result.event.payload.from,
          to: result.event.payload.to,
          revision: result.event.payload.revision,
        },
        { from, to, revision: 8 },
      );
      assert.deepEqual(Object.keys(result.event), [
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
      assert.equal(TaskTransitionEventSchema.safeParse(result.event).success, true);
      assert.equal(result.event.aggregateId, current.taskId);
      assert.equal(result.event.runId, taskTransitionCommand.runId);
      assert.equal(result.event.type, "task_state_changed");
    }
  }
});

test("all other state pairs reject without mutating the input", () => {
  for (const from of states) {
    for (const to of states) {
      if (expectedTransitions[from].includes(to)) {
        continue;
      }
      const current = { ...task, state: from };
      const before = structuredClone(current);
      const result = transitionTask(current, command(to));
      assert.equal(result.ok, false, `${from} -> ${to} was accepted`);
      assert.equal(result.rejection.code, "invalid_task_transition");
      assert.deepEqual(current, before, `${from} -> ${to} mutated input`);
    }
  }
});

test("invalid transitions never mutate arbitrary valid task values", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...states),
      fc.constantFrom(...states),
      fc.nat(),
      (from, to, revision) => {
        fc.pre(!expectedTransitions[from].includes(to));
        const current = { ...task, state: from, revision };
        const before = structuredClone(current);
        const result = transitionTask(current, command(to));
        assert.equal(result.ok, false);
        assert.deepEqual(current, before);
      },
    ),
  );
});
