import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StudiSqliteDatabase } from "../../dist/electron/storage/database.js";
import { LearnRepository } from "../../dist/electron/storage/learn-records.js";
import { TutorCoordinator } from "../../dist/electron/agent/tutor-coordinator.js";
import { LearnExtractionWorker } from "../../dist/electron/agent/learn-extraction.js";
import { FakeAgentRuntime } from "../../dist/electron/agent/runtime.js";
import { createTutorTools, TUTOR_SYSTEM_PROMPT } from "../../dist/electron/agent/tutor-tools.js";

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
  let now = "2026-09-19T12:00:00.000Z";
  repo.now = () => now;
  const goal = repo.setExam({ kind: "topic", title: "Multiplication", courseId: null, date: null });
  const returning = [repo.addTopic(goal.examId, "Division"), repo.addTopic(goal.examId, "Fractions")];
  for (const topic of returning) {
    const session = repo.startSession(topic.topicId, topic.title, 2);
    const block = repo.openBlock(session.sessionId, "seed", { tool: "tutor_ask_typed", args: { question: "Known?", accept: ["42"], hints: [] } });
    repo.answerBlock(session.sessionId, block.blockId, { kind: "typed", answer: "42" });
    repo.finish(session.sessionId, "seed-finish", { topic: topic.topicId, level: 3, evidence: [{ blockId: block.blockId, rationale: "Earlier unaided success" }], missing: [], next: "Return", summary: "Checked" });
  }
  now = "2026-09-21T12:00:00.000Z";
  const runtime = new ControlledRuntime(async ({ tools, text, signal }) => {
    const snapshot = JSON.parse(text.split("Saved tutor state (data):\n")[1].split("\n\nContinue")[0]);
    const context = JSON.parse(text.split("Lesson context (data):\n")[1].split("\n\nSaved")[0]);
    assert.deepEqual(context.topics.filter(topic => topic.role === "comingBack").map(topic => topic.topicId), returning.map(topic => topic.topicId));
    assert.ok(context.topics.filter(topic => topic.role === "comingBack").every(topic => topic.lastRightOn === "2026-09-19"));
    assert.equal(context.secondsLeft, 120);
    const assessments = [];
    for (const [index, topic] of returning.entries()) {
      const reply = index === 0
        ? await call(tools, "tutor_ask_typed", { topicId: topic.topicId, question: "Remember?", accept: ["42"], hints: [] }, signal, `return-${index}`)
        : await call(tools, "tutor_ask_explain", { topicId: topic.topicId, prompt: "Explain?", rubric: ["States the relationship"] }, signal, `return-${index}`);
      if (index === 1) await call(tools, "tutor_grade", { blockId: reply.details.blockId, correct: true, met: [true] }, signal);
      assessments.push({ topic: topic.topicId, level: 4, evidence: [{ blockId: reply.details.blockId, rationale: "Remembered unaided" }], missing: [], next: "Return later", summary: "Still understood" });
    }
    await call(tools, "tutor_advance", { phase: "independent" }, signal);
    const reply = await call(tools, "tutor_ask_typed", { question: "6*7?", accept: ["42"], hints: ["Multiply"] }, signal);
    assert.equal(reply.details.matched, true);
    assert.equal(reply.details.secondsLeft, 120);
    const primary = { topic: snapshot.topicId, level: 4, evidence: [{ blockId: reply.details.blockId, rationale: "Solved independently" }], missing: [], next: "Apply it", summary: "You solved it." };
    await call(tools, "tutor_finish", { ...primary, assessments: [primary, ...assessments] }, signal);
  });
  const coordinator = new TutorCoordinator(repo, runtime);
  try {
    const started = await coordinator.start({ topic: "Multiplication", minutes: 2 });
    await until(() => coordinator.state(started.sessionId).blocks.some(b => b.status === "open"));
    const open = coordinator.state(started.sessionId).blocks[0];
    assert.equal("accept" in open.args, false);
    assert.equal(repo.session(started.sessionId).status, "active");
    assert.equal(repo.exams().filter(exam => exam.kind === "topic").length, 1);
    assert.equal(started.examId, goal.examId);
    for (let index = 0; index < 3; index++) {
      await until(() => coordinator.state(started.sessionId).blocks.some(block => block.status === "open"));
      const question = coordinator.state(started.sessionId).blocks.find(block => block.status === "open");
      coordinator.answerBlock(started.sessionId, question.blockId, question.tool === "tutor_ask_explain" ? { kind: "explain", text: "The relationship" } : { kind: "typed", answer: "42" });
    }
    await until(() => coordinator.state(started.sessionId).status === "completed");
    assert.equal(coordinator.state(started.sessionId).result.level, 3);
    assert.equal(runtime.creations[0].tools.length, 12);
    assert.equal(repo.session(started.sessionId).blocks[0].phase, "check");
    for (const topic of returning) {
      const record = repo.mastery().find(item => item.topicId === topic.topicId);
      assert.equal(record.level, 4);
      assert.equal(record.review.dueOn, "2026-09-25");
    }
    assert.match(runtime.creations[0].systemPrompt, /Homework Dot did.*never evidence/);
  } finally { await coordinator.dispose(); }
}));

