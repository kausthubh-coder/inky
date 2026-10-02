// Live Checkpoint 5 quality harness. All school facts come from the local "learn" fixture.
// Run after `bun run build && bun run build:lms`: `node agent-harness/tutor/run.mjs`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { startLms } from "../../.studi-lms/build/server.mjs";
import { StudiSqliteDatabase } from "../../dist/electron/storage/database.js";
import { LearnRepository } from "../../dist/electron/storage/learn-records.js";
import { TutorCoordinator } from "../../dist/electron/agent/tutor-coordinator.js";
import { PiAgentRuntime } from "../../dist/electron/agent/runtime.js";
import { boardView } from "../../dist/shared/tutor.js";
import { TopicMasterySchema } from "../../dist/shared/learn.js";
import { learnSessionMetrics } from "../../dist/electron/telemetry/learn-session.js";

const root = resolve(import.meta.dirname, "../..");
const runRoot = join(root, ".studi-harness", "tutor", new Date().toISOString().replaceAll(":", "-"));
const effortAt = process.argv.indexOf("--effort");
const effort = effortAt < 0 ? "high" : process.argv[effortAt + 1];
if (!["high", "medium"].includes(effort)) throw new Error("Use --effort high or --effort medium");
const personas = [
  { name: "novice", history: "New to sorting and shaky with array indexes.", misconceptions: ["Thinks insertion sort swaps every pair it compares", "Thinks a sorted prefix can contain the next unsorted item before shifting"] },
  { name: "partial", history: "Can trace the first insertion but loses track of the key.", misconceptions: ["Thinks the key changes value while larger items shift", "Counts the final placement as a shift"] },
  { name: "strong", history: "Can trace ordinary insertion sort and explain the invariant.", misconceptions: ["Thinks an already sorted input still makes a quadratic number of shifts", "Conflates comparisons with shifts"] },
  { name: "returning", history: "Previously studied two other topics in this course. Remembers the basics but needs a retrieval check. Can trace ordinary insertion sort.", misconceptions: ["Sometimes confuses comparisons with shifts"], returning: true },
];
const scoresType = Type.Object({ orient: Type.Integer({ minimum: 1, maximum: 5 }), firstWrongAssumption: Type.Integer({ minimum: 1, maximum: 5 }), sourceCitations: Type.Integer({ minimum: 1, maximum: 5 }), oneIdea: Type.Integer({ minimum: 1, maximum: 5 }), evidenceOnly: Type.Integer({ minimum: 1, maximum: 5 }) }, { additionalProperties: false });

