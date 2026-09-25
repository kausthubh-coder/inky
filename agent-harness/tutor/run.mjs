// Live Checkpoint 5 quality harness. All school facts come from the local "learn" fixture.
// Run after `bun run build && bun run build:lms`: `node agent-harness/tutor/run.mjs`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { startLms } from "../../.studi-lms/build/server.mjs";
import { gradeLearn } from "../lms/evaluate.mjs";
import { StudiSqliteDatabase } from "../../dist/electron/storage/database.js";
import { LearnRepository } from "../../dist/electron/storage/learn-records.js";
import { TutorCoordinator } from "../../dist/electron/agent/tutor-coordinator.js";
import { PiAgentRuntime } from "../../dist/electron/agent/runtime.js";

const root = resolve(import.meta.dirname, "../..");
const runRoot = join(root, ".studi-harness", "tutor", new Date().toISOString().replaceAll(":", "-"));
const personas = [
  { name: "novice", history: "New to sorting and shaky with array indexes.", misconceptions: ["Thinks insertion sort swaps every pair it compares", "Thinks a sorted prefix can contain the next unsorted item before shifting"] },
  { name: "partial", history: "Can trace the first insertion but loses track of the key.", misconceptions: ["Thinks the key changes value while larger items shift", "Counts the final placement as a shift"] },
  { name: "strong", history: "Can trace ordinary insertion sort and explain the invariant.", misconceptions: ["Thinks an already sorted input still makes a quadratic number of shifts", "Conflates comparisons with shifts"] },
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
    const block = state.blocks.find(item => item.status === "open" && !seen.has(item.blockId));
    if (block) return { state, block };
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("The 15-minute live tutor session reached its deadline");
}
function answerFor(block, reply) {
  const answer = String(reply.answer ?? "").trim();
  if (!answer) throw new Error("The simulated student gave no answer");
  if (block.tool === "tutor_ask_choice") {
    const index = block.args.options.findIndex(option => option.toLowerCase() === answer.toLowerCase());
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
  const observation = {
    exams: repository.exams().map(item => ({ id: exam.id, courseId: item.courseId, title: item.title, date: item.date, sourceUrl: syllabusSource.sourceTarget })),
    topics: repository.topics().map(item => ({ id: expectedTopics.find(expected => expected.title === item.title)?.id, examId: exam.id, courseId: item.courseId, title: item.title, chapter: item.chapter, weight: item.weight })),
  };
  return { grade: gradeLearn(inspection, observation, school.origins), topic: repository.topics().find(item => item.title === "Insertion sort") };
}

async function runPersona(persona, inspection, school) {
  const directory = join(runRoot, persona.name);
  await mkdir(directory, { recursive: true });
  const database = new StudiSqliteDatabase(join(directory, "learn.sqlite3"));
  const repository = new LearnRepository(database, `qa-tutor-${persona.name}`);
  const { grade, topic } = seed(repository, inspection, school);
  assert.ok(topic);
  const authProfile = join(runRoot, "profile");
  const runtime = await PiAgentRuntime.create({ cwd: directory, agentDir: join(authProfile, "studi-data", "pi"), sessionDirectory: join(directory, "sessions") });
  runtime.selectModel("openai-codex", "gpt-6-sol");
  runtime.setReasoningEffort("high");
  const status = await runtime.getProviderStatus("openai-codex");
  if (status.state !== "ready") throw new Error(`Live tutor provider ${status.state}`);
  const transcript = [];
  let reply = null;
  const student = await runtime.createLearningSession([captureTool("student_reply", Type.Object({ answer: Type.String({ minLength: 1 }), thinking: Type.String() }, { additionalProperties: false }), value => { reply = value; })],
    `You are a simulated ${persona.name} student, using GPT-6 Sol. ${persona.history} Keep these private misconceptions internally: ${persona.misconceptions.join("; ")}. Answer Inky honestly from this knowledge, including mistakes it causes. Do not reveal the misconception list. On every turn call student_reply with your answer and brief thinking. For interactive pages or models, name one control you tried. Never pretend to know what the instructor did not teach.`);
  const errors = [];
  const coordinator = new TutorCoordinator(repository, runtime, { context: {
    courseLabel: () => "CS 316 Data Structures", workedHomework: () => [], today: () => "2026-09-20",
  }, onError: error => errors.push(String(error)) });
  const startedAt = Date.now();
  const session = await coordinator.start({ topicId: topic.topicId, minutes: 15 });
  const seen = new Set();
  try {
    while (true) {
      const { state, block } = await waitForAction(coordinator, session.sessionId, seen, startedAt + 15 * 60_000);
      if (!block) break;
      seen.add(block.blockId);
      const recentSays = state.blocks.filter(item => item.tool === "tutor_say").slice(-2).map(item => item.args.text);
      reply = null;
      await student.prompt(`Your tutor's last words: ${JSON.stringify(recentSays)}\nCurrent activity (public student view): ${JSON.stringify(publicBlock(block))}\nReply as this student using student_reply.`);
      if (!reply) throw new Error("The simulated student did not call student_reply");
      const answer = answerFor(block, reply);
      transcript.push({ phase: block.phase, tool: block.tool, args: publicBlock(block).args, tutorSays: recentSays, student: reply, answer });
      coordinator.answerBlock(session.sessionId, block.blockId, answer);
    }
    const final = coordinator.state(session.sessionId);
    const allBlocks = final.blocks;
    const questions = allBlocks.filter(item => item.tool.startsWith("tutor_ask_"));
    const cited = questions.filter(item => item.args.source?.trim()).length;
    const visual = allBlocks.some(item => item.tool === "tutor_show_page" || item.tool === "tutor_show_model");
    let run = 0, maxSays = 0;
    for (const block of allBlocks) { run = block.tool === "tutor_say" ? run + 1 : 0; maxSays = Math.max(maxSays, run); }
    let judgement = null;
    const judge = await runtime.createLearningSession([captureTool("judge_report", Type.Object({ scores: scoresType, rationale: Type.String() }, { additionalProperties: false }), value => { judgement = value; })],
      "You are an independent tutor-quality rubric judge using GPT-6 Sol. Score each dimension 1–5. Orient: tutor framed the task before questioning. First wrong assumption: traced the first misconception with a concrete failing case and invited revision. Source citations: questions identify the real review sheet or syllabus without invention. One idea: one idea at a time and at most two tutor_say blocks in a row. Evidence only: level moved only on unaided Check or On-your-own typed/explanation evidence. Base scores on the transcript, not on the tutor's claims. Call judge_report exactly once.");
    await judge.prompt(`Grounding: ${JSON.stringify({ syllabus: inspection.state.assets.find(item => item.id === "structures-syllabus")?.text, review: inspection.state.assets.find(item => item.id === "structures-review")?.text })}\nSession: ${JSON.stringify(final)}\nStudent transcript: ${JSON.stringify(transcript)}\nReturn rubric scores.`);
    judge.dispose();
    const result = { persona: persona.name, model: "gpt-6-sol", effort: "high", status: final.status,
      minutes: Number(((Date.now() - startedAt) / 60_000).toFixed(2)), usage: runtime.takeLastUsage(),
      questions: questions.length, sourceLabels: cited, sourceShare: questions.length ? cited / questions.length : 0,
      visual, maxConsecutiveSays: maxSays, levelBefore: final.initialLevel, levelAfter: final.result?.level ?? null,
      gradeLearn: grade, judge: judgement, errors, transcript, session: final };
    await writeFile(join(directory, "transcript.json"), JSON.stringify(result, null, 2));
    return { persona: persona.name, status: result.status, minutes: result.minutes, sourceShare: result.sourceShare, visual, scores: judgement?.scores ?? null, gradeLearn: grade.passed, transcript: join(directory, "transcript.json") };
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
  if (results.some(item => item.error || !item.scores || Object.values(item.scores).some(score => score < 4) || item.sourceShare < 0.6 || !item.visual)) process.exitCode = 1;
} finally { await school.close(); }
