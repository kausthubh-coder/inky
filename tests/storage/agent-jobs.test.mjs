import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openLocalStore } from "../../dist/electron/storage/index.js";

const createdAt = "2026-09-03T12:00:00.000Z";

test("agent jobs keep one durable thread per target and immutable ordered messages", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-agent-jobs-"));
  let store;
  try {
    store = await openLocalStore(root);
    const job = {
      schemaVersion: 1,
      jobId: "job-statistics",
      target: { kind: "assignment", assignmentId: "assignment-statistics" },
      phase: "conversing",
      turnIndex: 1,
      runId: "run-statistics-1",
      sessionId: "session-statistics",
      claim: null,
      messages: [
        { messageId: "message-user", role: "user", text: "What does this ask?", createdAt, turnIndex: 1 },
        { messageId: "message-inky", role: "assistant", text: "It asks for a confidence interval.", createdAt: "2026-09-03T12:00:01.000Z", turnIndex: 1 },
      ],
      createdAt,
      updatedAt: "2026-09-03T12:00:01.000Z",
    };
    store.agentJobs.put(job, "C:/owned/sessions/statistics.jsonl");
    assert.deepEqual(store.agentJobs.getByTarget(job.target), {
      job,
      sessionPath: "C:/owned/sessions/statistics.jsonl",
    });

    store.close();
    store = await openLocalStore(root);
    assert.deepEqual(store.agentJobs.get("job-statistics")?.job.messages, job.messages);
    assert.throws(
      () => store.agentJobs.appendMessage("job-statistics", { ...job.messages[0], text: "changed" }),
      /immutable/,
    );
    assert.throws(
      () => store.agentJobs.put({ ...job, jobId: "second-job" }),
      /UNIQUE constraint failed/,
    );
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