test("a waiting question returns timeUp and tutor_finish completes during wrap", async t => setup(async repo => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = "2026-09-19T12:00:00.000Z", reply;
  repo.now = () => now;
  const runtime = new ControlledRuntime(async ({ tools, text, signal }) => {
    const snapshot = JSON.parse(text.split("Saved tutor state (data):\n")[1].split("\n\nContinue")[0]);
    const first = repo.openBlock(snapshot.sessionId, "first", { tool: "tutor_ask_typed", args: { question: "6*7?", accept: ["42"], hints: [] } });
    repo.answerBlock(snapshot.sessionId, first.blockId, { kind: "typed", answer: "42" });
    reply = await call(tools, "tutor_ask_typed", { question: "Next?", accept: ["42"], hints: [] }, signal);
    await call(tools, "tutor_finish", { topic: snapshot.topicId, level: 3, evidence: [{ blockId: first.blockId, rationale: "Unaided" }], missing: [], next: "Return", summary: "Time well spent" }, signal);
  });
  const coordinator = new TutorCoordinator(repo, runtime);
  try {
    const started = await coordinator.start({ topic: "Multiplication", minutes: 1 });
    await Promise.resolve(); await Promise.resolve();
    assert.ok(repo.session(started.sessionId).blocks.some(block => block.status === "open"));
    now = "2026-09-19T12:01:00.000Z";
    t.mock.timers.tick(60000);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.equal(reply.details.timeUp, true);
    assert.equal(reply.details.secondsLeft, 0);
    assert.equal(coordinator.state(started.sessionId).status, "completed");
    assert.ok(coordinator.state(started.sessionId).result.level > 0);
  } finally { await coordinator.dispose(); }
}));

test("fake learning sessions preserve the bounded tools, resume target and event lifecycle", async () => {
  const turn = [{ schemaVersion: 1, type: "text", delta: "Controlled tutor reply" }, { schemaVersion: 1, type: "terminal", outcome: "completed" }];
  const runtime = new FakeAgentRuntime([turn]);
  const tools = createTutorTools(async () => { throw new Error("Event fake must not pretend to execute tools"); });
  const session = await runtime.createLearningSession(tools, TUTOR_SYSTEM_PROMPT, { resumeSessionPath: "saved-tutor.jsonl" });
  assert.deepEqual(session.toolNames, tools.map(tool => tool.name));
  // The provider rejects a whole tool whose schema has an empty list anywhere in it (an empty tuple's "items: []").
  const emptyLists = (node, path) => Array.isArray(node) ? [...(node.length ? [] : [path]), ...node.flatMap((item, index) => emptyLists(item, `${path}[${index}]`))]
    : node && typeof node === "object" ? Object.entries(node).flatMap(([key, value]) => emptyLists(value, `${path}.${key}`)) : [];
  assert.deepEqual(tools.flatMap(tool => emptyLists(tool.parameters, tool.name)), []);
  assert.equal(session.sessionPath, "saved-tutor.jsonl");
  const events = [];
  session.subscribe(event => events.push(event));
  await session.prompt("Begin");
  assert.deepEqual(events, turn);
  await session.abort();
  assert.equal(events.at(-1).outcome, "aborted");
  session.dispose();
  await assert.rejects(session.prompt("Again"), /disposed/);
  await assert.rejects(runtime.createLearningSession([], TUTOR_SYSTEM_PROMPT), /bounded tools/);
  await assert.rejects(runtime.createLearningSession(tools, " "), /instructions/);
  await assert.rejects(runtime.createLearningSession([tools[0], tools[0]], TUTOR_SYSTEM_PROMPT), /unique/);
});

