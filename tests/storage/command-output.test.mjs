import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { commandOutput } from "../../dist/electron/assignment/command-output.js";
import { openLocalStore } from "../../dist/electron/storage/index.js";

const now = "2026-09-19T12:00:00.000Z";
const finished = { schemaVersion: 1, type: "tool_finished", toolCallId: "test-run", toolName: "powershell", outcome: "failed", durationMs: 25 };

test("command panel accepts only shell text, strips terminal escapes and bounds stored output", () => {
  assert.equal(commandOutput({ ...finished, toolName: "browser_read", result: "private page" }, now), undefined);
  assert.equal(commandOutput({ schemaVersion: 1, type: "tool_started", toolCallId: "a", toolName: "powershell", arguments: { command: "private arguments" } }, now), undefined);
  const output = commandOutput({ ...finished, result: { content: [
    { type: "text", text: "\u001b[31m1 test failed\u001b[0m" },
    { type: "image", data: "not text" },
  ], other: "not output" } }, now);
  assert.equal(output.text, "1 test failed");
  assert.equal(output.outcome, "failed");
  assert.equal(output.durationMs, 25);
  const long = commandOutput({ ...finished, result: "x".repeat(25_000) + "last line" }, now);
  assert.equal(long.text.length, 20_000);
  assert.equal(long.truncated, true);
  assert.ok(long.text.endsWith("last line"));
});

test("assignment command history is bounded, deduplicated, isolated and survives restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-command-output-"));
  let store;
  try {
    store = await openLocalStore(root);
    for (const taskId of ["task-a", "task-b"]) store.lifecycle.putExecution({
      schemaVersion: 1, taskId, assignmentId: `assignment-${taskId}`, phase: "working",
      taskBudget: { maxAgentTurns: 24, maxRecoveryAttempts: 2 }, turnCount: 0, attemptCount: 0, updatedAt: now,
    });
    for (let i = 0; i < 25; i++) {
      const event = { ...finished, toolCallId: `command-${i}` };
      const output = commandOutput({ ...event, result: `Result ${i}` }, now);
      store.lifecycle.recordActivity("task-a", event, undefined, output);
      store.lifecycle.recordActivity("task-a", event, undefined, output);
    }
    assert.equal(store.lifecycle.getExecution("task-a").commandOutputs.length, 20);
    assert.equal(store.lifecycle.getExecution("task-b").commandOutputs, undefined);
    store.close();
    store = await openLocalStore(root);
    const saved = store.lifecycle.getExecution("task-a");
    assert.equal(saved.commandOutputs[0].text, "Result 5");
    assert.equal(saved.commandOutputs.at(-1).text, "Result 24");
    assert.equal(saved.activity.some(event => "result" in event), false);
  } finally { store?.close(); await rm(root, { recursive: true, force: true }); }
});
