import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { StudiSqliteDatabase } from "../../dist/electron/storage/database.js";
import { LearnRepository, validateLearnRecords } from "../../dist/electron/storage/learn-records.js";
import { LearnStateSchema } from "../../dist/shared/learn-state.js";
import { computeReadiness, normalizeTopicWeights, planLearn } from "../../dist/shared/learn.js";
import { publicTutorSession, PublicTutorSessionSchema, TutorModelInputSchema } from "../../dist/shared/tutor.js";

const timestamp = "2026-09-19T12:00:00.000Z";
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "studi-learn-"));
  let database = new StudiSqliteDatabase(join(directory, "studi.sqlite3"));
  let now = timestamp;
  const repo = () => new LearnRepository(database, "student-a", () => now);
  try { await run({ repo: repo(), setNow: value => { now = value; }, database,
    reopen: () => { database.close(); database = new StudiSqliteDatabase(join(directory, "studi.sqlite3")); return repo(); } }); }
  finally { database.close(); await rm(directory, { recursive: true, force: true }); }
}
function syllabus(repo) {
  const source = repo.importSource({ courseId: "course", title: "Syllabus", kind: "scan", sourceTarget: "https://school.test/course/syllabus", text: "Exam September 25, 2026. Sampling 70%. Probability 30%." });
  repo.applyExtraction(source.sourceId, source.contentHash, {
    exams: [{ key: "exam", title: "Exam", date: "2026-09-25", quote: "Exam September 25, 2026." }],
    topics: [{ key: "sampling", examKey: "exam", title: "Sampling", chapter: 1, weight: 70, quote: "Sampling 70%." },
      { key: "probability", examKey: "exam", title: "Probability", chapter: 2, weight: 30, quote: "Probability 30%." }],
  });
  return { source: repo.source(source.sourceId), exam: repo.exams()[0], topics: repo.topics().sort((a, b) => a.chapter - b.chapter) };
}
function typed(repo, session, { answer = "42", hints = [] } = {}) {
  const block = repo.openBlock(session.sessionId, `typed-${session.blocks.length}`, { tool: "tutor_ask_typed", args: { question: "What is six times seven?", accept: ["42"], hints } });
  repo.answerBlock(session.sessionId, block.blockId, { kind: "typed", answer });
  return block;
}
function finish(repo, session, block, level = 4, correct = true) {
  return repo.finish(session.sessionId, "finish", { topic: session.topicId, level, evidence: block ? [{ blockId: block.blockId, correct, rationale: "Answered the independent question" }] : [], missing: [], next: "Try another question", summary: "We checked your understanding." });
}

test("source discovery is durable, content addressed, and exam moves preserve identity and student overrides", async () => fixture(({ repo, reopen }) => {
  const { source, exam, topics } = syllabus(repo);
  const unchanged = repo.importSource({ courseId: "course", title: "Syllabus", kind: "scan", sourceTarget: source.sourceTarget, text: source.text });
  assert.equal(unchanged.status, "ready"); assert.equal(unchanged.sourceId, source.sourceId);
  const moved = repo.importSource({ courseId: "course", title: "Syllabus", kind: "scan", sourceTarget: source.sourceTarget, text: "Exam September 28, 2026. Sampling 70%. Probability 30%." });
  assert.equal(moved.sourceId, source.sourceId); assert.equal(moved.status, "pending");
  const extraction = { exams: [{ key: "exam", title: "Exam", date: "2026-09-28", quote: "Exam September 28, 2026." }], topics: [
    { key: "sampling", examKey: "exam", title: "Sampling", chapter: 1, weight: 70, quote: "Sampling 70%." },
    { key: "probability", examKey: "exam", title: "Probability", chapter: 2, weight: 30, quote: "Probability 30%." },
  ] };
  assert.throws(() => repo.applyExtraction(source.sourceId, source.contentHash, extraction), /changed/);
  repo.applyExtraction(source.sourceId, moved.contentHash, extraction);
  assert.equal(repo.exams()[0].examId, exam.examId); assert.equal(repo.exams()[0].date, "2026-09-28");
  assert.deepEqual(repo.topics().map(t => t.topicId).sort(), topics.map(t => t.topicId).sort());
  repo.setExam({ examId: exam.examId, courseId: "course", title: "Exam", date: "2026-09-30" });
  repo.applyExtraction(source.sourceId, moved.contentHash, { exams: extraction.exams.map(item => ({ ...item, key: "changed-provider-key" })), topics: extraction.topics.map(item => ({ ...item, key: `changed-${item.key}`, examKey: "changed-provider-key" })) });
  const restored = reopen();
  assert.equal(restored.exams().length, 1);
  assert.equal(restored.exams()[0].date, "2026-09-30");
  assert.deepEqual(restored.topics().map(t => t.topicId).sort(), topics.map(t => t.topicId).sort());
}));

