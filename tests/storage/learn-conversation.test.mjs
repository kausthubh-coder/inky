import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConversationCoordinator } from "../../dist/electron/agent/conversation-coordinator.js";
import { FakeAgentRuntime } from "../../dist/electron/agent/runtime.js";
import { ManagerCoordinator } from "../../dist/electron/manager/coordinator.js";
import { openLocalStore } from "../../dist/electron/storage/index.js";
import { LearnRepository } from "../../dist/electron/storage/learn-records.js";
import { buildAgentTurn } from "../../dist/agent-system/turn-builder.js";

test("Learn is an owned persisted conversation with bounded learning, notes and connected-app tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-learn-chat-")), store = await openLocalStore(root), base = new FakeAgentRuntime();
  const manager = await ManagerCoordinator.create(store, base);
  let tools, target, started;
  const runtime = { createJobSession: async (nextTarget, supplied, sessionTarget) => { target = nextTarget; tools = supplied; return base.createJobSession(nextTarget, supplied, sessionTarget); } };
  const repo = new LearnRepository(store.database, "student-a");
  const learning = { state: () => repo.learnState("2026-09-19"), setExam: input => repo.setExam(input), importSource: input => repo.importSource(input),
    startSession: async input => { started = input; return { sessionId: "actual-session", status: "active" }; } };
  let chat = new ConversationCoordinator(store, runtime, manager, { ownerSubject: "student-a", learning });
  try {
    const result = await chat.send({ kind: "learn" }, "Remember I prefer diagrams.\nSyllabus: Midterm 2026-10-02. Algebra 100%.");
    assert.equal(result.outcome, "completed", result.text);
    assert.equal(target.kind, "learn");
    assert.equal(result.job.ownerSubject, "student-a");
    assert.ok(tools.some(tool => tool.name === "learn_start_session"));
    assert.ok(tools.some(tool => tool.name === "learn_set_exam"));
    assert.ok(tools.some(tool => tool.name === "note_upsert"));
    assert.equal(tools.some(tool => tool.name.startsWith("queue_") || tool.name.startsWith("browser_")), false);
    const invoke = (name, input) => tools.find(tool => tool.name === name).execute(name, input);
    await invoke("learn_set_exam", { courseId: null, title: "Midterm", date: "2026-10-02" });
    await invoke("learn_start_session", { topic: "Algebra" });
    assert.equal(started.topic, "Algebra");
    await invoke("learn_import_source", { courseId: null, title: "Syllabus", sourceTarget: null, text: "Midterm 2026-10-02. Algebra 100%." });
    await assert.rejects(invoke("learn_import_source", { courseId: null, title: "Invented", sourceTarget: "https://drive.test/private", text: "Unobserved source text" }), /Read this source/);
    await invoke("note_upsert", { key: "learning-style", title: "Diagrams", content: "I prefer diagrams.", requestQuote: "Remember I prefer diagrams." });
    assert.equal(store.notes.list()[0].subjectId, "student-a");
    await assert.rejects(invoke("note_upsert", { key: "made-up", title: "False", content: "Guessed preference", requestQuote: "I like poems" }), /Quote the student/);
    assert.equal(repo.mastery().length, 0);
    const id = result.job.jobId;
    chat.dispose();
    chat = new ConversationCoordinator(store, runtime, manager, { ownerSubject: "student-b", learning });
    assert.notEqual(chat.state({ kind: "learn" }).job.jobId, id);
    assert.equal(chat.state({ kind: "learn" }).job.messages.length, 0);
    const turn = await buildAgentTurn({ target: { kind: "learn" }, phase: "conversing", hasBrowserClaim: false }, "Quiz me");
    assert.equal(turn.role, "learn"); assert.ok(turn.toolNames.includes("learn_start_session")); assert.ok(!turn.toolNames.includes("browser_submit"));
  } finally { chat.dispose(); manager.dispose(); store.close(); await rm(root, { recursive: true, force: true }); }
});

test("homework suggestions are durable labelled hints without weights, exam scope, or mastery", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-homework-hints-")), store = await openLocalStore(root);
  try {
    const repo = new LearnRepository(store.database, "student-a");
    repo.syncHomeworkHints([{ assignmentId: "hw1", courseId: "math", title: "Sampling homework" }]);
    const first = repo.topics()[0];
    assert.equal(first.origin, "homework_hint"); assert.equal(first.weight, null); assert.equal(first.examId, null);
    repo.syncHomeworkHints([{ assignmentId: "hw1", courseId: "math", title: "Sampling homework" }]);
    assert.equal(repo.topics().length, 1); assert.equal(repo.topics()[0].topicId, first.topicId);
    assert.deepEqual(repo.mastery(), []); assert.equal(repo.learnState("2026-09-19").plan.readiness.percent, null);
    assert.deepEqual(new LearnRepository(store.database, "student-b").topics(), []);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});
