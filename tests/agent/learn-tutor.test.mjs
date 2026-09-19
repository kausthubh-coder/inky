import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StudiSqliteDatabase } from "../../dist/electron/storage/database.js";
import { LearnRepository } from "../../dist/electron/storage/learn-records.js";
import { TutorCoordinator } from "../../dist/electron/agent/tutor-coordinator.js";
import { LearnExtractionWorker } from "../../dist/electron/agent/learn-extraction.js";

// Controlled orchestration driver. These tests make no claim about provider teaching quality.
class ControlledRuntime {
  creations = [];
  constructor(run) { this.run = run; }
  async createLearningSession(tools, systemPrompt) {
    this.creations.push({ tools, systemPrompt });
    const controller = new AbortController(), listeners = new Set();
    const runtime = this;
    return { sessionId: "controlled", sessionPath: null, toolNames: tools.map(tool => tool.name),
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      async prompt(text) {
        await runtime.run({ tools, text, signal: controller.signal, emit: event => listeners.forEach(listener => listener(event)) });
      },
      async abort() { controller.abort(); }, dispose() { controller.abort(); },
      async compact() {}, async replace() {},
    };
  }
}
async function setup(run) {
  const directory = await mkdtemp(join(tmpdir(), "studi-tutor-agent-")), database = new StudiSqliteDatabase(join(directory, "studi.sqlite3"));
  try { await run(new LearnRepository(database, "test-student")); }
  finally { database.close(); await rm(directory, { recursive: true, force: true }); }
}
const call = (tools, name, args, signal, id = name) => tools.find(tool => tool.name === name).execute(id, args, signal);
async function until(predicate) {
  for (let index = 0; index < 200; index++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail("Expected state was not reached");
}

test("real tool definitions wait for student actions, persist results, and expose only public state", async () => setup(async repo => {
  const runtime = new ControlledRuntime(async ({ tools, text, signal }) => {
    const snapshot = JSON.parse(text.slice(text.indexOf("\n") + 1, text.lastIndexOf("\nContinue")));
    const topic = snapshot.session.topicId;
    const reply = await call(tools, "tutor_ask_typed", { question: "6*7?", accept: ["42"], hints: ["Multiply"] }, signal);
    await call(tools, "tutor_finish", { topic, level: 4, evidence: [{ blockId: reply.details.blockId, correct: true, rationale: "Solved independently" }], missing: [], next: "Apply it", summary: "You solved it." }, signal);
  });
  const coordinator = new TutorCoordinator(repo, runtime);
  try {
    const started = await coordinator.start({ topic: "Multiplication", minutes: 2 });
    await until(() => coordinator.state(started.sessionId).blocks.some(b => b.status === "open"));
    const open = coordinator.state(started.sessionId).blocks[0];
    assert.equal("accept" in open.args, false);
    assert.equal(repo.session(started.sessionId).status, "active");
    coordinator.answerBlock(started.sessionId, open.blockId, { kind: "typed", answer: "42" });
    await until(() => coordinator.state(started.sessionId).status === "completed");
    assert.equal(coordinator.state(started.sessionId).result.level, 1);
    assert.equal(runtime.creations[0].tools.length, 6);
    assert.match(runtime.creations[0].systemPrompt, /Homework done by Inky never/);
  } finally { await coordinator.dispose(); }
}));

test("a question mid-block interrupts the pending tool, preserves the block and resumes without duplicates", async () => setup(async repo => {
  const args = { question: "6*7?", accept: ["42"], hints: [] };
  const runtime = new ControlledRuntime(async ({ tools, signal }) => {
    if (runtime.creations.length > 1) await call(tools, "tutor_say", { text: "Think of six groups of seven." }, signal);
    await call(tools, "tutor_ask_typed", args, signal);
  });
  const coordinator = new TutorCoordinator(repo, runtime);
  try {
    const started = await coordinator.start({ topic: "Multiplication" });
    await until(() => coordinator.state(started.sessionId).blocks.length === 1);
    const block = coordinator.state(started.sessionId).blocks[0];
    coordinator.saveDraft(started.sessionId, block.blockId, "4");
    await coordinator.send(started.sessionId, "What does multiplication mean?", "question-1");
    await until(() => runtime.creations.length === 2 && coordinator.state(started.sessionId).blocks.length === 2);
    assert.equal(coordinator.state(started.sessionId).blocks[0].blockId, block.blockId);
    assert.equal(coordinator.state(started.sessionId).blocks[0].draft, "4");
    coordinator.answerBlock(started.sessionId, block.blockId, { kind: "typed", answer: "42" });
    await until(() => coordinator.state(started.sessionId).status === "paused");
    assert.equal(repo.mastery().length, 0);
  } finally { await coordinator.dispose(); }
}));

test("provider error never becomes a successful session and cancellation releases the pending waiter", async () => setup(async repo => {
  const failureRuntime = new ControlledRuntime(async () => { throw new Error("provider unavailable"); });
  const coordinator = new TutorCoordinator(repo, failureRuntime);
  const started = await coordinator.start({ topic: "Algebra" });
  await until(() => coordinator.state(started.sessionId).status === "failed");
  assert.equal(coordinator.state(started.sessionId).result, null);
  assert.deepEqual(repo.mastery(), []); await coordinator.dispose();
  const waitingRuntime = new ControlledRuntime(async ({ tools, signal }) => { await call(tools, "tutor_ask_explain", { prompt: "Why?", rubric: ["Because"] }, signal); });
  const next = new TutorCoordinator(repo, waitingRuntime);
  try {
    await next.resume(started.sessionId);
    await until(() => next.state(started.sessionId).blocks.length === 1);
    await next.cancel(started.sessionId);
    assert.equal(next.state(started.sessionId).status, "cancelled");
    assert.equal(next.state(started.sessionId).blocks[0].status, "cancelled");
  } finally { await next.dispose(); }
}));

test("bounded production extraction tools persist only quoted output, skip same hash and retain failures", async () => setup(async repo => {
  const source = repo.importSource({ courseId: "c", title: "Syllabus", kind: "paste", sourceTarget: null, text: "Midterm 2026-10-02. Algebra 100%." });
  const extraction = { exams: [{ key: "midterm", title: "Midterm", date: "2026-10-02", quote: "Midterm 2026-10-02." }], topics: [{ key: "algebra", title: "Algebra", examKey: "midterm", chapter: 1, weight: 100, quote: "Algebra 100%." }] };
  const runtime = new ControlledRuntime(async ({ tools, signal }) => { await call(tools, "learn_record_source", extraction, signal); });
  const worker = new LearnExtractionWorker(repo, runtime);
  assert.deepEqual(await worker.processPendingSources(), [{ sourceId: source.sourceId, status: "ready" }]);
  assert.equal(repo.exams()[0].date, "2026-10-02");
  await worker.processPendingSources(); assert.equal(runtime.creations.length, 1);
  await worker.dispose();
  const bad = repo.importSource({ courseId: "c", title: "Unknown", kind: "paste", sourceTarget: null, text: "No exam is given." });
  const failed = new LearnExtractionWorker(repo, runtime);
  assert.equal((await failed.processPendingSources())[0].status, "failed");
  assert.equal(repo.source(bad.sourceId).status, "failed"); assert.equal(repo.exams().length, 1);
  await failed.dispose();
}));

test("sources imported during extraction join the same batch exactly once without failure retry loops", async () => setup(async repo => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  repo.importSource({ courseId: "c", title: "First", kind: "paste", sourceTarget: null, text: "First syllabus has no exams." });
  const runtime = new ControlledRuntime(async ({ tools, signal }) => {
    if (runtime.creations.length === 1) await gate;
    await call(tools, "learn_record_source", { exams: [], topics: [] }, signal);
  });
  const worker = new LearnExtractionWorker(repo, runtime);
  const first = worker.processPendingSources();
  await until(() => runtime.creations.length === 1);
  repo.importSource({ courseId: "c", title: "Second", kind: "paste", sourceTarget: null, text: "Second syllabus has no exams." });
  const coalesced = worker.processPendingSources();
  release();
  assert.equal((await first).length, 2); assert.equal((await coalesced).length, 2);
  assert.equal(runtime.creations.length, 2);
  await worker.processPendingSources(); assert.equal(runtime.creations.length, 2);
  await worker.dispose();
}));
