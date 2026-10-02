import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { StudiSqliteDatabase } from "../../dist/electron/storage/database.js";
import { LearnRepository, validateLearnRecords } from "../../dist/electron/storage/learn-records.js";
import { LearnStateSchema } from "../../dist/shared/learn-state.js";
import { computeReadiness, normalizeTopicWeights, planLearn, nextReview, sameExam } from "../../dist/shared/learn.js";
import { normalizeTutorAnswer, typedAnswerMatches, publicTutorSession, PublicTutorSessionSchema, TutorModelInputSchema, boardView } from "../../dist/shared/tutor.js";
import { pickExcerpts } from "../../dist/electron/agent/tutor-context.js";
import { importLearnFile } from "../../dist/electron/agent/learn-import.js";

const timestamp = "2026-09-19T12:00:00.000Z";
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "studi-learn-"));
  let database = new StudiSqliteDatabase(join(directory, "studi.sqlite3"));
  let now = timestamp;
  const repo = () => new LearnRepository(database, "student-a", () => now);
  try { await run({ repo: repo(), directory, setNow: value => { now = value; }, database,
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
function finish(repo, session, block, level = 4) {
  return repo.finish(session.sessionId, "finish", { topic: session.topicId, level, evidence: block ? [{ blockId: block.blockId, rationale: "Answered the independent question" }] : [], missing: [], next: "Try another question", summary: "We checked your understanding." });
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
  for (let index = 0; index < 10; index++) {
    repo.openBlock(session.sessionId, `say-${index}`, { tool: "tutor_say", args: { text: `PRIVATE-TRANSCRIPT-${index}` } });
    typed(repo, repo.session(session.sessionId));
  }
  repo.appendMessage(session.sessionId, "message", "PRIVATE-STUDENT-MESSAGE");
  finish(repo, session, typed(repo, repo.session(session.sessionId)));
  const full = repo.session(session.sessionId);
  assert.equal(full.blocks.length, 22);
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
    assert.deepEqual(plan.comingBack, []);
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
  assert.equal(computeReadiness(topics, repo.mastery()).percent, 75);
  assert.equal(computeReadiness(topics.map(topic => ({ ...topic, weight: null })), repo.mastery()).status, "unknown");
  assert.equal(computeReadiness(topics.map(topic => ({ ...topic, origin: "homework_hint" })), repo.mastery()).percent, null);
  LearnStateSchema.parse(repo.learnState("2026-09-19"));
}));

test("planner chooses non-resting gaps and returns overdue Good topics first", async () => fixture(({ repo }) => {
  const { exam, topics } = syllabus(repo);
  const input = { exams: [exam], topics, mastery: [], sessions: [], today: "2026-09-22" };
  assert.equal(planLearn(input).todayTopic.topicId, topics[0].topicId);
  const record = (topic, level, dueOn) => ({ topicId: topic.topicId, level, evidenceCount: 1, updatedAt: timestamp, review: { dueOn, gapDays: 2, lastRightOn: "2026-09-19" } });
  const resting = planLearn({ ...input, mastery: [record(topics[0], 2, "2026-09-23")] });
  assert.equal(resting.todayTopic.topicId, topics[1].topicId);
  assert.equal(resting.topicsLeft, 2);
  const plan = planLearn({ ...input, mastery: [record(topics[0], 3, "2026-09-21"), record(topics[1], 4, "2026-09-20")] });
  assert.equal(plan.todayTopic, null);
  assert.equal(plan.topicsLeft, 0);
  assert.deepEqual(plan.comingBack.map(t => t.topicId), [topics[1].topicId, topics[0].topicId]);
  assert.equal(planLearn({ ...input, today: "2026-09-26" }).leadExam, null);
  assert.equal(planLearn({ ...input, topics: [] }).todayTopic, null);
}));

test("nextReview schedules first success, due success, early success, misses and exam caps", () => {
  const input = { today: "2026-09-20", examDate: null, right: true };
  assert.deepEqual(nextReview(null, input), { dueOn: "2026-09-22", gapDays: 2, lastRightOn: input.today });
  assert.equal(nextReview(null, { ...input, examDate: "2026-10-10" }).gapDays, 5);
  assert.equal(nextReview(null, { ...input, examDate: "2026-12-10" }).gapDays, 14);
  const previous = { dueOn: "2026-09-20", gapDays: 20, lastRightOn: "2026-09-01" };
  assert.equal(nextReview(previous, input).gapDays, 30);
  const early = { ...previous, dueOn: "2026-09-21" };
  assert.deepEqual(nextReview(early, input), early);
  const miss = nextReview(previous, { ...input, right: false });
  assert.deepEqual(miss, { dueOn: "2026-09-21", gapDays: 1, lastRightOn: null });
  assert.equal(nextReview(miss, { ...input, today: "2026-09-21" }).gapDays, 2);
  assert.equal(nextReview(previous, { ...input, examDate: "2026-09-25" }).dueOn, "2026-09-24");
});

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
  repo.saveDraft(session.sessionId, block.blockId, "   ");
  assert.throws(() => repo.hint(session.sessionId, block.blockId), /Type your best try first/);
  repo.saveDraft(session.sessionId, block.blockId, "partial answer");
  repo.hint(session.sessionId, block.blockId);
  assert.equal(repo.session(session.sessionId).blocks[0].hintsUsed, 2);
  const reopened = reopen(); reopened.recover();
  const restored = reopened.session(session.sessionId);
  assert.equal(restored.status, "paused"); assert.equal(restored.blocks[0].draft, "partial answer");
  reopened.transition(session.sessionId, "active");
  reopened.answerBlock(session.sessionId, block.blockId, { kind: "typed", answer: " secret-key " });
  reopened.answerBlock(session.sessionId, block.blockId, { kind: "typed", answer: " secret-key " });
  assert.throws(() => reopened.answerBlock(session.sessionId, block.blockId, { kind: "typed", answer: "different" }), /already has/);
  assert.equal(reopened.session(session.sessionId).blocks[0].result.correct, true);
  PublicTutorSessionSchema.parse(publicTutorSession(reopened.session(session.sessionId)));
  const args = { question: "Try x?", note: "Use the same line.", accept: ["4"], hints: [] };
  const ask = key => reopened.openBlock(session.sessionId, key, { tool: "tutor_ask_typed", args });
  const retry = ask("try-1");
  reopened.answerBlock(session.sessionId, retry.blockId, { kind: "typed", answer: "3" });
  assert.equal(ask("try-2").blockId, retry.blockId);
  assert.equal(reopened.session(session.sessionId).blocks.at(-1).status, "open");
  assert.equal(reopened.session(session.sessionId).blocks.at(-1).attempts[0].correct, false);
  reopened.answerBlock(session.sessionId, retry.blockId, { kind: "typed", answer: "4" });
  assert.equal(reopened.session(session.sessionId).blocks.at(-1).result.correct, true);
  assert.throws(() => finish(reopened, session, retry), /first try/);
  const cappedArgs = { ...args, question: "Another x?" };
  for (let attempt = 0; attempt < 3; attempt++) {
    const capped = reopened.openBlock(session.sessionId, `capped-${attempt}`, { tool: "tutor_ask_typed", args: cappedArgs });
    reopened.answerBlock(session.sessionId, capped.blockId, { kind: "typed", answer: "3" });
    for (let note = 0; note < 2; note++) reopened.openBlock(session.sessionId, `retry-note-${attempt}-${note}`, { tool: "tutor_say", args: { text: "Think about the givens." } });
  }
  assert.throws(() => reopened.openBlock(session.sessionId, "capped-4", { tool: "tutor_ask_typed", args: cappedArgs }), /three tries/);
  assert.equal(reopened.session(session.sessionId).blocks.find(item => item.args.question === cappedArgs.question).attempts.length, 3);
}));