test("a chat reply mid-question preserves the question and cannot reply twice", async () => setup(async repo => {
  const args = { question: "6*7?", accept: ["42"], hints: [] };
  const runtime = new ControlledRuntime(async ({ tools, signal }) => {
    if (runtime.creations.length > 1) {
      const reply = await call(tools, "tutor_reply", { text: "Think of six groups of seven." }, signal);
      assert.ok(reply.details.blockId);
      await assert.rejects(call(tools, "tutor_reply", { text: "Again." }, signal, "second-reply"), /Nothing to reply to/);
    }
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
    assert.equal(coordinator.state(started.sessionId).blocks[0].status, "open");
    assert.equal(coordinator.state(started.sessionId).blocks[1].replyTo, "question-1");
    assert.equal(coordinator.state(started.sessionId).blocks[1].status, "complete");
    assert.deepEqual(coordinator.state(started.sessionId).messages.map(message => [message.messageId, message.text]), [["question-1", "What does multiplication mean?"]]);
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

test("the study folder feeds the prompt, keeps study pages, and records the finish; a broken folder never stops the lesson", async () => setup(async repo => {
  const events = [];
  const files = {
    read: async () => { events.push("read"); return { progress: "PRIOR-PROGRESS-NOTE", cheatsheet: "- n log n" }; },
    savePage: async (_session, title, html) => { events.push(`page:${title}:${html.length}`); },
    recordFinish: async session => { events.push(`finish:${session.result.level}`); throw new Error("disk full"); },
  };
  const errors = [];
  let prompt = "";
  const runtime = new ControlledRuntime(async ({ tools, text, signal }) => {
    prompt = text;
    const snapshot = JSON.parse(text.split("Saved tutor state (data):\n")[1].split("\n\nContinue")[0]);
    const page = await call(tools, "tutor_show_page", { title: "Shifts", purpose: "Count shifts", html: "<button onclick=\"studi.explore('step')\">Step</button>" }, signal);
    assert.deepEqual(page.details.answer, { kind: "model", explored: ["step"] });
    await call(tools, "tutor_finish", { topic: snapshot.topicId, level: 1, evidence: [], missing: [], next: "Practise", summary: "Explored shifts.", cheatsheet: ["Insertion sort worst case: n(n-1)/2 shifts"] }, signal);
  });
  const coordinator = new TutorCoordinator(repo, runtime, { files, onError: error => errors.push(error.message) });
  const started = await coordinator.start({ topic: "Insertion sort", minutes: 2 });
  await until(() => coordinator.state(started.sessionId).blocks.some(b => b.status === "open"));
  const open = coordinator.state(started.sessionId).blocks.find(b => b.status === "open");
  assert.equal(open.tool, "tutor_show_page");
  coordinator.answerBlock(started.sessionId, open.blockId, { kind: "model", explored: ["step"] });
  await until(() => coordinator.state(started.sessionId).status === "completed" && errors.length === 1);
  assert.match(prompt, /PRIOR-PROGRESS-NOTE/);
  assert.deepEqual(events, ["read", `page:Shifts:${"<button onclick=\"studi.explore('step')\">Step</button>".length}`, "finish:null"]);
  assert.deepEqual(errors, ["disk full"]);
}));