test("overview omits transcripts and evidence while the full saved session remains accessible", async () => fixture(({ repo }) => {
  const topic = repo.createFreeTopic("Algebra"), session = repo.startSession(topic.topicId, "Practice", 15);
  for (let index = 0; index < 30; index++) repo.openBlock(session.sessionId, `say-${index}`, { tool: "tutor_say", args: { text: `PRIVATE-TRANSCRIPT-${index}` } });
  repo.appendMessage(session.sessionId, "message", "PRIVATE-STUDENT-MESSAGE");
  finish(repo, session, typed(repo, repo.session(session.sessionId)));
  const full = repo.session(session.sessionId);
  assert.equal(full.blocks.length, 32);
  assert.equal(full.messages.length, 1);
  // An overview must not call either full-session reader, even with substantial history.
  repo.sessions = () => { throw new Error("Overview loaded full sessions"); };
  repo.session = () => { throw new Error("Overview loaded blocks"); };
  repo.mastery = () => { throw new Error("Overview loaded answer evidence"); };
  const overview = LearnStateSchema.parse(repo.learnState("2026-09-19"));
  assert.equal(overview.sessions[0].sessionId, session.sessionId);
  assert.equal("blocks" in overview.sessions[0], false);
  assert.equal("messages" in overview.sessions[0], false);
  assert.equal("evidence" in overview.sessions[0].result, false);
  assert.equal("evidence" in overview.mastery[0], false);
  assert.equal(overview.mastery[0].evidenceCount, 1);
  assert.equal(JSON.stringify(overview).includes("PRIVATE-"), false);
}));

test("explicit past and undated exams never inherit another exam's topics or readiness", async () => fixture(({ repo }) => {
  const { exam, topics } = syllabus(repo);
  const past = { ...exam, examId: "past-exam", date: "2026-09-01" };
  const undated = { ...exam, examId: "undated-exam", date: null };
  const ownTopics = [past, undated].map(item => ({ ...topics[0], topicId: `${item.examId}-topic`, examId: item.examId }));
  const input = { exams: [exam, past, undated], topics: [...topics, ...ownTopics], mastery: [], sessions: [], today: "2026-09-19" };
  for (const selected of [past, undated]) {
    const plan = planLearn({ ...input, selectedExamId: selected.examId });
    assert.equal(plan.leadExam.examId, selected.examId);
    assert.equal(plan.todayTopic.examId, selected.examId);
    assert.equal(plan.readiness.status, "unknown");
    assert.deepEqual(plan.path, []);
  }
  assert.equal(planLearn(input).leadExam.examId, exam.examId);
  assert.equal(planLearn({ ...input, selectedExamId: "missing" }).leadExam, null);
}));

test("readiness normalizes shares, reports unknown coverage honestly, and ignores homework hints", async () => fixture(({ repo }) => {
  const { topics } = syllabus(repo);
  assert.deepEqual(normalizeTopicWeights(topics), { [topics[0].topicId]: 0.7, [topics[1].topicId]: 0.3 });
  assert.deepEqual(computeReadiness(topics, []), { status: "unknown", percent: null, knownWeight: 0 });
  const session = repo.startSession(topics[0].topicId, "Sampling", 15), block = typed(repo, session);
  finish(repo, session, block);
  assert.deepEqual(computeReadiness(topics, repo.mastery()), { status: "partial", percent: null, knownWeight: 0.7 });
  const next = repo.startSession(topics[1].topicId, "Probability", 15);
  finish(repo, next, typed(repo, next));
  assert.equal(computeReadiness(topics, repo.mastery()).percent, 25);
  assert.equal(computeReadiness(topics.map(topic => ({ ...topic, weight: null })), repo.mastery()).status, "unknown");
  assert.equal(computeReadiness(topics.map(topic => ({ ...topic, origin: "homework_hint" })), repo.mastery()).percent, null);
  LearnStateSchema.parse(repo.learnState("2026-09-19"));
}));