test("non-waiting visuals persist across answers, respect capacity, and clear on independent and finish", async () => fixture(({ repo, reopen }) => {
  const topic = repo.createFreeTopic("Graphs"), session = repo.startSession(topic.topicId, "Graphs", 10);
  const args = { model: "number_line", params: { min: 0, max: 10, step: 1, points: [3] }, controls: ["move"], wait: false };
  const show = (key, extra = {}) => repo.openBlock(session.sessionId, key, { tool: "tutor_show_model", args: { ...args, ...extra } });
  const first = show("first"), second = show("second");
  assert.equal(first.status, "complete");
  assert.equal(show("first").blockId, first.blockId);
  assert.throws(() => show("third"), /board is full/);
  show("child-one", { under: first.blockId }); show("child-two", { under: first.blockId });
  assert.throws(() => show("child-three", { under: first.blockId }), /board is full/);
  assert.throws(() => show("bad-parent", { under: "missing" }), /visual that is up/);
  const question = repo.openBlock(session.sessionId, "question", { tool: "tutor_ask_typed", args: { question: "Where?", accept: ["3"], hints: [] } });
  assert.throws(() => show("question-parent", { under: question.blockId }), /visual that is up/);
  repo.answerBlock(session.sessionId, question.blockId, { kind: "typed", answer: "3", explored: ["Moved point to 3"] });
  const saved = reopen();
  assert.equal(saved.session(session.sessionId).blocks[0].erasedAt, null);
  assert.deepEqual(saved.session(session.sessionId).blocks[0].explored, ["Moved point to 3"]);
  assert.deepEqual(saved.session(session.sessionId).blocks.at(-1).result.explored, ["Moved point to 3"]);
  saved.advance(session.sessionId, "independent");
  assert.ok(saved.session(session.sessionId).blocks.filter(block => block.tool === "tutor_show_model").every(block => block.erasedAt));
  const page = saved.openBlock(session.sessionId, "page", { tool: "tutor_show_page", args: { title: "A line", purpose: "See it", html: "<p>Line</p>", wait: false } });
  finish(saved, session, question);
  assert.ok(saved.session(session.sessionId).blocks.find(block => block.blockId === page.blockId).erasedAt);
  assert.ok(second.blockId);
}));

test("visual updates preserve type and capacity; erasing a parent erases its children", async () => fixture(({ repo, setNow }) => {
  const topic = repo.createFreeTopic("Graphs"), session = repo.startSession(topic.topicId, "Graphs", 10);
  const args = { model: "number_line", params: { min: 0, max: 10, step: 1, points: [3] }, controls: ["move"], wait: false };
  const parent = repo.openBlock(session.sessionId, "parent", { tool: "tutor_show_model", args });
  const child = repo.openBlock(session.sessionId, "child", { tool: "tutor_show_page", args: { title: "Values", purpose: "Compare", html: "<p>3</p>", under: parent.blockId, wait: false } });
  assert.throws(() => repo.update(session.sessionId, { id: parent.blockId, args: { model: "flashcards", params: { cards: [{ front: "3", back: "Three" }] }, controls: [] } }), /same tool and model/);
  assert.throws(() => repo.update(session.sessionId, { id: parent.blockId, args: { ...args, params: { ...args.params, points: [11] } } }), /bounds/);
  assert.throws(() => repo.update(session.sessionId, { id: parent.blockId, args: { ...args, under: child.blockId } }), /top-level/);
  setNow("2026-09-19T12:00:01.000Z");
  const updated = repo.update(session.sessionId, { id: parent.blockId, args: { ...args, params: { ...args.params, points: [4] } } });
  assert.equal(updated.blockId, parent.blockId); assert.equal(updated.updatedAt, repo.now());
  repo.erase(session.sessionId, { id: parent.blockId });
  assert.ok(repo.session(session.sessionId).blocks.every(block => block.erasedAt));
  assert.throws(() => repo.update(session.sessionId, { id: parent.blockId, args }), /visual that is up/);
}));

