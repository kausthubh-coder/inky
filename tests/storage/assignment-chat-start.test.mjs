import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConversationCoordinator } from "../../dist/electron/agent/conversation-coordinator.js";
import { FakeAgentRuntime } from "../../dist/electron/agent/runtime.js";
import { ManagerCoordinator } from "../../dist/electron/manager/coordinator.js";
import { openLocalStore } from "../../dist/electron/storage/index.js";

const now = "2026-09-10T12:00:00.000Z";

for (const scenario of ["start", "cancel", "permission changed", "browser busy"]) {
  test(`assignment chat hands off after its turn: ${scenario}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "studi-assignment-chat-"));
    const store = await openLocalStore(root);
    const base = new FakeAgentRuntime();
    let chat;
    let prompting = false;
    let starts = 0;
    let requestCalls = 0;
    const rule = { schemaVersion: 1, ruleId: "allow", scope: "global", mode: "attempt", updatedAt: now };
    store.permissionRules.put(rule);
    for (const id of ["selected", "other"]) seedTask(store, id);
    const target = { kind: "assignment", assignmentId: "selected" };
    const manager = await ManagerCoordinator.create(store, base, {
      startAssignment: async taskId => {
        assert.equal(prompting, false, "the chat session has finished before the worker starts");
        assert.equal(taskId, "task-selected", "only the addressed assignment can start");
        starts++;
        return manager.startTask(taskId);
      },
    });
    const runtime = {
      createJobSession: async (_target, tools) => {
        const listeners = new Set();
        return {
          sessionId: "chat-session", sessionPath: join(root, "chat.jsonl"),
          subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
          async prompt(prompt) {
            prompting = true;
            try {
              if (prompt.endsWith("do it")) {
                const start = tools.find(tool => tool.name === "assignment_start");
                assert.ok(start, "assignment conversations need a scoped start tool");
                assert.deepEqual(start.parameters.properties, {}, "the model cannot supply another assignment ID");
                await start.execute("start-1", {});
                await start.execute("start-2", {});
                requestCalls += 2;
                assert.equal(starts, 0, "tool requests defer handoff until the turn ends");
                if (scenario === "cancel") await chat.stop(target);
                if (scenario === "permission changed") store.permissionRules.put({ ...rule, mode: "do_not_attempt" });
                if (scenario === "browser busy") {
                  manager.enqueue({ taskId: "task-other" });
                  await manager.startTask("task-other");
                }
              }
              for (const fn of listeners) fn({ schemaVersion: 1, type: "text", delta: "I’ll start this assignment." });
              for (const fn of listeners) fn({ schemaVersion: 1, type: "terminal", outcome: "completed" });
            } finally { prompting = false; }
          },
          async abort() {}, async replace() {},
          dispose() { assert.equal(prompting, false, "do not dispose an active tool call"); },
        };
      },
    };
    chat = new ConversationCoordinator(store, runtime, manager);
    try {
      chat.selectAssignment("selected");
      await chat.send(target, "What does this ask?");
      assert.equal(starts, 0, "opening and discussing an assignment leaves it idle");
      const metadata = { clientMessageId: "00000000-0000-4000-8000-000000000001" };
      const result = await chat.send(target, "do it", metadata);
      assert.equal(requestCalls, 2);
      if (scenario === "start") {
        assert.equal(result.outcome, "completed");
        assert.equal(starts, 1);
        assert.equal(result.job.phase, "working", "the reply cannot overwrite the worker's state");
        assert.equal(result.job.sessionId, manager.state().lease.workerSessionId);
        assert.equal(result.job.claim.target.assignmentId, "selected");
        assert.equal(store.tasks.get("task-other").state, "discovered");
        await chat.send(target, "do it", metadata);
        assert.equal(starts, 1, "retried message delivery cannot start another worker");
      } else {
        assert.equal(starts, 0);
        assert.equal(result.outcome, scenario === "cancel" ? "aborted" : "failed");
        if (scenario !== "cancel") assert.match(result.text, /couldn’t start this assignment/);
      }
    } finally {
      chat.dispose(); manager.dispose(); store.close();
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
}

function seedTask(store, id) {
  const sourceTarget = `https://school.example.edu/assignments/${id}`;
  store.assignments.put({ schemaVersion: 1, assignmentId: id, courseId: "course", title: id, sourceTarget, discoveredAt: now, lastVerifiedScanId: "scan", evidence: [{ schemaVersion: 1, evidenceId: `evidence-${id}`, reference: `evidence-${id}`, kind: "agent_observation", sourceTarget, capturedAt: now, summary: `Observed ${id}` }] });
  const task = { schemaVersion: 1, taskId: `task-${id}`, assignmentId: id, state: "discovered", revision: 0, createdAt: now, updatedAt: now };
  const { schemaVersion, ...payload } = task;
  store.tasks.append({ expectedRevision: null, projection: task, event: { schemaVersion: 1, eventId: `event-${id}`, aggregateType: "task", aggregateId: task.taskId, runId: `run-${id}`, sequence: 0, occurredAt: now, type: "task_created", payload } });
}