test("planner orders gaps, schedules mock two days before, and recap is due after three days", async () => fixture(({ repo }) => {
  const { exam, topics } = syllabus(repo);
  const session = { sessionId: "s", topicId: topics[0].topicId, startedAt: timestamp, finishedAt: timestamp, status: "completed" };
  const input = { exams: [exam], topics, mastery: [], sessions: [session] };
  assert.equal(planLearn({ ...input, today: "2026-09-21" }).recapDue, false);
  const plan = planLearn({ ...input, today: "2026-09-22" });
  assert.equal(plan.recapDue, true); assert.equal(plan.path[0].kind, "recap");
  assert.equal(plan.path.find(day => day.date === "2026-09-23").kind, "mock_exam");
  assert.equal(plan.todayTopic.topicId, topics[0].topicId);
  assert.equal(planLearn({ ...input, today: "2026-09-26" }).leadExam, null);
  assert.equal(planLearn({ ...input, topics: [], today: "2026-09-19" }).path.length, 0);
}));

test("one open block, immutable answers and drafts survive restart; hints and answer keys stay private", async () => fixture(({ repo, reopen }) => {
  const topic = repo.createFreeTopic("Algebra"), session = repo.startSession(topic.topicId, "Algebra", 10);
  const block = repo.openBlock(session.sessionId, "typed", { tool: "tutor_ask_typed", args: { question: "x?", accept: ["SECRET-KEY"], hints: ["HINT-ONE", "HINT-TWO"] } });
  assert.throws(() => repo.openBlock(session.sessionId, "choice", { tool: "tutor_ask_choice", args: { question: "?", options: ["A", "B"], correct: 0 } }), /open block/);
  repo.openBlock(session.sessionId, "say", { tool: "tutor_say", args: { text: "Take your time." } });
  repo.saveDraft(session.sessionId, block.blockId, "partial answer");
  let publicState = publicTutorSession(repo.session(session.sessionId));
  assert.equal(JSON.stringify(publicState).includes("SECRET-KEY"), false);
  assert.equal(JSON.stringify(publicState).includes("HINT-ONE"), false);
  repo.hint(session.sessionId, block.blockId);
  publicState = publicTutorSession(repo.session(session.sessionId));
  assert.equal(JSON.stringify(publicState).includes("HINT-ONE"), true);
  assert.equal(JSON.stringify(publicState).includes("HINT-TWO"), false);
  const reopened = reopen(); reopened.recover();
  const restored = reopened.session(session.sessionId);
  assert.equal(restored.status, "paused"); assert.equal(restored.blocks[0].draft, "partial answer");
  reopened.transition(session.sessionId, "active");
  reopened.answerBlock(session.sessionId, block.blockId, { kind: "typed", answer: " secret-key " });
  reopened.answerBlock(session.sessionId, block.blockId, { kind: "typed", answer: " secret-key " });
  assert.throws(() => reopened.answerBlock(session.sessionId, block.blockId, { kind: "typed", answer: "different" }), /already has/);
  assert.equal(reopened.session(session.sessionId).blocks[0].result.correct, true);
  PublicTutorSessionSchema.parse(publicTutorSession(reopened.session(session.sessionId)));
}));

test("only eligible evidence changes mastery, capped once, with atomic finish and cross-session/account rejection", async () => fixture(({ repo, database }) => {
  const topic = repo.createFreeTopic("Algebra"), session = repo.startSession(topic.topicId, "Algebra", 10);
  const choice = repo.openBlock(session.sessionId, "choice", { tool: "tutor_ask_choice", args: { question: "?", options: ["A", "B"], correct: 0 } });
  repo.answerBlock(session.sessionId, choice.blockId, { kind: "choice", picked: 0 });
  assert.throws(() => finish(repo, session, choice), /typed or explanation/);
  assert.deepEqual(repo.mastery(), []);
  const block = typed(repo, repo.session(session.sessionId));
  assert.throws(() => finish(repo, session, block, 4, false), /cannot be overridden/);
  const completed = finish(repo, session, block);
  assert.equal(completed.result.level, 1);
  finish(repo, session, block); assert.equal(repo.mastery()[0].level, 1); assert.equal(repo.mastery()[0].evidence.length, 1);
  const next = repo.startSession(topic.topicId, "Again", 10);
  assert.throws(() => finish(repo, next, block), /from this session/);
  assert.equal(repo.session(next.sessionId).status, "active");
  const other = new LearnRepository(database, "student-b");
  assert.deepEqual(other.sessions(), []); assert.deepEqual(other.mastery(), []);
  assert.throws(() => other.session(session.sessionId), /not found/);
  validateLearnRecords(database);
}));