test("boardView describes current work, history, retries, chat and erasure without mutating public state", async t => {
  const cases = [
    ["fresh question", ({ ask, view, repo, session }) => {
      const question = ask("first");
      let board = view();
      assert.equal(board.question.blockId, question.blockId); assert.equal(board.note, "Use the visual.");
      assert.deepEqual(board.done, []); assert.deepEqual(board.tries, []); assert.equal(board.move, "check");
      assert.equal(board.newest, question.blockId);
      repo.saveDraft(session.sessionId, question.blockId, "3"); assert.equal(view().newest, null);
      repo.hint(session.sessionId, question.blockId); assert.equal(view().newest, null);
    }],
    ["visual kept across two questions", ({ ask, show, answer, view }) => {
      const visual = show("plot"), child = show("table", { under: visual.blockId });
      const first = ask("first"); answer(first, "4"); ask("second");
      const board = view(); assert.equal(board.visuals[0].block.blockId, visual.blockId);
      assert.equal(board.visuals[0].children[0].blockId, child.blockId); assert.equal(board.done.length, 1);
    }],
    ["wrong then right", ({ ask, answer, view, repo, session, setNow }) => {
      const question = ask("first"); answer(question, "3");
      setNow("2026-09-19T12:00:01.000Z");
      const note = repo.openBlock(session.sessionId, "feedback", { tool: "tutor_say", args: { text: "Look at the smaller gap." } });
      ask("first", "retry");
      assert.equal(view().tries[0].correct, false); assert.equal(view().move, "check"); assert.equal(view().feedback[0].blockId, note.blockId);
      setNow("2026-09-19T12:00:02.000Z");
      answer(question, "4");
      // The note was about the first try, so it goes when the next try is made.
      const board = view(); assert.equal(board.tries.length, 1); assert.equal(board.question.result.correct, true);
      assert.deepEqual(board.feedback, []); assert.equal(board.move, "wait"); assert.equal(board.newest, null);
      // One written after the last answer leads into the next question.
      setNow("2026-09-19T12:00:03.000Z");
      const bridge = repo.openBlock(session.sessionId, "bridge", { tool: "tutor_say", args: { text: "Now the same at 5." } });
      ask("second");
      assert.deepEqual(view().lead.map(block => block.blockId), [bridge.blockId]);
    }],
    ["chat mid-question", ({ ask, view, repo, session, setNow }) => {
      const question = ask("first");
      repo.appendMessage(session.sessionId, "message", "What is the gap?");
      setNow("2026-09-19T12:00:01.000Z");
      repo.openBlock(session.sessionId, "reply", { tool: "tutor_reply", args: { text: "The distance between the two x values." } });
      const board = view(); assert.equal(board.question.blockId, question.blockId); assert.equal(board.move, "check");
      assert.deepEqual(board.chat.map(item => item.kind), ["student", "tutor"]); assert.equal(board.chat[1].replyTo, "message");
      assert.equal(board.newest, null); assert.deepEqual(board.feedback, []);
      repo.appendMessage(session.sessionId, "message-two", "What now?");
      repo.openBlock(session.sessionId, "reply-two", { tool: "tutor_reply", args: { text: "Try making it smaller." } });
      assert.deepEqual(view().chat.map(item => item.id), ["message", board.chat[1].id, "message-two", view().chat[3].id]);
    }],
    ["erased visual", ({ show, view, repo, session, setNow }) => {
      const visual = show("plot"); show("table", { under: visual.blockId });
      setNow("2026-09-19T12:00:01.000Z");
      repo.update(session.sessionId, { id: visual.blockId, args: { ...visual.args, params: { ...visual.args.params, points: [4] } } });
      assert.equal(view().newest, visual.blockId);
      repo.erase(session.sessionId, { id: visual.blockId }); assert.deepEqual(view().visuals, []); assert.equal(view().newest, null);
    }],
    ["a visual that waits is a stop", ({ ask, answer, view, repo, session }) => {
      const first = ask("first"); answer(first, "4");
      const visual = repo.openBlock(session.sessionId, "try", { tool: "tutor_show_model", args: { model: "number_line", params: { min: 0, max: 10, step: 1, points: [3] }, controls: ["move"] } });
      assert.equal(view(first.blockId).move, "next");
      let board = view(); assert.equal(board.at, visual.blockId); assert.equal(board.question, null); assert.equal(board.move, "tried"); assert.equal(board.done.length, 1);
      repo.answerBlock(session.sessionId, visual.blockId, { kind: "model", explored: ["Moved point 1 to 4"] });
      board = view(); assert.equal(board.move, "wait"); assert.equal(board.visuals[0].block.blockId, visual.blockId);
    }],
    ["the previous question and its notes fold", ({ ask, answer, view, repo, session, setNow }) => {
      repo.openBlock(session.sessionId, "intro", { tool: "tutor_say", args: { text: "A slope is rise over run." } });
      const first = ask("first"); answer(first, "4");
      setNow("2026-09-19T12:00:01.000Z");
      const note = repo.openBlock(session.sessionId, "feedback", { tool: "tutor_say", args: { text: "That's the slope." } });
      const second = ask("second");
      // Chalky is ahead: the student stays on the first question, with its notes, until they move on.
      const stay = view(first.blockId); assert.equal(stay.question.blockId, first.blockId); assert.equal(stay.move, "next"); assert.equal(stay.following, second.blockId);
      assert.deepEqual(stay.lead.map(block => block.args.text), ["A slope is rise over run."]); assert.deepEqual(stay.feedback.map(block => block.blockId), [note.blockId]); assert.deepEqual(stay.done, []);
      const board = view(); assert.deepEqual(board.done, [{ blockId: first.blockId, question: "first?", answer: "4", correct: true }]);
      assert.equal(board.question.blockId, second.blockId); assert.equal(board.at, second.blockId); assert.equal(board.following, null);
      assert.deepEqual(board.lead.map(block => block.blockId), [note.blockId]); assert.deepEqual(board.feedback, []); assert.deepEqual(board.tries, []);
    }],
  ];
  for (const [name, run] of cases) await t.test(name, () => fixture(context => {
    const { repo } = context, topic = repo.createFreeTopic("Graphs"), session = repo.startSession(topic.topicId, "Graphs", 10);
    run({ ...context, session,
      ask: (name, key = name) => repo.openBlock(session.sessionId, key, { tool: "tutor_ask_typed", args: { question: name + "?", note: "Use the visual.", accept: ["4"], hints: ["Think about the gap"] } }),
      show: (key, extra = {}) => repo.openBlock(session.sessionId, key, { tool: "tutor_show_model", args: { model: "number_line", params: { min: 0, max: 10, step: 1, points: [3] }, controls: [], wait: false, ...extra } }),
      answer: (question, answer) => repo.answerBlock(session.sessionId, question.blockId, { kind: "typed", answer }),
      view: at => { const state = publicTutorSession(repo.session(session.sessionId)), before = JSON.stringify(state), board = boardView(state, at); assert.equal(JSON.stringify(state), before); assert.deepEqual(boardView(state, at), board); return board; },
    });
  }));
});

