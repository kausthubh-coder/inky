import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  InMemoryCredentialStore,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import { PiAgentRuntime } from "../../dist/electron/agent/runtime.js";
import { ManagerCoordinator } from "../../dist/electron/manager/coordinator.js";
import { openLocalStore } from "../../dist/electron/storage/index.js";

const now = "2026-09-01T15:00:00.000Z";

test("a real Pi manager session steers durable work with only repository-backed queue tools", async () => {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-wp06-pi-manager-")));
  const cwd = join(root, "cwd");
  await mkdir(cwd);
  let store;
  let coordinator;
  try {
    store = await openLocalStore(join(root, "data"));
    seedTask(store, "first");
    seedTask(store, "second");
    store.permissionRules.put({
      schemaVersion: 1,
      ruleId: "allow-manager-test",
      scope: "global",
      mode: "attempt",
      updatedAt: now,
    });

    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
      signal: AbortSignal.timeout(3_000),
    });
    const faux = fauxProvider({
      provider: "studi-manager-faux",
      api: "studi-manager-faux",
      tokenSize: { min: 4, max: 4 },
    });
    modelRuntime.registerNativeProvider(faux.provider);
    const runtime = await PiAgentRuntime.create({
      cwd,
      agentDir: join(root, "pi"),
      modelRuntime,
      model: faux.getModel(),
    });
    coordinator = await ManagerCoordinator.create(store, runtime, { now: () => now });
    coordinator.enqueue({ taskId: "task-first" });
    coordinator.enqueue({ taskId: "task-second" });
    await store.artifacts.write({
      frontmatter: {
        schemaVersion: 1,
        kind: "preference",
        artifactId: "student-preferences",
        updatedAt: now,
      },
      content: "Prefer explicit queue receipts.",
    });
    await store.artifacts.write({
      frontmatter: {
        schemaVersion: 1,
        kind: "memory",
        artifactId: "course-note",
        updatedAt: now,
      },
      content: "Second is the requested task.",
    });

    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(
          "manager_queue_steer_next",
          { taskId: "task-second" },
          { id: "manager-steer-call" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Task second is now next."),
    ]);
    const result = await coordinator.runManagerTurn(
      "Move task-second to the front, then report what the queue confirms.",
      ["course-note"],
    );
    assert.equal(result.outcome, "completed");
    assert.equal(result.state.entries[0].taskId, "task-second");
    assert.match(result.text, /Task second is now next/);

    const managerLink = store.manager.getManagerSession();
    const transcript = await readFile(managerLink.sessionPath, "utf8");
    assert.match(transcript, /# Global preferences/);
    assert.match(transcript, /# Scoped memories/);
    assert.match(transcript, /manager_queue_steer_next/);
    assert.doesNotMatch(transcript, /patternId/);
  } finally {
    coordinator?.dispose();
    store?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

function seedTask(store, suffix) {
  const assignmentId = `assignment-${suffix}`;
  const taskId = `task-${suffix}`;
  store.assignments.put({
    schemaVersion: 1,
    assignmentId,
    courseId: "course-manager",
    title: `Assignment ${suffix}`,
    sourceTarget: `https://school.example.edu/assignments/${suffix}`,
    dueAt: "2026-09-03T12:00:00.000Z",
    discoveredAt: now,
    evidence: [],
  });
  const task = {
    schemaVersion: 1,
    taskId,
    assignmentId,
    state: "discovered",
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
  store.tasks.append({
    expectedRevision: null,
    projection: task,
    event: {
      schemaVersion: 1,
      eventId: `event-${suffix}`,
      aggregateType: "task",
      aggregateId: taskId,
      runId: `run-${suffix}`,
      sequence: 0,
      occurredAt: now,
      type: "task_created",
      payload: {
        taskId,
        assignmentId,
        state: "discovered",
        revision: 0,
        createdAt: now,
        updatedAt: now,
      },
    },
  });
}
