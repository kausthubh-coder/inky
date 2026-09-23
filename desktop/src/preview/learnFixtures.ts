import type { StudiRendererApi } from "../../shared/index.js";
import type { LearnState } from "../../shared/learn-state.js";
import type { PublicTutorBlock, PublicTutorSession, TutorPhase } from "../../shared/tutor.js";
import type { NoteDocument } from "../../shared/note.js";
import { orderGoals, planLearn, type Exam, type LearnSource, type LearnTopic } from "../../shared/learn.js";

const DAY = 86_400_000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toLocaleDateString("en-CA");

/** Controlled preview state only. Never installed by the production entry point. */
export function learnPreview(id: string) {
  const now = () => new Date().toISOString();
  const today = day(0);
  const exam = (examId: string, courseId: string | null, title: string, date: string | null, kind: Exam["kind"] = "exam"): Exam =>
    ({ examId, courseId, title, date, sourceId: null, dateOrigin: "source", updatedAt: now(), kind, scopeNote: null, hidden: false });
  const topic = (topicId: string, examId: string, courseId: string | null, title: string, chapter: number, weight: number | null): LearnTopic =>
    ({ topicId, examId, courseId, title, chapter, weight, sourceId: null, origin: weight === null ? "student" : "source", updatedAt: now(), hidden: false });
  const source = (sourceId: string, courseId: string | null, title: string, status: LearnSource["status"] = "ready", error: string | null = null): Omit<LearnSource, "text"> =>
    ({ sourceId, courseId, examId: null, title, kind: "file", sourceTarget: null, contentHash: "a".repeat(64), status, extractedAt: status === "ready" ? now() : null, error, createdAt: now(), updatedAt: now() });

  const empty = id === "learn-empty" || id === "learn-reading";
  let exams: Exam[] = empty ? [] : [
    exam("exam-st370", "course-st370", "Midterm 1", day(6)),
    exam("exam-csc316", "course-csc316", "Midterm", day(12)),
    exam("exam-ma241", "course-ma241", "Final", null),
    exam("goal-python", null, "Python basics", null, "topic"),
  ];
  let topics: LearnTopic[] = empty ? [] : [
    ...[["Counting and sets", 15], ["Conditional probability", 25], ["Bayes' theorem", 30], ["Random variables", 20], ["Distributions", 10]]
      .map(([title, weight], index) => topic(`topic-${index}`, "exam-st370", "course-st370", String(title), index, Number(weight))),
    ...["Heaps and priority queues", "Sorting", "Hash tables", "Graphs"].map((title, index) => topic(`csc-${index}`, "exam-csc316", "course-csc316", title, index, null)),
    ...["Variables and types", "Conditionals", "Loops", "Functions", "Files"].map((title, index) => topic(`py-${index}`, "goal-python", null, title, index, null)),
  ];
  let sources: LearnState["sources"] = id === "learn-reading" ? [source("source-new", null, "ST 370 syllabus.pdf", "reading")] : empty ? [] : [
    source("source-st370", "course-st370", "ST 370 syllabus.pdf"), source("source-review", "course-st370", "Midterm 1 review sheet.pdf"),
    source("source-quiz", "course-st370", "Quiz 2, graded 7/10"), source("source-slides", "course-st370", "Lecture 7, Bayes.pdf"),
    source("source-csc316", "course-csc316", "CSC 316 syllabus.pdf"),
    ...(id === "learn-error" ? [source("source-bad", "course-ma241", "MA 241 scan.pdf", "failed", "It's a photo with no readable text. Paste the exam topics instead.")] : []),
  ];
  const levels: Record<string, number> = id === "learn-partial" ? { "topic-0": 4, "topic-1": 3 }
    : { "topic-0": 4, "topic-1": 3, "topic-2": 1, "topic-3": 2, "csc-1": 2, "csc-2": 1, "py-0": 3, "py-1": 2, "py-2": 1 };
  const mastery = empty ? [] : Object.entries(levels).map(([topicId, level], index) => ({
    topicId, level, updatedAt: now(),
    evidence: [{ sessionId: "previous", blockId: `evidence-${index}`, kind: "typed" as const, correct: true, answer: "Simulated answer", rationale: "Simulated session evidence", hintsUsed: 0, recordedAt: now() }],
  }));
  const past = (sessionId: string, topicId: string, daysAgo: number) => ({ sessionId, topicId, mode: "topic" as const, goal: "Practice", status: "completed" as const,
    startedAt: new Date(Date.now() - daysAgo * DAY).toISOString(), updatedAt: new Date(Date.now() - daysAgo * DAY).toISOString(), finishedAt: new Date(Date.now() - daysAgo * DAY).toISOString(), result: null });
  const history = empty ? [] : [past("py-a", "py-0", 9), past("py-b", "py-1", 6), past("py-c", "py-2", 4), past("st-a", "topic-1", id === "learn-recap" ? 3 : 1)];
  let selected: string | undefined = { "learn-no-topics": "exam-ma241", "learn-topic-goal": "goal-python" }[id];

  const block = (sequence: number, phase: TutorPhase, tool: PublicTutorBlock["tool"], args: unknown, result: PublicTutorBlock["result"] = null): PublicTutorBlock =>
    ({ blockId: `block-${sequence}`, toolCallId: `call-${sequence}`, sequence, status: result ? "answered" : tool === "tutor_say" ? "complete" : "open",
      createdAt: now(), answeredAt: result ? now() : null, elapsedAtCreation: 0, phase, hintsUsed: 0, draft: "", result, tool, args }) as PublicTutorBlock;
  const say = (sequence: number, phase: TutorPhase, text: string) => block(sequence, phase, "tutor_say", { text });
  const checkDone = [
    say(0, "check", "Quick check first. Go with your gut."),
    block(1, "check", "tutor_ask_choice", { question: "P(A | B) means the chance of A…", options: ["when B already happened", "and B both happen", "or B, either one"] },
      { answer: { kind: "choice", picked: 0 }, correct: true, hintsUsed: 0, seconds: 6 }),
    say(2, "learn", "Right. Now a rare disease: 1 in 100 people have it, and the test is 90% accurate. Before we work it out, guess."),
    block(3, "learn", "tutor_ask_choice", { question: "You test positive. How likely is it that you're sick?", options: ["About 90%", "About 50%", "Under 10%"] },
      { answer: { kind: "choice", picked: 0 }, correct: false, hintsUsed: 0, seconds: 11 }),
    say(4, "learn", "Most people say 90%. Let's see why it's much lower. Move the base rate and watch the positives."),
    block(5, "learn", "tutor_show_model", { model: "population_grid", params: { population: 1000, sampleSize: 100, proportion: 0.01 }, controls: ["sample", "sampleSize", "reset"] },
      { answer: { kind: "model", explored: ["1%", "10%"] }, correct: null, hintsUsed: 0, seconds: 40 }),
  ];
  const model = id.slice("tutor-".length);
  const opener: PublicTutorBlock[] =
    model === "choice" ? [say(0, "check", "Quick check first. Go with your gut."),
      block(1, "check", "tutor_ask_choice", { question: "P(A | B) means the chance of A…", options: ["when B already happened", "and B both happen", "or B, either one"] })]
    : model === "typed" ? [...checkDone, say(6, "practice", "Your turn. No picture this time, but I'm here if you get stuck."),
      block(7, "practice", "tutor_ask_typed", { question: "Now 1 in 10 people has the disease. Same test. You test positive. How likely is it that you're sick?", hints: [], hasMoreHints: true, source: "Matches the format of problem 3 on the Midterm 1 review sheet." })]
    : model === "explain" ? [...checkDone, say(6, "independent", "On your own now. Explain it the way you'd tell a friend."),
      block(7, "independent", "tutor_ask_explain", { prompt: "Your friend tested positive and thinks there's a 90% chance they're sick. What do you tell them?" })]
    : [say(0, "learn", "Try it and watch what changes."), block(1, "learn", "tutor_show_model", ({
        population: { model: "population_grid", params: { population: 1000, sampleSize: 100, proportion: 0.1 }, controls: ["sample", "sampleSize", "reset"] },
        flashcards: { model: "flashcards", params: { cards: [{ front: "P(A | B)", back: "The probability of A, given B." }, { front: "Base rate", back: "How common something is before new evidence." }] }, controls: ["flip", "next", "previous"] },
        "number-line": { model: "number_line", params: { min: -10, max: 10, step: 1, points: [-2, 4] }, controls: ["move", "reset"] },
        "function-plot": { model: "function_plot", params: { family: "quadratic", a: 1, b: 0, c: 0, xMin: -5, xMax: 5 }, controls: ["a", "b", "c", "reset"] },
        code: { model: "code_runner", params: { language: "javascript", code: "console.log([3, 1, 2].sort((a, b) => a - b));", instructions: "Change the numbers, then run the sort.", timeoutMs: 500 }, controls: ["edit", "run", "reset"] },
      } as Record<string, unknown>)[model] ?? { model: "flashcards", params: { cards: [{ front: "P(A | B)", back: "A given B" }] }, controls: ["flip"] })];
  const phase = (opener.at(-1)?.phase ?? "check") as TutorPhase;
  const makeSession = (): PublicTutorSession => ({
    sessionId: "preview-tutor", topicId: "topic-2", goal: "Bayes' theorem", mode: "topic", topicIds: ["topic-2"], examId: "exam-st370", phase,
    initialLevels: { "topic-2": 1 }, status: id === "tutor-paused" ? "paused" : "active", startedAt: now(), updatedAt: now(), finishedAt: null,
    budgetSeconds: 900, elapsedSeconds: 480, activeSince: id === "tutor-paused" ? null : now(), initialLevel: 1,
    blocks: opener, messages: [], result: null, error: null,
  });
  let tutor = makeSession();
  if (id === "tutor-finished") tutor = { ...tutor, status: "completed", phase: "wrap", activeSince: null, finishedAt: now(), blocks: checkDone,
    result: { summary: "You tied the result to the base rate, and caught yourself before saying 90%.", previousLevel: 1, level: 2, evidence: [],
      missing: ["Setting up the 2 by 2 table without the picture."], next: "A five minute recap on Thursday.", assessments: [] } };
  if (id === "tutor-quiz") {
    const q = (sequence: number, topicId: string, correct: boolean) => block(sequence, "independent", "tutor_ask_typed", { topicId, question: `Question ${sequence + 1}`, hints: [], hasMoreHints: false },
      { answer: { kind: "typed", answer: "answer" }, correct, hintsUsed: 0, seconds: 30 });
    const plan: [string, boolean][] = [["topic-1", true], ["topic-1", true], ["topic-1", true], ["topic-2", true], ["topic-2", false], ["topic-2", false], ["topic-3", true], ["topic-3", true], ["topic-0", true], ["topic-0", false]];
    tutor = { ...tutor, mode: "mock_exam", goal: "Check what I know across this exam", topicIds: ["topic-0", "topic-1", "topic-2", "topic-3"], status: "completed", phase: "wrap",
      activeSince: null, finishedAt: now(), blocks: plan.map(([topicId, correct], index) => q(index, topicId, correct)),
      result: { summary: "Conditional probability is solid. Bayes is where the points are.", previousLevel: 1, level: 1, evidence: [], missing: [], next: "Study Bayes' theorem.", assessments: [] } };
  }
  const tutoring = id.startsWith("tutor-");

  const read = () => {
    const { sessionId, topicId, mode, goal, status, updatedAt, startedAt, finishedAt } = tutor;
    const sessions = tutoring ? [{ sessionId, topicId, mode, goal, status, updatedAt, startedAt, finishedAt, result: null }, ...history] : history;
    const visible = exams.filter(item => !item.hidden), shown = topics.filter(item => !item.hidden);
    const lead = selected && visible.some(item => item.examId === selected) ? selected : orderGoals(visible, today)[0]?.examId;
    const state: LearnState = { sources, exams: visible, topics: shown, sessions,
      mastery: mastery.map(({ evidence, ...record }) => ({ ...record, evidenceCount: evidence.length })),
      plan: planLearn({ exams: visible, topics: shown, mastery, sessions, today, ...(lead ? { selectedExamId: lead } : {}) }) };
    return structuredClone(state);
  };
  let memories: NoteDocument[] = [{
    frontmatter: { schemaVersion: 1, noteId: "preview-preference", scope: "student", subjectId: "preview", about: "preference", key: "citations", title: "Use APA citations", revision: 1, updatedAt: now() },
    content: "Use APA citations for my written assignments.",
  }];
  const getMemory = (noteId: string) => {
    const note = memories.find(item => item.frontmatter.noteId === noteId);
    if (!note) throw new Error("Memory no longer exists.");
    return note;
  };
  const session = () => structuredClone(tutor);
  const setStatus = (status: PublicTutorSession["status"]) => { tutor = { ...tutor, status, updatedAt: now(), activeSince: status === "active" ? now() : null }; return session(); };
  const editBlocks = (edit: (item: PublicTutorBlock) => PublicTutorBlock) => { tutor = { ...tutor, updatedAt: now(), blocks: tutor.blocks.map(edit) }; return session(); };
  return {
    getLearnState: async input => { if (input) selected = input.selectedExamId ?? undefined; return read(); },
    importLearnSource: async input => { sources = [...sources, { ...source(crypto.randomUUID(), input.courseId, input.title), kind: "paste", examId: input.examId ?? null }]; return read(); },
    importLearnFile: async () => { throw new Error("Choosing a file works in the desktop app. Paste the text here to try the preview."); },
    findLearnSyllabus: async () => { throw new Error("Looking through your classes works in the desktop app."); },
    retryLearnSource: async ({ sourceId }) => { sources = sources.map(item => item.sourceId === sourceId ? { ...item, status: "ready", error: null, extractedAt: now() } : item); return read(); },
    setLearnExam: async input => {
      const old = exams.find(item => item.examId === input.examId);
      const next: Exam = { ...exam(input.examId ?? crypto.randomUUID(), input.courseId, input.title, input.date, old?.kind ?? input.kind ?? "exam"), scopeNote: input.scopeNote ?? old?.scopeNote ?? null, dateOrigin: "student" };
      exams = [...exams.filter(item => item.examId !== next.examId), next];
      if (!old && next.kind === "topic") topics = [...topics, topic(crypto.randomUUID(), next.examId, null, next.title, 0, null)];
      selected = next.examId;
      return read();
    },
    removeLearnGoal: async ({ examId }) => { exams = exams.map(item => item.examId === examId ? { ...item, hidden: true } : item); if (selected === examId) selected = undefined; return read(); },
    addLearnTopic: async ({ examId, title }) => { topics = [...topics, topic(crypto.randomUUID(), examId, exams.find(item => item.examId === examId)?.courseId ?? null, title, topics.length, null)]; return read(); },
    removeLearnTopic: async ({ topicId }) => { topics = topics.map(item => item.topicId === topicId ? { ...item, hidden: true } : item); return read(); },
    getTutorSession: async () => session(),
    startTutorSession: async input => {
      const first = say(0, input.mode === "topic" || !input.mode ? "check" : "independent", "Quick check first. Go with your gut.");
      tutor = { ...makeSession(), sessionId: crypto.randomUUID(), topicId: input.topicId ?? "topic-2", examId: input.examId ?? "exam-st370",
        goal: input.topic ?? topics.find(item => item.topicId === input.topicId)?.title ?? "Check what I know across this exam", mode: input.mode ?? "topic",
        phase: first.phase, budgetSeconds: (input.minutes ?? 15) * 60, elapsedSeconds: 0,
        blocks: [first, block(1, first.phase, "tutor_ask_choice", { question: "P(A | B) means the chance of A…", options: ["when B already happened", "and B both happen", "or B, either one"] })] };
      return session();
    },
    answerTutorBlock: async ({ blockId, answer }) => {
      editBlocks(item => item.blockId === blockId ? { ...item, status: "answered", answeredAt: now(), result: { answer, correct: answer.kind === "choice" ? answer.picked === 0 : null, hintsUsed: item.hintsUsed, seconds: 10 } } : item);
      const sequence = tutor.blocks.length;
      tutor.blocks.push(say(sequence, "practice", "Good. One more, and this time type it."),
        block(sequence + 1, "practice", "tutor_ask_typed", { question: "What does the base rate tell us?", hints: [], hasMoreHints: true }));
      tutor.phase = "practice";
      return session();
    },
    hintTutorBlock: async ({ blockId }) => editBlocks(item => item.blockId === blockId && item.tool === "tutor_ask_typed"
      ? { ...item, hintsUsed: item.hintsUsed + 1, args: { ...item.args, hints: [...item.args.hints, "Start by counting how many people are in each group."], hasMoreHints: item.hintsUsed < 2 } } : item),
    saveTutorDraft: async ({ blockId, draft }) => editBlocks(item => item.blockId === blockId ? { ...item, draft } : item),
    sendTutorMessage: async ({ text, messageId }) => { tutor = { ...tutor, updatedAt: now(), messages: [...tutor.messages, { messageId: messageId ?? crypto.randomUUID(), text, createdAt: now(), delivered: true }] }; return session(); },
    pauseTutorSession: async () => setStatus("paused"),
    resumeTutorSession: async () => setStatus("active"),
    cancelTutorSession: async () => setStatus("cancelled"),
    listMemories: async () => structuredClone(memories.map(note => note.frontmatter)),
    readMemory: async ({ noteId }) => structuredClone(memories.find(note => note.frontmatter.noteId === noteId) ?? null),
    updateMemory: async ({ noteId, expectedRevision, title, content }) => {
      const note = getMemory(noteId);
      if (note.frontmatter.revision !== expectedRevision) throw new Error("Memory changed. Reload the latest version.");
      note.frontmatter = { ...note.frontmatter, title, revision: expectedRevision + 1, updatedAt: now() };
      note.content = content;
      return structuredClone(note);
    },
    deleteMemory: async ({ noteId, expectedRevision }) => {
      const note = getMemory(noteId);
      if (note.frontmatter.revision !== expectedRevision) throw new Error("Memory changed. Reload the latest version.");
      memories = memories.filter(item => item.frontmatter.noteId !== noteId);
      return { noteId, deleted: true as const };
    },
  } satisfies Pick<StudiRendererApi, "getLearnState" | "importLearnSource" | "importLearnFile" | "findLearnSyllabus" | "retryLearnSource" | "setLearnExam"
    | "removeLearnGoal" | "addLearnTopic" | "removeLearnTopic" | "getTutorSession" | "startTutorSession" | "answerTutorBlock" | "hintTutorBlock" | "saveTutorDraft"
    | "sendTutorMessage" | "pauseTutorSession" | "resumeTutorSession" | "cancelTutorSession" | "listMemories" | "readMemory" | "updateMemory" | "deleteMemory">;
}