test("I'm not sure is a wrong answer that can be retried, but never raised or cited", async () => fixture(({ repo }) => {
  const topic = repo.createFreeTopic("Algebra"), session = repo.startSession(topic.topicId, "Algebra", 10);
  const args = { question: "What is six times seven?", accept: ["42"], hints: [] };
  const block = repo.openBlock(session.sessionId, "typed", { tool: "tutor_ask_typed", args });
  repo.answerBlock(session.sessionId, block.blockId, { kind: "unsure" });
  assert.equal(repo.session(session.sessionId).blocks[0].result.correct, false);
  assert.throws(() => repo.grade(session.sessionId, { blockId: block.blockId, correct: true, equivalentTo: "42" }), /wrong typed answer/);
  assert.throws(() => finish(repo, session, block, 3), /Invalid mastery evidence/);
  repo.openBlock(session.sessionId, "typed-again", { tool: "tutor_ask_typed", args });
  repo.answerBlock(session.sessionId, block.blockId, { kind: "typed", answer: "42" });
  assert.deepEqual(repo.session(session.sessionId).blocks[0].attempts.map(attempt => attempt.correct), [false, true]);
}));

test("answer keys reach the screen only after the lesson is over", async () => fixture(({ repo }) => {
  const topic = repo.createFreeTopic("Algebra"), session = repo.startSession(topic.topicId, "Algebra", 10);
  repo.openBlock(session.sessionId, "choice", { tool: "tutor_ask_choice", args: { question: "?", options: ["A", "B"], correct: 1 } });
  assert.equal(publicTutorSession(repo.session(session.sessionId)).blocks[0].args.key, undefined);
  repo.transition(session.sessionId, "cancelled");
  assert.equal(publicTutorSession(repo.session(session.sessionId)).blocks[0].args.key, "B");
}));

test("a finish that also assesses a topic that came back still places the main topic", async () => fixture(({ repo }) => {
  const { exam, topics } = syllabus(repo);
  const session = repo.startSession(topics[0].topicId, "Sampling", 10, { examId: exam.examId, topicIds: topics.map(topic => topic.topicId) });
  const ask = (key, topicId) => { const block = repo.openBlock(session.sessionId, key, { tool: "tutor_ask_typed", args: { topicId, question: key + "?", accept: ["42"], hints: [] } }); repo.answerBlock(session.sessionId, block.blockId, { kind: "typed", answer: "42" }); return block; };
  const earlier = ask("earlier", topics[1].topicId), main = ask("main", topics[0].topicId);
  const result = repo.finish(session.sessionId, "finish", { topic: topics[0].topicId, level: 3, evidence: [{ blockId: main.blockId, rationale: "Unaided" }], missing: [], next: "Next", summary: "Done",
    assessments: [{ topic: topics[1].topicId, level: 3, evidence: [{ blockId: earlier.blockId, rationale: "Unaided" }], missing: [], next: "Next", summary: "Done" }] }).result;
  assert.deepEqual(result.assessments.map(item => [item.topicId, item.level]), [[topics[0].topicId, 3], [topics[1].topicId, 3]]);
  assert.equal(result.level, 3);
}));

