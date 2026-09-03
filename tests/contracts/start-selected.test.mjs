import assert from "node:assert/strict";
import test from "node:test";

import { startSelectedAssignment } from "../../dist/electron/assignment/start-selected.js";

test("start-while-busy does not enqueue or steer another assignment", async () => {
  const calls = [];
  const store = {
    lifecycle: {
      getActiveExecution: () => ({ phase: "working", taskId: "task-busy", assignmentId: "assignment-busy" }),
    },
  };
  const manager = {
    enqueue: (input) => calls.push(["enqueue", input.taskId]),
    steerNext: (taskId) => calls.push(["steer", taskId]),
  };
  const executions = {
    start: async (taskId) => {
      calls.push(["start", taskId]);
    },
  };

  await assert.rejects(startSelectedAssignment(store, manager, executions, "task-waiting"), /already on another page/);
  assert.deepEqual(calls, []);
});

test("start-when-idle enqueues, steers, then starts that task", async () => {
  const calls = [];
  const store = { lifecycle: { getActiveExecution: () => null } };
  const manager = {
    enqueue: (input) => calls.push(["enqueue", input.taskId]),
    steerNext: (taskId) => calls.push(["steer", taskId]),
  };
  const executions = {
    start: async (taskId) => {
      calls.push(["start", taskId]);
    },
  };

  await startSelectedAssignment(store, manager, executions, "task-waiting");
  assert.deepEqual(calls, [
    ["enqueue", "task-waiting"],
    ["steer", "task-waiting"],
    ["start", "task-waiting"],
  ]);
});