function captureTool(name, schema, receive) {
  return defineTool({ name, label: name, description: `Record ${name} once for this turn.`, parameters: schema,
    execute: async (_id, input) => { receive(input); return { content: [{ type: "text", text: "Recorded." }], details: input }; } });
}
function publicBlock(block) {
  if (block.tool === "tutor_ask_choice") { const { correct, ...args } = block.args; return { ...block, args }; }
  if (block.tool === "tutor_ask_typed") { const { accept, ...args } = block.args; return { ...block, args }; }
  if (block.tool === "tutor_ask_explain") { const { rubric, ...args } = block.args; return { ...block, args }; }
  return block;
}
async function waitForAction(coordinator, sessionId, seen, deadline) {
  while (Date.now() < deadline) {
    const state = coordinator.state(sessionId);
    if (state.status !== "active") return { state, block: null };
    const view = boardView(state);
    const block = state.blocks.find(item => item.blockId === view.at && item.status === "open" && !seen.has(`${item.blockId}:${item.attempts.length}`));
    if (block) return { state, block };
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("The live tutor session exceeded its budget and 90-second wrap-up window");
}
function answerFor(block, reply) {
  const answer = String(reply.answer ?? "").trim();
  if (!answer) throw new Error("The simulated student gave no answer");
  if (block.tool === "tutor_ask_choice") {
    const lower = answer.toLowerCase();
    let index = block.args.options.findIndex(option => option.toLowerCase() === lower);
    // Students answer in words ("Only 4, I think."); take the one option their words name.
    const named = block.args.options.flatMap((option, at) => lower.includes(option.toLowerCase()) ? [at] : []);
    if (index < 0 && named.length === 1) index = named[0];
    const picked = index >= 0 ? index : Number(answer);
    if (!Number.isInteger(picked) || picked < 0 || picked >= block.args.options.length) throw new Error(`Student picked no valid option: ${answer}`);
    return { kind: "choice", picked };
  }
  if (block.tool === "tutor_ask_typed") return { kind: "typed", answer };
  if (block.tool === "tutor_ask_explain") return { kind: "explain", text: answer };
  if (block.tool === "tutor_show_page" || block.tool === "tutor_show_model") return { kind: "model", explored: [answer.slice(0, 200)] };
  throw new Error(`Unexpected interactive block ${block.tool}`);
}
function seed(repository, inspection, school) {
  const exam = inspection.truth.expectedExams.find(item => item.courseId === "structures");
  assert.ok(exam);
  const syllabus = inspection.state.assets.find(item => item.id === "structures-syllabus");
  const review = inspection.state.assets.find(item => item.id === "structures-review");
  assert.ok(syllabus?.text && review?.text, "The fake Learn course needs its syllabus and numbered review sheet");
  const syllabusSource = repository.importSource({ courseId: "structures", examId: null, title: "CS 316 syllabus", kind: "paste", sourceTarget: school.url + exam.sourcePath, text: syllabus.text });
  const expectedTopics = inspection.truth.expectedTopics.filter(item => item.examId === exam.id);
  repository.applyExtraction(syllabusSource.sourceId, syllabusSource.contentHash, {
    exams: [{ key: exam.id, title: exam.title, date: exam.date.slice(0, 10), quote: exam.title }],
    topics: expectedTopics.map(item => ({ key: item.id, examKey: exam.id, title: item.title, chapter: item.chapter, weight: item.weight, quote: item.title })),
  });
  const savedExam = repository.exams().find(item => item.title === exam.title);
  const reviewSource = repository.importSource({ courseId: "structures", examId: savedExam.examId, title: "CS 316 midterm review sheet", kind: "paste", sourceTarget: school.url + "/files/structures-review", text: review.text });
  repository.applyExtraction(reviewSource.sourceId, reviewSource.contentHash, { exams: [], topics: [] });
  return repository.topics().find(item => item.title === "Insertion sort");
}

async function runPersona(persona, inspection, school) {
  const directory = join(runRoot, persona.name);
  await mkdir(directory, { recursive: true });
  const database = new StudiSqliteDatabase(join(directory, "learn.sqlite3"));
  const clockStart = Date.now();
  const repository = new LearnRepository(database, `qa-tutor-${persona.name}`, () => new Date(Date.parse("2026-09-20T12:00:00Z") + Date.now() - clockStart).toISOString());
  const topic = seed(repository, inspection, school);
  assert.ok(topic);
  const due = persona.returning ? repository.topics().filter(item => item.examId === topic.examId && item.topicId !== topic.topicId).slice(0, 2) : [];
  if (persona.returning) assert.equal(due.length, 2, "The returning student needs two earlier topics");
  for (const earlier of due) {
    const mastery = TopicMasterySchema.parse({ topicId: earlier.topicId, level: 3, updatedAt: "2026-09-18T12:00:00.000Z",
      review: { dueOn: "2026-09-20", gapDays: 2, lastRightOn: "2026-09-18" },
      evidence: [{ sessionId: "previous-lesson", blockId: `previous-${earlier.topicId}`, kind: "typed", correct: true,
        answer: "Previously answered correctly", rationale: "Seeded returning-student history", hintsUsed: 0, recordedAt: "2026-09-18T12:00:00.000Z" }] });
    database.handle.prepare("INSERT INTO learn_mastery(owner_subject,id,record_json) VALUES (?,?,?)").run(repository.ownerSubject, earlier.topicId, JSON.stringify(mastery));
  }
  const authProfile = join(runRoot, "profile");
  const runtime = await PiAgentRuntime.create({ cwd: directory, agentDir: join(authProfile, "studi-data", "pi"), sessionDirectory: join(directory, "sessions") });
  runtime.selectModel("openai-codex", "gpt-6-sol");
  runtime.setReasoningEffort(effort);
  const status = await runtime.getProviderStatus("openai-codex");
  if (status.state !== "ready") throw new Error(`Live tutor provider ${status.state}`);
  const transcript = [];
  let reply = null;
  const student = await runtime.createLearningSession([captureTool("student_reply", Type.Object({ answer: Type.String({ minLength: 1 }), thinking: Type.String() }, { additionalProperties: false }), value => { reply = value; })],
    `You are a simulated ${persona.name} student, using GPT-6 Sol. ${persona.history} Keep these private misconceptions internally: ${persona.misconceptions.join("; ")}. Answer Inky honestly from this knowledge, including mistakes it causes. Do not reveal the misconception list. On every turn call student_reply with your answer and brief thinking. For a choice question, answer with the exact text of one option. For interactive pages or models, name one control you tried. Never pretend to know what the instructor did not teach.`);
  const errors = [];
  let visualUpdates = 0, boardHitCapacity = false, capacityRejections = 0;
  // Observe tool results without changing the tutor's tools, prompt, or lesson rules.
  const observedRuntime = { createLearningSession: (tools, prompt) => runtime.createLearningSession(tools.map(tool => ({ ...tool,
    execute: async (...args) => {
      try {
        const result = await tool.execute(...args);
        if (tool.name === "tutor_update") visualUpdates += 1;
        return result;
      } catch (error) {
        if (String(error).includes("The board is full")) capacityRejections += 1;
        throw error;
      }
    },
  })), prompt) };
  const coordinator = new TutorCoordinator(repository, observedRuntime, { context: {
    courseLabel: () => "CS 316 Data Structures", workedHomework: () => [], today: () => "2026-09-20",
  }, onError: error => errors.push(String(error)), onChange: state => {
    const view = boardView(state);
    if (view.visuals.length >= 2 || view.visuals.some(visual => visual.children.length >= 2)) boardHitCapacity = true;
  } });
  const startedAt = Date.now();
  const session = await coordinator.start({ topicId: topic.topicId, minutes: 15 });
  const seen = new Set();
  let sentChat = false;
  try {
    while (true) {
      const { state, block } = await waitForAction(coordinator, session.sessionId, seen, startedAt + (15 * 60 + 90 + 30) * 1000);
      if (!block) break;
      if (!sentChat && block.phase === "practice") {
        sentChat = true;
        await coordinator.send(session.sessionId, "Can you explain that another way?");
        continue;
      }
      seen.add(`${block.blockId}:${block.attempts.length}`);
      const view = boardView(state, block.blockId);
      const recentSays = [...view.lead, ...view.feedback].map(item => item.args.text);
      reply = null;
      await student.prompt(`Your tutor's words: ${JSON.stringify(recentSays)}\nCurrent board and chat (public student view): ${JSON.stringify(view)}\nCurrent activity: ${JSON.stringify(publicBlock(block))}\nReply as this student using student_reply.`);
      if (!reply) throw new Error("The simulated student did not call student_reply");
      const answer = answerFor(block, reply);
      transcript.push({ phase: block.phase, tool: block.tool, args: publicBlock(block).args, tutorSays: recentSays, student: reply, answer });
      coordinator.answerBlock(session.sessionId, block.blockId, answer);
    }
    const final = coordinator.state(session.sessionId);
    if (!["completed", "expired", "cancelled"].includes(final.status)) throw new Error(`Student could not finish: tutor ${final.status}; ${errors.join("; ")}`);
    const allBlocks = final.blocks;
    const questions = allBlocks.filter(item => item.tool.startsWith("tutor_ask_"));
    const cited = questions.filter(item => item.args.source?.trim()).length;
    const visual = allBlocks.some(item => item.tool === "tutor_show_page" || item.tool === "tutor_show_model");
    const visuals = allBlocks.filter(item => item.tool === "tutor_show_page" || item.tool === "tutor_show_model");
    const afterAnswer = visuals.filter(item => {
      const previous = allBlocks.filter(block => block.sequence < item.sequence && block.tool !== "tutor_reply").at(-1);
      return previous?.answeredAt && previous.answeredAt <= item.createdAt;
    }).length;
    const explanations = repository.session(final.sessionId).blocks.flatMap(block => block.tool === "tutor_ask_explain"
      ? block.attempts.flatMap((attempt, index) => typeof attempt.correct === "boolean" ? [{ blockId: `${block.blockId}:${index}`, prompt: block.args.prompt,
        rubric: block.args.rubric, answer: attempt.answer.text, correct: attempt.correct }] : []) : []);
    let blindMarks = [];
    if (explanations.length) {
      const marker = await runtime.createLearningSession([captureTool("mark_explanations", Type.Object({ marks: Type.Array(Type.Object({ blockId: Type.String(), met: Type.Array(Type.Boolean()) }, { additionalProperties: false })) }, { additionalProperties: false }), value => { blindMarks = value.marks; })],
        "Mark each student explanation blind against its rubric. Return one met boolean per rubric point, in order. Use only the answer and rubric, without inferring the tutor's verdict. Call mark_explanations exactly once.");
      try { await marker.prompt(JSON.stringify(explanations.map(({ correct: _correct, ...explanation }) => explanation))); }
      finally { marker.dispose(); }
    }
    if (blindMarks.length !== explanations.length || explanations.some(explanation => blindMarks.filter(mark => mark.blockId === explanation.blockId && mark.met.length === explanation.rubric.length).length !== 1)) throw new Error("Blind marker did not mark every explanation against its rubric");
    const agreements = explanations.filter(explanation => blindMarks.find(mark => mark.blockId === explanation.blockId).met.every(Boolean) === explanation.correct).length;
    const returningTopics = due.map(earlier => {
      const record = repository.mastery().find(item => item.topicId === earlier.topicId);
      return { topicId: earlier.topicId, askedInCheck: questions.some(block => block.phase === "check" && block.args.topicId === earlier.topicId),
        dueBefore: "2026-09-20", dueAfter: record?.review?.dueOn ?? null, dateMoved: !!record?.review && record.review.dueOn !== "2026-09-20" };
    });
    let run = 0, maxSays = 0;
    for (const block of allBlocks) { run = block.tool === "tutor_say" ? run + 1 : 0; maxSays = Math.max(maxSays, run); }
    let judgement = null;
    const judge = await runtime.createLearningSession([captureTool("judge_report", Type.Object({ scores: scoresType, rationale: Type.String() }, { additionalProperties: false }), value => { judgement = value; })],
      "You are an independent tutor-quality rubric judge using GPT-6 Sol. Score each dimension 1–5. Orient: tutor framed the task before questioning. First wrong assumption: traced the first misconception with a concrete failing case and invited revision. Source citations: questions identify the real review sheet or syllabus without invention. One idea: one idea at a time and at most two tutor_say blocks in a row. Evidence only: level moved only on unaided Check or On-your-own typed/explanation evidence. Base scores on the transcript, not on the tutor's claims. Call judge_report exactly once.");
    try { await judge.prompt(`Grounding: ${JSON.stringify({ syllabus: inspection.state.assets.find(item => item.id === "structures-syllabus")?.text, review: inspection.state.assets.find(item => item.id === "structures-review")?.text })}\nSession: ${JSON.stringify(final)}\nStudent transcript: ${JSON.stringify(transcript)}\nReturn rubric scores.`); }
    finally { judge.dispose(); }
    if (!judgement) throw new Error("The rubric judge did not call judge_report");
    const metrics = learnSessionMetrics(final);
    const measurements = { placedLevel: final.result?.level ?? null, visualsAfterAnswer: afterAnswer, visualsShown: visuals.length,
      visualsAfterAnswerShare: visuals.length ? afterAnswer / visuals.length : null, explanationsMarked: explanations.length,
      explanationAgreements: agreements, explanationAgreementShare: explanations.length ? agreements / explanations.length : null,
      finishedBeforeTimeUp: final.status === "completed" && !final.wrapStartedAt && final.elapsedSeconds < final.budgetSeconds,
      chatMessages: final.messages.length, chatMessagesReplied: final.messages.filter(message => allBlocks.some(block => block.tool === "tutor_reply" && block.replyTo === message.messageId)).length,
      chatReplies: metrics.chat_replies, visualUpdates, questionsWithSecondTry: metrics.second_tries,
      boardHitCapacity, capacityRejections, waitMedianSeconds: metrics.wait_median_s, returningTopics,
      bothDueTopicsAskedInCheck: due.length ? returningTopics.every(item => item.askedInCheck) : null,
      bothDueDatesMoved: due.length ? returningTopics.every(item => item.dateMoved) : null };
    const result = { persona: persona.name, model: "gpt-6-sol", effort, status: final.status, ...measurements,
      minutes: Number(((Date.now() - startedAt) / 60_000).toFixed(2)), usage: runtime.takeLastUsage(),
      questions: questions.length, sourceLabels: cited, sourceShare: questions.length ? cited / questions.length : 0,
      visual, maxConsecutiveSays: maxSays, levelBefore: final.initialLevel, levelAfter: final.result?.level ?? null,
      judge: judgement, errors, transcript, session: final };
    await writeFile(join(directory, "transcript.json"), JSON.stringify(result, null, 2));
    return { persona: persona.name, effort, status: result.status, minutes: result.minutes, questions: questions.length, sourceLabels: cited, sourceShare: result.sourceShare,
      visual, maxConsecutiveSays: maxSays, levelBefore: final.initialLevel, levelAfter: final.result?.level ?? null, ...measurements,
      scores: judgement.scores, tokens: result.usage, transcript: join(directory, "transcript.json") };
  } finally { student.dispose(); await coordinator.dispose(); database.close(); }
}

await mkdir(runRoot, { recursive: true });
const authProfile = join(runRoot, "profile");
execFileSync(process.execPath, [join(root, ".agents/skills/test-studi/scripts/sync-studi-qa-codex-auth.mjs"), "--import", "--profile", authProfile], { cwd: root, stdio: "pipe", windowsHide: true });
await mkdir(join(runRoot, "lms"), { recursive: true });
const school = await startLms({ scenarioId: "learn", seed: 42, runDirectory: join(runRoot, "lms") });
try {
  const inspection = school.inspect();
  const results = [];
  for (const persona of personas) {
    try { results.push(await runPersona(persona, inspection, school)); }
    catch (error) { results.push({ persona: persona.name, error: String(error) }); }
    await writeFile(join(runRoot, "summary.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results.at(-1)));
  }
  if (results.some(item => item.error)) process.exitCode = 1;
} finally { await school.close(); }