test("hinted correct answers and choice-only sessions cannot claim independent mastery", async () => fixture(({ repo }) => {
  const topic = repo.createFreeTopic("Algebra"), session = repo.startSession(topic.topicId, "Algebra", 10);
  const block = repo.openBlock(session.sessionId, "typed", { tool: "tutor_ask_typed", args: { question: "6*7?", accept: ["42"], hints: ["42"] } });
  repo.hint(session.sessionId, block.blockId);
  repo.answerBlock(session.sessionId, block.blockId, { kind: "typed", answer: "42" });
  assert.equal(finish(repo, session, block).result.level, 0);
  const free = repo.createFreeTopic("Untested"), next = repo.startSession(free.topicId, "Check", 10);
  assert.equal(finish(repo, next, null).result.level, null);
  assert.equal(repo.mastery().some(record => record.topicId === free.topicId), false);
}));

test("expiry and cancellation preserve answers without awarding mastery", async () => fixture(({ repo, setNow }) => {
  const topic = repo.createFreeTopic("Algebra"), session = repo.startSession(topic.topicId, "Algebra", 1);
  const block = typed(repo, session);
  setNow("2026-09-19T12:01:01.000Z");
  assert.equal(repo.state(session.sessionId).status, "expired");
  assert.throws(() => finish(repo, session, block), /expired/);
  assert.deepEqual(repo.mastery(), []);
  const next = repo.startSession(topic.topicId, "Again", 1);
  const open = repo.openBlock(next.sessionId, "explain", { tool: "tutor_ask_explain", args: { prompt: "Why?", rubric: ["PRIVATE-RUBRIC"] } });
  assert.equal(JSON.stringify(publicTutorSession(repo.session(next.sessionId))).includes("PRIVATE-RUBRIC"), false);
  repo.transition(next.sessionId, "cancelled");
  assert.equal(repo.session(next.sessionId).blocks.find(b => b.blockId === open.blockId).status, "cancelled");
}));

test("mock exam requires independent evidence across its topic set and commits all changes together", async () => fixture(({ repo }) => {
  const { exam, topics } = syllabus(repo);
  const session = repo.startSession(topics[0].topicId, "Mock exam", 15, { mode: "mock_exam", examId: exam.examId, topicIds: topics.map(t => t.topicId) });
  assert.throws(() => repo.openBlock(session.sessionId, "bad", { tool: "tutor_ask_typed", args: { question: "?", accept: ["yes"], hints: [] } }), /must name/);
  const assessments = topics.map((topic, index) => {
    const block = repo.openBlock(session.sessionId, `typed-${index}`, { tool: "tutor_ask_typed", args: { topicId: topic.topicId, question: "Known answer?", accept: ["yes"], hints: [] } });
    repo.answerBlock(session.sessionId, block.blockId, { kind: "typed", answer: "yes" });
    return { topic: topic.topicId, level: 4, evidence: [{ blockId: block.blockId, correct: true, rationale: "Answered independently" }], summary: "Checked", missing: [], next: "Practice" };
  });
  assert.throws(() => repo.finish(session.sessionId, "finish", assessments[0]), /every exam topic/);
  assert.deepEqual(repo.mastery(), []);
  repo.finish(session.sessionId, "finish", { ...assessments[0], assessments });
  assert.equal(repo.mastery().length, 2); assert.ok(repo.mastery().every(m => m.level === 1));
}));

test("all five fixed model types are bounded and unknown/host execution models are rejected", () => {
  const models = [
    { model: "population_grid", params: { population: 100, sampleSize: 10, proportion: 0.5 }, controls: ["sample"] },
    { model: "number_line", params: { min: -10, max: 10, step: 1, points: [0] }, controls: ["move"] },
    { model: "function_plot", params: { family: "quadratic", a: 1, b: 0, c: 0, xMin: -10, xMax: 10 }, controls: ["a"] },
    { model: "flashcards", params: { cards: [{ front: "A", back: "B" }] }, controls: ["flip"] },
    { model: "code_runner", params: { language: "javascript", code: "console.log(42)", instructions: "Try it", timeoutMs: 500 }, controls: ["run"] },
  ];
  for (const model of models) TutorModelInputSchema.parse(model);
  assert.equal(TutorModelInputSchema.safeParse({ ...models[4], params: { ...models[4].params, language: "powershell" } }).success, false);
  assert.equal(TutorModelInputSchema.safeParse({ ...models[4], params: { ...models[4].params, timeoutMs: 999999 } }).success, false);
  assert.equal(TutorModelInputSchema.safeParse({ model: "custom_html", params: {}, controls: [] }).success, false);
});
