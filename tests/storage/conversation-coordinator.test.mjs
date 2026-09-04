import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ConversationCoordinator } from "../../dist/electron/agent/conversation-coordinator.js";
import { FakeAgentRuntime } from "../../dist/electron/agent/runtime.js";
import { ManagerCoordinator } from "../../dist/electron/manager/coordinator.js";
import { openLocalStore } from "../../dist/electron/storage/index.js";

test("addressed sends keep home separate and resume one assignment job across restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-conversations-"));
  let store;
  let manager;
  let conversations;
  try {
    store = await openLocalStore(root);
    store.assignments.put({
      schemaVersion: 1,
      assignmentId: "assignment-statistics",
      courseId: "course-statistics",
      title: "Confidence intervals",
      sourceTarget: "https://school.example.edu/assignments/statistics",
      discoveredAt: "2026-09-03T12:00:00.000Z",
      lastVerifiedScanId: "scan-1",
      evidence: [],
    });
    const runtime = new FakeAgentRuntime();
    manager = await ManagerCoordinator.create(store, runtime);
    conversations = new ConversationCoordinator(store, runtime, manager);

    const first = await conversations.send(
      { kind: "assignment", assignmentId: "assignment-statistics" },
      "What does this ask?",
    );
    const second = await conversations.send(
      { kind: "assignment", assignmentId: "assignment-statistics" },
      "Give me the next step.",
    );
    const home = await conversations.send({ kind: "home" }, "What is next this week?");
    assert.equal(second.job.jobId, first.job.jobId);
    assert.equal(second.job.turnIndex, 2);
    assert.equal(second.job.messages.length, 4);
    assert.notEqual(home.job.jobId, first.job.jobId);
    assert.deepEqual(first.job.target, { kind: "assignment", assignmentId: "assignment-statistics" });

    const assignmentPath = store.agentJobs.get(first.job.jobId).sessionPath;
    conversations.dispose();
    manager.dispose();
    store.close();

    store = await openLocalStore(root);
    const restartedRuntime = new FakeAgentRuntime();
    manager = await ManagerCoordinator.create(store, restartedRuntime);
    conversations = new ConversationCoordinator(store, restartedRuntime, manager);
    const third = await conversations.send(
      { kind: "assignment", assignmentId: "assignment-statistics" },
      "Check that again.",
    );
    assert.equal(third.job.jobId, first.job.jobId);
    assert.equal(third.job.turnIndex, 3);
    assert.equal(third.job.messages.length, 6);
    assert.equal(store.agentJobs.get(first.job.jobId).sessionPath, assignmentPath);
    assert.equal(conversations.selectAssignment("assignment-statistics").job.jobId, first.job.jobId);
    assert.throws(() => conversations.selectAssignment("missing"), /does not exist/);
  } finally {
    conversations?.dispose();
    manager?.dispose();
    store?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