test("only eligible evidence changes mastery, with first placement and delayed Solid, atomic finish and owner rejection", async () => fixture(({ repo, database, setNow }) => {
  const topic = repo.createFreeTopic("Algebra"), session = repo.startSession(topic.topicId, "Algebra", 10);
  const choice = repo.openBlock(session.sessionId, "choice", { tool: "tutor_ask_choice", args: { question: "?", options: ["A", "B"], correct: 0 } });
  repo.answerBlock(session.sessionId, choice.blockId, { kind: "choice", picked: 0 });
  assert.throws(() => finish(repo, session, choice), /typed or explanation/);
  assert.deepEqual(repo.mastery(), []);
  const block = typed(repo, repo.session(session.sessionId));
  const completed = finish(repo, session, block);
  assert.equal(completed.result.level, 3);
  finish(repo, session, block); assert.equal(repo.mastery()[0].level, 3); assert.equal(repo.mastery()[0].evidence.length, 1);
  const next = repo.startSession(topic.topicId, "Again", 10);
  assert.throws(() => finish(repo, next, block), /from this session/);
  assert.equal(repo.session(next.sessionId).status, "active");
  assert.equal(finish(repo, next, typed(repo, next)).result.level, 3);
  setNow("2026-09-20T12:00:00.000Z");
  const later = repo.startSession(topic.topicId, "Tomorrow", 10);
  assert.equal(finish(repo, later, typed(repo, later)).result.level, 4);
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

test("finishing inside the wrap window saves mastery and closes the open block", async () => fixture(({ repo, setNow, reopen }) => {
  const topic = repo.createFreeTopic("Algebra"), session = repo.startSession(topic.topicId, "Algebra", 1);
  const block = typed(repo, session);
  const open = repo.openBlock(session.sessionId, "waiting", { tool: "tutor_ask_typed", args: { question: "Next?", accept: ["42"], hints: [] } });
  setNow("2026-09-19T12:01:01.000Z");
  assert.equal(repo.state(session.sessionId).status, "active");
  assert.equal(repo.session(session.sessionId).blocks.find(b => b.blockId === open.blockId).status, "cancelled");
  repo = reopen(); repo.recover(); repo.transition(session.sessionId, "active");
  assert.throws(() => typed(repo, repo.session(session.sessionId)), /Time is up/);
  assert.equal(finish(repo, session, block).status, "completed");
  assert.equal(repo.mastery()[0].level, 3);
  assert.equal(repo.session(session.sessionId).elapsedSeconds, 60);
}));

test("in the wrap window a finish leaves out what can't count instead of failing", async () => fixture(({ repo, setNow }) => {
  const topic = repo.createFreeTopic("Algebra"), session = repo.startSession(topic.topicId, "Algebra", 1);
  const args = { question: "What is six times seven?", accept: ["42"], hints: [] };
  const first = typed(repo, session);
  const retried = repo.openBlock(session.sessionId, "retried", { tool: "tutor_ask_typed", args: { ...args, question: "Seven times six?" } });
  repo.answerBlock(session.sessionId, retried.blockId, { kind: "typed", answer: "41" });
  repo.openBlock(session.sessionId, "retried-again", { tool: "tutor_ask_typed", args: { ...args, question: "Seven times six?" } });
  repo.answerBlock(session.sessionId, retried.blockId, { kind: "typed", answer: "42" });
  const evidence = [first, retried].map(block => ({ blockId: block.blockId, rationale: "Unaided" }));
  const input = { topic: topic.topicId, level: 3, evidence, missing: [], next: "Next", summary: "Done" };
  assert.throws(() => repo.finish(session.sessionId, "early", input), /first try/);
  setNow("2026-09-19T12:01:01.000Z");
  const finished = repo.finish(session.sessionId, "finish", input);
  assert.equal(finished.status, "completed");
  assert.deepEqual(finished.result.evidence.map(item => item.blockId), [first.blockId]);
  assert.equal(repo.mastery()[0].level, 3);
}));

test("no finish in the wrap window expires without mastery; cancellation closes blocks", async () => fixture(({ repo, setNow }) => {
  const topic = repo.createFreeTopic("Algebra"), session = repo.startSession(topic.topicId, "Algebra", 1);
  const block = typed(repo, session);
  setNow("2026-09-19T12:01:01.000Z");
  assert.equal(repo.state(session.sessionId).status, "active");
  repo.transition(session.sessionId, "paused");
  setNow("2026-09-19T12:02:30.000Z");
  assert.equal(repo.state(session.sessionId).status, "expired");
  assert.throws(() => finish(repo, session, block), /expired/);
  assert.deepEqual(repo.mastery(), []);
  const next = repo.startSession(topic.topicId, "Again", 1);
  const open = repo.openBlock(next.sessionId, "explain", { tool: "tutor_ask_explain", args: { prompt: "Why?", rubric: ["PRIVATE-RUBRIC"] } });
  assert.equal(JSON.stringify(publicTutorSession(repo.session(next.sessionId))).includes("PRIVATE-RUBRIC"), false);
  repo.transition(next.sessionId, "cancelled");
  assert.equal(repo.session(next.sessionId).blocks.find(b => b.blockId === open.blockId).status, "cancelled");
}));

test("clicked only keeps a wrong answer followed by a later unaided independent answer", async () => fixture(({ repo }) => {
  for (const [index, scenario] of ["valid", "check", "hinted", "reversed", "no-mistake", "still-wrong", "foreign"].entries()) {
    const topic = repo.createFreeTopic(`Algebra ${index}`), session = repo.startSession(topic.topicId, "Algebra", 10);
    if (scenario === "reversed") repo.advance(session.sessionId, "independent");
    const wrong = typed(repo, session, { answer: scenario === "no-mistake" ? "42" : "43" });
    if (scenario !== "check" && scenario !== "reversed") repo.advance(session.sessionId, "independent");
    const right = repo.openBlock(session.sessionId, "right", { tool: "tutor_ask_typed", args: { question: "6*7?", accept: ["42"], hints: ["Multiply"] } });
    if (scenario === "hinted") repo.hint(session.sessionId, right.blockId);
    repo.answerBlock(session.sessionId, right.blockId, { kind: "typed", answer: scenario === "still-wrong" ? "43" : "42" });
    const clicked = { before: "I added", after: "I multiplied", wrongBlockId: scenario === "reversed" ? right.blockId : wrong.blockId,
      rightBlockId: scenario === "foreign" ? "foreign-block" : scenario === "reversed" ? wrong.blockId : right.blockId };
    const input = { topic: topic.topicId, level: 3, evidence: [], missing: [], next: "Return", summary: "Checked", cheatsheet: ["Six times seven is 42"], clicked: [clicked] };
    const done = repo.finish(session.sessionId, "finish", input);
    assert.deepEqual(done.result.clicked, scenario === "valid" ? [{ before: clicked.before, after: clicked.after }] : [], scenario);
    assert.deepEqual(done.result.cheatsheet, input.cheatsheet);
    assert.deepEqual(publicTutorSession(done).blocks.at(-1).args.clicked, done.result.clicked);
    assert.deepEqual(publicTutorSession(done).blocks.at(-1).args.cheatsheet, input.cheatsheet);
  }
}));

test("mock exam requires independent evidence across its topic set and commits all changes together", async () => fixture(({ repo }) => {
  const { exam, topics } = syllabus(repo);
  const session = repo.startSession(topics[0].topicId, "Mock exam", 15, { mode: "mock_exam", examId: exam.examId, topicIds: topics.map(t => t.topicId) });
  assert.throws(() => repo.openBlock(session.sessionId, "bad", { tool: "tutor_ask_typed", args: { question: "?", accept: ["yes"], hints: [] } }), /must name/);
  const assessments = topics.map((topic, index) => {
    const block = repo.openBlock(session.sessionId, `typed-${index}`, { tool: "tutor_ask_typed", args: { topicId: topic.topicId, question: "Known answer?", accept: ["yes"], hints: [] } });
    repo.answerBlock(session.sessionId, block.blockId, { kind: "typed", answer: "yes" });
    return { topic: topic.topicId, level: 4, evidence: [{ blockId: block.blockId, rationale: "Answered independently" }], summary: "Checked", missing: [], next: "Practice" };
  });
  assert.throws(() => repo.finish(session.sessionId, "finish", assessments[0]), /every exam topic/);
  assert.deepEqual(repo.mastery(), []);
  repo.finish(session.sessionId, "finish", { ...assessments[0], assessments });
  assert.equal(repo.mastery().length, 2); assert.ok(repo.mastery().every(m => m.level === 3));
}));

test("all six fixed model types are bounded and unknown/host execution models are rejected", () => {
  const models = [
    { model: "population_grid", params: { population: 100, sampleSize: 10, proportion: 0.5 }, controls: ["sample"] },
    { model: "number_line", params: { min: -10, max: 10, step: 1, points: [0] }, controls: ["move"] },
    { model: "function_plot", params: { family: "quadratic", a: 1, b: 0, c: 0, xMin: -10, xMax: 10 }, controls: ["a"] },
    { model: "flashcards", params: { cards: [{ front: "A", back: "B" }] }, controls: ["flip"] },
    { model: "code_runner", params: { language: "javascript", code: "console.log(42)", instructions: "Try it", timeoutMs: 500 }, controls: ["run"] },
    { model: "table", params: { columns: ["gap", "slope"], rows: [[1, 7], [0.1, "6.1"]] }, controls: [] },
  ];
  for (const model of models) TutorModelInputSchema.parse(model);
  assert.equal(TutorModelInputSchema.safeParse({ ...models[4], params: { ...models[4].params, language: "powershell" } }).success, false);
  assert.equal(TutorModelInputSchema.safeParse({ ...models[4], params: { ...models[4].params, timeoutMs: 999999 } }).success, false);
  assert.equal(TutorModelInputSchema.safeParse({ model: "custom_html", params: {}, controls: [] }).success, false);
  const plot = { ...models[2], params: { ...models[2].params, secant: { x: 3, gap: 1 }, labels: [{ x: 3, text: "the gap" }] }, controls: ["gap"] };
  TutorModelInputSchema.parse(plot);
  TutorModelInputSchema.parse({ ...plot, params: { ...plot.params, secant: { x: 3, gap: 0 } } });
  for (const params of [
    { ...plot.params, secant: { x: 3, gap: -1 } },
    { ...plot.params, secant: { x: 3, gap: 8 } },
    { ...plot.params, labels: Array(5).fill({ x: 3, text: "label" }) },
    { ...plot.params, labels: [{ x: 11, text: "outside" }] },
  ]) assert.equal(TutorModelInputSchema.safeParse({ ...plot, params }).success, false);
  assert.equal(TutorModelInputSchema.safeParse({ ...models[2], controls: ["gap"] }).success, false);
  const table = models[5];
  for (const params of [
    { ...table.params, columns: Array(9).fill("column") },
    { ...table.params, rows: Array(9).fill([1, 7]) },
    { ...table.params, rows: [[1]] },
  ]) assert.equal(TutorModelInputSchema.safeParse({ ...table, params }).success, false);
  assert.equal(TutorModelInputSchema.safeParse({ ...table, controls: ["sort"] }).success, false);
});

test("the selected goal survives Learn source, goal, topic and tutor mutations", async () => fixture(({ repo, reopen }) => {
  const { exam: first } = syllabus(repo);
  const selected = repo.setExam({ courseId: "other-course", title: "Final", date: null });
  const selectedState = (repository = repo) => {
    const state = repository.learnState("2026-09-19", selected.examId);
    assert.equal(state.plan.leadExam.examId, selected.examId);
    assert.ok(state.plan.todayTopic === null || state.plan.todayTopic.examId === selected.examId);
    return state;
  };
  selectedState();
  const source = repo.importSource({ courseId: selected.courseId, examId: selected.examId, title: "Review", kind: "paste", sourceTarget: null, text: "Stacks and queues." });
  selectedState();
  repo.markSource(source.sourceId, source.contentHash, "reading"); selectedState();
  repo.markSource(source.sourceId, source.contentHash, "failed", "Temporary extraction failure"); selectedState();
  repo.markSource(source.sourceId, source.contentHash, "reading"); selectedState();
  repo.applyExtraction(source.sourceId, source.contentHash, { exams: [], topics: [{ key: "stacks", examKey: null, title: "Stacks", chapter: 1, weight: null, quote: "Stacks and queues." }] });
  selectedState();
  repo.setExam({ examId: selected.examId, courseId: selected.courseId, title: "Final, revised", date: "2026-12-01" }); selectedState();
  const topic = repo.addTopic(selected.examId, "Queues"); selectedState();
  repo.removeTopic(topic.topicId); selectedState();
  repo.addTopic(selected.examId, "Queues"); selectedState();
  repo.removeExam(first.examId); selectedState();
  const session = repo.startSession(topic.topicId, "Queues", 10);
  selectedState();
  repo.transition(session.sessionId, "paused"); selectedState();
  repo.transition(session.sessionId, "active");
  finish(repo, session, typed(repo, session)); selectedState();
  selectedState(reopen());
}));

test("undated and topic-less exams are selectable; default selects the nearest dated exam", async () => fixture(({ repo }) => {
  const undated = repo.setExam({ courseId: "c", title: "Undated final", date: null });
  const distant = repo.setExam({ courseId: "c", title: "Exam 2", date: "2026-11-01" });
  const nearest = repo.setExam({ courseId: "c", title: "Exam 1", date: "2026-09-23" });
  repo.setExam({ courseId: "c", title: "Past test", date: "2026-09-01" });
  repo.setExam({ kind: "topic", courseId: null, title: "Gardening", date: null });
  assert.equal(repo.learnState("2026-09-19").plan.leadExam.examId, nearest.examId);
  for (const exam of [undated, distant, nearest]) {
    const plan = repo.learnState("2026-09-19", exam.examId).plan;
    assert.equal(plan.leadExam.examId, exam.examId);
    assert.equal(plan.todayTopic, null);
    assert.equal(plan.readiness.status, "unknown");
    assert.deepEqual(plan.comingBack, []);
  }
}));

test("a removed goal stays removed through re-extraction, omission, return and restart", async () => fixture(({ repo, reopen }) => {
  const { source, exam } = syllabus(repo);
  const extraction = { exams: [{ key: "new-provider-key", title: "Exam", date: "2026-09-25", quote: "Exam September 25, 2026." }], topics: [] };
  repo.removeExam(exam.examId);
  repo.applyExtraction(source.sourceId, source.contentHash, extraction);
  assert.equal(repo.learnState("2026-09-19").exams.length, 0);
  repo.applyExtraction(source.sourceId, source.contentHash, { exams: [], topics: [] });
  repo.applyExtraction(source.sourceId, source.contentHash, extraction);
  const restored = reopen();
  assert.equal(restored.exam(exam.examId).hidden, true);
  assert.equal(restored.learnState("2026-09-19").exams.length, 0);
}));

for (const phase of ["learn", "practice"]) test(`answers from ${phase} cannot change mastery even after advancing`, async () => fixture(({ repo }) => {
  const topic = repo.createFreeTopic("Algebra"), session = repo.startSession(topic.topicId, "Algebra", 10);
  repo.advance(session.sessionId, phase);
  const block = typed(repo, session);
  repo.advance(session.sessionId, "independent");
  assert.throws(() => finish(repo, session, block), /Only answers from Check or On your own/);
  assert.deepEqual(repo.mastery(), []);
  assert.equal(repo.session(session.sessionId).status, "active");
  assert.equal(repo.session(session.sessionId).blocks[0].phase, phase);
}));

test("tutor_advance moves only forward, preserves the phase on rejection and cannot skip an open question", async () => fixture(({ repo, reopen }) => {
  const topic = repo.createFreeTopic("Algebra"), session = repo.startSession(topic.topicId, "Algebra", 10);
  assert.equal(session.phase, "check");
  assert.equal(repo.advance(session.sessionId, "learn").phase, "learn");
  assert.throws(() => repo.advance(session.sessionId, "check"), /already past/);
  assert.throws(() => repo.advance(session.sessionId, "learn"), /already past/);
  const block = repo.openBlock(session.sessionId, "question", { tool: "tutor_ask_typed", args: { question: "6*7?", accept: ["42"], hints: [] } });
  assert.throws(() => repo.advance(session.sessionId, "practice"), /open block/);
  repo.answerBlock(session.sessionId, block.blockId, { kind: "typed", answer: "42" });
  assert.equal(repo.advance(session.sessionId, "independent").phase, "independent");
  assert.throws(() => repo.advance(session.sessionId, "practice"), /already past/);
  assert.throws(() => repo.advance(session.sessionId, "wrap"), /tutor_finish/);
  assert.equal(reopen().session(session.sessionId).phase, "independent");
}));

test("a third tutor_say is rejected, including while a question is waiting; replay is harmless", async () => fixture(({ repo }) => {
  const topic = repo.createFreeTopic("Algebra"), session = repo.startSession(topic.topicId, "Algebra", 10);
  const say = index => repo.openBlock(session.sessionId, `say-${index}`, { tool: "tutor_say", args: { text: `Explanation ${index}` } });
  say(0); const second = say(1);
  assert.equal(say(1).blockId, second.blockId);
  assert.throws(() => say(2), /three messages/);
  const block = repo.openBlock(session.sessionId, "question", { tool: "tutor_ask_typed", args: { question: "6*7?", accept: ["42"], hints: [] } });
  say(2); say(3);
  assert.throws(() => say(4), /three messages/);
  repo.answerBlock(session.sessionId, block.blockId, { kind: "typed", answer: "42" });
  assert.equal(repo.session(session.sessionId).blocks.length, 5);
}));

test("a file attached to a goal adds its topics without creating other exams", async () => fixture(async ({ repo, directory, reopen }) => {
  const goal = repo.setExam({ courseId: "c", title: "Chosen midterm", date: null });
  const path = join(directory, "review.md");
  await writeFile(path, "Exam A September 25. Exam B October 2. Stacks and queues.");
  const source = await importLearnFile(repo, path, goal.courseId, undefined, undefined, goal.examId);
  assert.equal(source.examId, goal.examId);
  repo.applyExtraction(source.sourceId, source.contentHash, {
    exams: [{ key: "a", title: "Exam A", date: "2026-09-25", quote: "Exam A September 25." }, { key: "b", title: "Exam B", date: "2026-10-02", quote: "Exam B October 2." }],
    topics: [{ key: "stacks", examKey: "a", title: "Stacks", chapter: 1, weight: null, quote: "Stacks and queues." }, { key: "queues", examKey: "b", title: "Queues", chapter: 2, weight: null, quote: "Stacks and queues." }],
  });
  const restored = reopen();
  assert.deepEqual(restored.exams().map(item => item.examId), [goal.examId]);
  assert.equal(restored.exam(goal.examId).date, null, "Conflicting dates cannot silently choose one");
  assert.equal(restored.topics().length, 2);
  assert.ok(restored.topics().every(item => item.examId === goal.examId && item.courseId === goal.courseId));
}));

test("pickExcerpts finds relevant material beyond the opening chunk within its budget", () => {
  const text = `${"Administrative policy and office hours. ".repeat(100)}\n\nBayes theorem: use the base rate to interpret a positive test.\n\n${"Unrelated syllabus text. ".repeat(80)}`;
  const excerpts = pickExcerpts(text, "Bayes theorem base rate", 120, 90);
  assert.ok(excerpts.some(chunk => chunk.includes("Bayes theorem")));
  assert.ok(excerpts.reduce((sum, chunk) => sum + chunk.length, 0) <= 120);
  assert.deepEqual(pickExcerpts(text, "the and for"), []);
  assert.deepEqual(pickExcerpts("", "Bayes"), []);
  assert.deepEqual(pickExcerpts(text, "Bayes", 0), []);
});

test("typed answers ignore a closing full stop, quotes and comma spacing", () => {
  assert.equal(normalizeTutorAnswer("“[1,2,3]; 2 shifts.”"), normalizeTutorAnswer("[1, 2, 3]; 2 shifts"));
  assert.equal(normalizeTutorAnswer("3.5"), "3.5");
  assert.equal(normalizeTutorAnswer("n!"), "n!");
  assert.notEqual(normalizeTutorAnswer("O(n)"), normalizeTutorAnswer("O(n^2)"));
});

test("a typed answer may add a unit word but not a hedge", () => {
  for (const lead of ["it's ", "i get ", "i think ", "about ", "roughly ", "= ", "x = ", "answer: "]) assert.equal(typedAnswerMatches(["4"], `${lead}4`), true);
  for (const answer of ["0.5", "1/2", ".5", "50%", "it's 0.5"]) assert.equal(typedAnswerMatches(["1/2"], answer), true);
  assert.equal(typedAnswerMatches(["50%"], "50"), false);
  assert.equal(typedAnswerMatches(["0"], "1/0"), false);
  assert.equal(typedAnswerMatches(["2"], "2 shifts."), true);
  assert.equal(typedAnswerMatches(["O(n)"], "O(n) time"), true);
  assert.equal(typedAnswerMatches(["2"], "20"), false);
  assert.equal(typedAnswerMatches(["2"], "2 or three"), false);
  assert.equal(typedAnswerMatches(["2"], "2 or 3"), false);
  assert.equal(typedAnswerMatches(["true"], "true not false"), false);
});

test("marking enforces order, protects right answers and keeps rubric private until marked", async () => fixture(({ repo }) => {
  const topic = repo.createFreeTopic("Algebra"), session = repo.startSession(topic.topicId, "Explain", 10);
  const explanation = repo.openBlock(session.sessionId, "explain", { tool: "tutor_ask_explain", args: { prompt: "Why?", rubric: ["States the cause", "Links the effect"] } });
  repo.answerBlock(session.sessionId, explanation.blockId, { kind: "explain", text: "My reasoning" });
  assert.equal(JSON.stringify(publicTutorSession(repo.session(session.sessionId))).includes("States the cause"), false);
  assert.throws(() => typed(repo, repo.session(session.sessionId)), /Mark the explanation/);
  assert.throws(() => finish(repo, session, explanation), /Mark the explanation/);
  repo.openBlock(session.sessionId, "say", { tool: "tutor_say", args: { text: "I see your reasoning." } });
  assert.throws(() => repo.grade(session.sessionId, { blockId: explanation.blockId, correct: true, met: [true] }), /every rubric/);
  repo.grade(session.sessionId, { blockId: explanation.blockId, correct: false, met: [true, false] });
  assert.deepEqual(publicTutorSession(repo.session(session.sessionId)).blocks[0].args.points, [{ text: "States the cause", met: true }, { text: "Links the effect", met: false }]);
  assert.throws(() => repo.grade(session.sessionId, { blockId: explanation.blockId, correct: true, met: [true, true] }), /already marked/);
  const wrong = typed(repo, repo.session(session.sessionId), { answer: "forty two" });
  assert.equal(repo.session(session.sessionId).blocks.find(b => b.blockId === wrong.blockId).result.matched, false);
  assert.throws(() => repo.grade(session.sessionId, { blockId: wrong.blockId, correct: true, equivalentTo: "43" }), /accepted answer/);
  assert.throws(() => repo.grade(session.sessionId, { blockId: wrong.blockId, correct: false }), /Only raise/);
  repo.grade(session.sessionId, { blockId: wrong.blockId, correct: true, equivalentTo: "42" });
  assert.throws(() => repo.grade(session.sessionId, { blockId: wrong.blockId, correct: false }), /Only raise/);
  assert.equal(finish(repo, session, wrong, 3).result.evidence[0].correct, true);
}));

test("an exam found by the school check and again in a syllabus is one exam", () => {
  assert.equal(sameExam({ title: "Final Exam (section 005)", date: "2026-12-03" }, { title: "Final Exam (Section 005)", date: "2026-12-03" }), true);
  assert.equal(sameExam({ title: "ST 370 Final Exam", date: null }, { title: "Final Exam", date: "2026-12-03" }), true);
  assert.equal(sameExam({ title: "C and Software Tools, Exam 1", date: null }, { title: "Exam 1", date: "2026-09-22" }), true);
  assert.equal(sameExam({ title: "Final Exam (section 005)", date: "2026-12-03" }, { title: "Final Exam (section 602)", date: "2026-12-07" }), false, "one final per section");
  assert.equal(sameExam({ title: "Midterm 1", date: "2026-10-08" }, { title: "Midterm 2", date: "2026-11-10" }), false);
  // Worded differently by the school check and a review page, on the same date.
  assert.equal(sameExam({ title: "Midterm 2", date: "2026-11-10" }, { title: "Midterm 2 during classtime in classroom", date: "2026-11-10" }), true);
  assert.equal(sameExam({ title: "Final Exam — Section 005", date: "2026-12-03" }, { title: "Final Exam Dec3 noon-2:30pm classroom", date: "2026-12-03" }), true);
  assert.equal(sameExam({ title: "ST 370 Final Exam", date: null }, { title: "Final Exam — Section 005", date: "2026-12-03" }), true);
  assert.equal(sameExam({ title: "Exam 1", date: null }, { title: "Exam 10", date: "2026-12-03" }), false);
});

test("a syllabus can name the saved exam it means, however it words it", async () => {
  await fixture(async ({ repo }) => {
    const checked = repo.setExam({ courseId: "course", title: "Final", date: null, kind: "exam" });
    const source = repo.importSource({ courseId: "course", title: "Review", kind: "scan", sourceTarget: "https://school.test/review", text: "The cumulative test is December 3, 2026." });
    repo.applyExtraction(source.sourceId, source.contentHash, { exams: [{ key: "cumulative", title: "Cumulative test", date: "2026-12-03", quote: "The cumulative test is December 3, 2026.", sameAs: checked.examId }], topics: [] });
    assert.deepEqual(repo.exams().map(exam => [exam.examId, exam.date]), [[checked.examId, "2026-12-03"]]);
  });
});

test("a syllabus reuses an exam the school check already saved and only fills its date", async () => {
  await fixture(async ({ repo }) => {
    const checked = repo.setExam({ courseId: "course", title: "Midterm 1", date: null, kind: "exam" });
    const source = repo.importSource({ courseId: "course", title: "Syllabus", kind: "scan", sourceTarget: "https://school.test/syllabus", text: "Midterm 1 is October 8, 2026." });
    repo.applyExtraction(source.sourceId, source.contentHash, { exams: [{ key: "m1", title: "MIDTERM 1", date: "2026-10-08", quote: "Midterm 1 is October 8, 2026." }], topics: [] });
    assert.equal(repo.exams().length, 1);
    assert.equal(repo.exams()[0].examId, checked.examId);
    assert.equal(repo.exams()[0].title, "Midterm 1");
    assert.equal(repo.exams()[0].date, "2026-10-08");
  });
});
