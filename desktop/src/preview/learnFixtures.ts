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
  const calculus = ["pick", "question", "asked", "wrong", "right", "steps", "marked", "wrap"].includes(id.slice("tutor-".length));
  let exams: Exam[] = empty ? [] : [
    ...(calculus ? [exam("exam-ma141", "course-ma241", "Midterm 2", day(9))] : []),
    exam("exam-st370", "course-st370", "Midterm 1", day(6)),
    exam("exam-csc316", "course-csc316", "Midterm", day(12)),
    exam("exam-ma241", "course-ma241", "Final", null),
    exam("goal-python", null, "Python basics", null, "topic"),
    exam("goal-mortgages", null, "How mortgages work", null, "topic"),
  ];
  let topics: LearnTopic[] = empty ? [] : [
    ...(calculus ? ["Limits", "What a derivative is", "Power rule"].map((title, index) => topic(`calc-${index}`, "exam-ma141", "course-ma241", title, index, null)) : []),
    ...[["Counting and sets", 15], ["Conditional probability", 25], ["Bayes' theorem", 30], ["Random variables", 20], ["Distributions", 10]]
      .map(([title, weight], index) => topic(`topic-${index}`, "exam-st370", "course-st370", String(title), index, Number(weight))),
    ...["Heaps and priority queues", "Sorting", "Hash tables", "Graphs"].map((title, index) => topic(`csc-${index}`, "exam-csc316", "course-csc316", title, index, null)),
    ...["Variables and types", "Conditionals", "Loops", "Functions", "Files"].map((title, index) => topic(`py-${index}`, "goal-python", null, title, index, null)),
    topic("mortgages-0", "goal-mortgages", null, "How mortgages work", 0, null),
  ];
  let sources: LearnState["sources"] = id === "learn-reading" ? [source("source-new", null, "ST 370 syllabus.pdf", "reading")] : empty ? [] : [
    source("source-st370", "course-st370", "ST 370 syllabus.pdf"), source("source-review", "course-st370", "Midterm 1 review sheet.pdf"),
    source("source-quiz", "course-st370", "Quiz 2, graded 7/10"), source("source-slides", "course-st370", "Lecture 7, Bayes.pdf"),
    source("source-csc316", "course-csc316", "CSC 316 syllabus.pdf"),
    ...(id === "learn-error" ? [source("source-bad", "course-ma241", "MA 241 scan.pdf", "failed", "It's a photo with no readable text. Paste the exam topics instead.")] : []),
  ];
  const levels: Record<string, number> = id === "learn-recap" ? { "topic-0": 4, "topic-1": 3, "topic-2": 3, "topic-3": 3, "topic-4": 3 } : id === "learn-partial" ? { "topic-0": 4, "topic-1": 3 }
    : { "topic-0": 4, "topic-1": 3, "topic-2": 1, "topic-3": 2, "csc-1": 2, "csc-2": 1, "py-0": 3, "py-1": 2, "py-2": 1, ...(calculus ? { "calc-0": 4 } : {}) };
  const mastery = empty ? [] : Object.entries(levels).map(([topicId, level], index) => ({
    topicId, level, updatedAt: now(), review: { dueOn: day(id === "learn-recap" ? -1 : { "topic-0": 0, "topic-1": 1 }[topicId] ?? 2), gapDays: 2, lastRightOn: day({ "topic-0": -5, "topic-1": -2, "calc-0": -4 }[topicId] ?? -3) },
    evidence: [{ sessionId: "previous", blockId: `evidence-${index}`, kind: "typed" as const, correct: true, answer: "Simulated answer", rationale: "Simulated session evidence", hintsUsed: 0, recordedAt: now() }],
  }));
  const past = (sessionId: string, topicId: string, daysAgo: number) => ({ sessionId, topicId, mode: "topic" as const, goal: "Practice", status: "completed" as const,
    startedAt: new Date(Date.now() - daysAgo * DAY).toISOString(), updatedAt: new Date(Date.now() - daysAgo * DAY).toISOString(), finishedAt: new Date(Date.now() - daysAgo * DAY).toISOString(), result: null });
  const history = empty ? [] : [past("py-a", "py-0", 9), past("py-b", "py-1", 6), past("py-c", "py-2", 4), past("st-a", "topic-1", id === "learn-recap" ? 3 : 1)];
  let selected: string | undefined = { "learn-no-topics": "exam-ma241", "learn-topic-goal": "goal-python" }[id];

  type Result = NonNullable<PublicTutorBlock["result"]>;
  const started = Date.now() - 600_000, stamp = (seconds: number) => new Date(started + seconds * 1000).toISOString();
  const block = (sequence: number, phase: TutorPhase, tool: PublicTutorBlock["tool"], args: unknown, result: Result | null = null, extra: object = {}): PublicTutorBlock =>
    ({ blockId: `block-${sequence}`, toolCallId: `call-${sequence}`, sequence, status: result ? "answered" : tool === "tutor_say" || tool === "tutor_reply" ? "complete" : "open",
      createdAt: stamp(sequence * 10), answeredAt: result ? stamp(sequence * 10 + 5) : null, firstAnsweredAt: result ? stamp(sequence * 10 + 5) : null, erasedAt: null, updatedAt: null, explored: [], attempts: result && tool.startsWith("tutor_ask") ? [result] : [],
      elapsedAtCreation: 0, phase, hintsUsed: 0, draft: "", result, tool, args, ...extra }) as PublicTutorBlock;
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
      { answer: { kind: "model", explored: ["1%", "10%"] }, correct: null, hintsUsed: 0, seconds: 40 }, { erasedAt: now() }),
  ];
  const model = id.slice("tutor-".length);

  // One lesson on derivatives, stopped at the moments docs/redesign/learn-v2/lesson.html shows.
  const moment = calculus ? ["pick", "question", "asked", "wrong", "right", "steps", "marked", "wrap"].indexOf(model) : -1;
  const GAP_QUESTION = "Make the gap smaller. What number is the slope heading toward?";
  /** The answers the preview marks against. The real lesson never sends these to the screen. */
  const KEYS: Record<string, string | number> = { "As x gets close to 2, what does (x² − 4) / (x − 2) get close to?": 1, [GAP_QUESTION]: "6", "Same thing at t = 5. Let h shrink to nothing: what's left?": "10" };
  const lesson = () => {
    const blocks: PublicTutorBlock[] = [];
    const add = (phase: TutorPhase, tool: PublicTutorBlock["tool"], args: unknown, result: Result | null = null, extra: object = {}) => { blocks.push(block(blocks.length, phase, tool, args, result, extra)); return blocks.at(-1)!; };
    const typed = (answer: string, correct: boolean): Result => ({ answer: { kind: "typed", answer }, correct, matched: correct, hintsUsed: 0, seconds: 20 });
    const tried = (result: Result, seconds: number) => ({ ...result, answeredAt: stamp(seconds) });
    const up = { status: "complete", erasedAt: moment >= 5 ? now() : null };
    add("check", "tutor_ask_choice", { topicId: "calc-0", question: "As x gets close to 2, what does (x² − 4) / (x − 2) get close to?", options: ["0", "4", "It doesn't exist"] },
      moment > 0 ? { answer: { kind: "choice", picked: 1 }, correct: true, hintsUsed: 0, seconds: 9 } : null);
    if (moment < 1) return { blocks, newest: null as string | null };
    const plot = add("learn", "tutor_show_model", { model: "function_plot", wait: false, controls: ["gap"], params: { family: "quadratic", a: 1, b: 0, c: 0, xMin: 0, xMax: 5.4,
      secant: { x: 3, gap: moment >= 4 ? 0.01 : moment === 3 ? 0.1 : 1 }, ...(moment === 2 ? { labels: [{ x: 3.5, text: "the gap" }] } : {}) } }, null, up);
    const tries = moment === 3 ? [tried(typed("7", false), 25)] : moment >= 4 ? [tried(typed("7", false), 25), tried(typed("6", true), 55)] : [];
    add("learn", "tutor_ask_typed", { question: GAP_QUESTION, note: "The line's slope is the car's average speed between the two dots.", hints: [], hasMoreHints: true },
      moment >= 4 ? typed("6", true) : null, { attempts: tries, firstAnsweredAt: moment >= 3 ? stamp(25) : null, ...(moment === 3 ? { result: typed("7", false) } : moment >= 4 ? { answeredAt: stamp(55) } : {}) });
    if (moment >= 2) add("learn", "tutor_reply", { text: "The time between the two dots. I've marked it on the graph. Move the gap slider toward 0 to make it smaller." }, null, { replyTo: "message-gap" });
    if (moment < 3) return { blocks, newest: moment === 2 ? plot.blockId : null };
    const table = add("learn", "tutor_show_model", { model: "table", wait: false, under: plot.blockId, controls: [], params: moment >= 4
      ? { columns: ["gap (s)", "1", "0.5", "0.1", "0.01", "→ 0"], rows: [["slope", 7, 6.5, 6.1, 6.01, 6]] } : { columns: ["gap (s)", "1", "0.5", "0.1", "0.01"], rows: [["slope", 7, 6.5, 6.1, 6.01]] } }, null, up);
    add("learn", "tutor_say", { text: "Not yet. 7 is the slope when the gap is a whole second. Look at the row I just added: where is it heading?" });
    if (moment < 4) return { blocks, newest: table.blockId };
    add("learn", "tutor_say", { text: "That's it. The car's speed at t = 3 is 6 m/s. That number has a name: the derivative at 3." });
    if (moment < 5) return { blocks, newest: table.blockId };
    add("practice", "tutor_ask_typed", { question: "Same thing at t = 5. Let h shrink to nothing: what's left?", hints: [], hasMoreHints: true,
      steps: ["slope from 5 to 5 + h: ((5 + h)² − 25) / h", "multiply out: (10h + h²) / h", "divide by h: 10 + h"] }, moment >= 6 ? typed("10", true) : null);
    add("practice", "tutor_reply", { text: "We divide while h is still a tiny real number. Only after the h's cancel do we let it shrink." }, null, { replyTo: "message-h" });
    if (moment < 6) return { blocks, newest: null };
    add("independent", "tutor_ask_explain", { prompt: "What does f′(3) = 6 tell you about the curve at x = 3?", points: [{ text: "Says it's the steepness at that one point", met: true },
      { text: "Turns the 6 into “up 6 for each 1 across”", met: true }, { text: "Says it's what nearby slopes close in on", met: false }] },
      { answer: { kind: "explain", text: "It's how steep the curve is right at 3. If you zoomed in it would look like a line going up 6 for every 1 across." }, correct: true, met: [true, true, false], hintsUsed: 0, seconds: 50 });
    add("independent", "tutor_say", { text: "Lovely. Zooming in is exactly the right picture." });
    return { blocks, newest: null };
  };
  const opener: PublicTutorBlock[] =
    moment >= 0 ? lesson().blocks
    : model === "choice" ? [say(0, "check", "Quick check first. Go with your gut."),
      block(1, "check", "tutor_ask_choice", { question: "P(A | B) means the chance of A…", options: ["when B already happened", "and B both happen", "or B, either one"] })]
    : model === "typed" ? [...checkDone, say(6, "practice", "Your turn. No picture this time, but I'm here if you get stuck."),
      block(7, "practice", "tutor_ask_typed", { question: "Now 1 in 10 people has the disease. Same test. You test positive. How likely is it that you're sick?", hints: [], hasMoreHints: true, source: "Matches the format of problem 3 on the Midterm 1 review sheet." })]
    : model === "page" ? [...checkDone.slice(0, 2), say(2, "learn", "Before I explain insertion sort, predict: how many shifts does 5 need to reach its spot?"),
      block(3, "learn", "tutor_show_page", { title: "Insertion sort, one step at a time", purpose: "See how many shifts each insert needs",
        html: `<p style="margin:0 0 10px">Press <b>Step</b> and watch the highlighted card slide left.</p><div id="row" style="display:flex;gap:8px;font:600 20px monospace"></div><p id="note" style="color:#6b6359">Shifts so far: 0</p><button id="step">Step</button> <button id="reset">Reset</button><script>const start=[2,6,9,5,1];let a=[...start],i=1,j=1,shifts=0;const row=document.getElementById("row"),note=document.getElementById("note");function draw(){row.innerHTML=a.map((v,k)=>'<span style="padding:8px 12px;border-radius:8px;border:1.5px solid #2b2621;background:'+(k===j?'#cdbcf0':'#fff')+'">'+v+'</span>').join("");note.textContent="Shifts so far: "+shifts}document.getElementById("step").onclick=()=>{if(i>=a.length)return;if(j>0&&a[j-1]>a[j]){[a[j-1],a[j]]=[a[j],a[j-1]];j--;shifts++}else{i++;j=i}draw();studi.explore("step "+shifts)};document.getElementById("reset").onclick=()=>{a=[...start];i=1;j=1;shifts=0;draw();studi.explore("reset")};draw();</script>` })]
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
  const said = (messageId: string, text: string) => ({ messageId, text, createdAt: now() });
  const makeSession = (): PublicTutorSession => ({
    sessionId: "preview-tutor", topicId: moment >= 0 ? "calc-1" : "topic-2", goal: moment >= 0 ? "What a derivative is" : "Bayes' theorem", mode: "topic", topicIds: moment >= 0 ? ["calc-1", "calc-0"] : ["topic-2"],
    examId: moment >= 0 ? "exam-ma141" : "exam-st370", phase, initialLevels: { "topic-2": 1 }, status: id === "tutor-paused" ? "paused" : "active", startedAt: now(), updatedAt: now(), finishedAt: null,
    budgetSeconds: 900, elapsedSeconds: moment >= 0 ? [0, 240, 300, 360, 420, 540, 720, 900][moment]! : 480, activeSince: id === "tutor-paused" ? null : now(), wrapStartedAt: null, initialLevel: 1,
    blocks: opener, messages: [...(moment >= 2 ? [said("message-gap", "what do you mean by the gap?")] : []), ...(moment >= 5 ? [said("message-h", "isn't dividing by h cheating if h ends up 0?")] : [])],
    newestBlockId: moment >= 0 ? lesson().newest : null, result: null, error: null,
  });
  let tutor = makeSession();
  if (id === "tutor-finished") tutor = { ...tutor, status: "completed", phase: "wrap", activeSince: null, finishedAt: now(), blocks: checkDone,
    result: { summary: "You tied the result to the base rate, and caught yourself before saying 90%.", previousLevel: 1, level: 2, evidence: [],
      missing: ["Setting up the 2 by 2 table without the picture."], next: "A five minute recap on Thursday.", assessments: [{ topicId: "topic-2", previousLevel: 1, level: 2, dueOn: day(1) }], clicked: [], cheatsheet: [] } };
  if (id === "tutor-wrap") tutor = { ...tutor, status: "completed", phase: "wrap", activeSince: null, finishedAt: now(),
    result: { summary: "You found the slope at a point by shrinking the gap, then did it with algebra.", previousLevel: 1, level: 3, evidence: [], missing: ["Doing the algebra with no steps given"], next: "Power rule.",
      assessments: [{ topicId: "calc-1", previousLevel: 1, level: 3, dueOn: day(2) }, { topicId: "calc-0", previousLevel: 4, level: 4, dueOn: day(7) }],
      clicked: [{ before: "Speed at t = 3 is just 9, the distance.", after: "Speed is the slope the nearby slopes close in on: 6." }],
      cheatsheet: ["f′(a) is what (f(a + h) − f(a)) / h heads to as h shrinks", "If f(x) = x², then f′(x) = 2x"] } };
  if (id === "tutor-quiz") {
    const MISSED: Record<number, [string, string, string]> = {
      4: ["1 in 100 people have a disease and the test is 90% accurate. You test positive: about how likely is it you have it?", "90%", "about 8%"],
      5: ["Which is P(B | A) written with Bayes' theorem?", "P(A | B) P(B)", "P(A | B) P(B) / P(A)"],
      9: ["How many ways can you choose 2 of 5 people?", "20", "10"],
    };
    const q = (sequence: number, topicId: string, correct: boolean) => block(sequence, "independent", "tutor_ask_typed",
      { topicId, question: MISSED[sequence]?.[0] ?? `Question ${sequence + 1}`, hints: [], hasMoreHints: false, ...(MISSED[sequence] ? { key: MISSED[sequence]![2] } : {}) },
      { answer: { kind: "typed", answer: MISSED[sequence]?.[1] ?? "answer" }, correct, hintsUsed: 0, seconds: 30 });
    const plan: [string, boolean][] = [["topic-1", true], ["topic-1", true], ["topic-1", true], ["topic-2", true], ["topic-2", false], ["topic-2", false], ["topic-3", true], ["topic-3", true], ["topic-0", true], ["topic-0", false]];
    tutor = { ...tutor, mode: "mock_exam", goal: "Check what I know across this exam", topicIds: ["topic-0", "topic-1", "topic-2", "topic-3"], status: "completed", phase: "wrap",
      activeSince: null, finishedAt: now(), blocks: plan.map(([topicId, correct], index) => q(index, topicId, correct)),
      result: { summary: "Conditional probability is solid. Bayes is where the points are.", previousLevel: 1, level: 1, evidence: [], missing: [], next: "Study Bayes' theorem.", assessments: [], clicked: [], cheatsheet: [] } };
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
    getLearnState: async input => { if (input?.selectedExamId) selected = input.selectedExamId; return read(); },
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
      const asked = tutor.blocks.find(item => item.blockId === blockId)!, key = "question" in asked.args ? KEYS[asked.args.question] : undefined;
      const correct = answer.kind === "unsure" ? false : answer.kind === "choice" ? answer.picked === (key ?? 0) : answer.kind === "typed" && key !== undefined ? answer.answer.trim() === key : null;
      const result = { answer, correct, ...(answer.kind === "typed" ? { matched: correct === true } : {}), hintsUsed: asked.hintsUsed, seconds: 10 };
      const again = correct === false && asked.attempts.length < 2;
      editBlocks(item => item.blockId === blockId ? { ...item, status: again ? "open" : "answered", answeredAt: again ? null : now(), firstAnsweredAt: item.firstAnsweredAt ?? now(), draft: "", result,
        attempts: item.tool.startsWith("tutor_ask") ? [...item.attempts, { ...result, answeredAt: now() }] : item.attempts } as PublicTutorBlock : item);
      const sequence = tutor.blocks.length, note = (text: string) => ({ ...say(sequence, asked.phase, text), createdAt: now() });
      if (again) tutor.blocks.push(note("Not yet. Look again at what changes, then try once more."));
      else tutor.blocks.push(note(correct === false ? "Not quite. Let's come at it another way." : "Good. One more, and this time type it."),
        { ...block(sequence + 1, "practice", "tutor_ask_typed", { question: "What does the base rate tell us?", hints: [], hasMoreHints: true }), createdAt: now() });
      if (!again) tutor.phase = "practice";
      return session();
    },
    hintTutorBlock: async ({ blockId }) => editBlocks(item => item.blockId === blockId && item.tool === "tutor_ask_typed"
      ? { ...item, hintsUsed: item.hintsUsed + 1, args: { ...item.args, hints: [...item.args.hints, "Start by counting how many people are in each group."], hasMoreHints: item.hintsUsed < 2 } } : item),
    saveTutorDraft: async ({ blockId, draft }) => editBlocks(item => item.blockId === blockId ? { ...item, draft } : item),
    sendTutorMessage: async ({ text, messageId }) => {
      const message = said(messageId ?? crypto.randomUUID(), text);
      tutor = { ...tutor, updatedAt: now(), messages: [...tutor.messages, message],
        blocks: [...tutor.blocks, { ...block(tutor.blocks.length, tutor.phase, "tutor_reply", { text: "Good question. Look at the picture again and tell me what you see." }, null, { replyTo: message.messageId }), createdAt: now() }] };
      return session();
    },
    pauseTutorSession: async () => setStatus("paused"),
    resumeTutorSession: async () => setStatus("active"),
    cancelTutorSession: async () => setStatus("cancelled"),
    listMemories: async () => structuredClone(memories.map(note => note.frontmatter)),
    readMemory: async ({ noteId }) => structuredClone(memories.find(note => note.frontmatter.noteId === noteId) ?? null),
    createMemory: async ({ title, content }) => {
      const note: NoteDocument = { frontmatter: { schemaVersion: 1, scope: "student", subjectId: "preview", about: "preference",
        noteId: crypto.randomUUID(), key: crypto.randomUUID(), title, revision: 1, updatedAt: now() }, content };
      memories.push(note); return structuredClone(note);
    },
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
    getLearnNotes: async ({ examId }) => examId === "exam-st370" ? {
      cheatsheet: ["Probabilities range from 0 to 1", "All outcomes together have probability 1", "P(not A) = 1 - P(A)", "Disjoint events cannot happen together", "Independent events multiply", "P(A given B) = P(A and B) / P(B)", "Bayes' theorem connects conditional probabilities"],
      pages: [{ name: "2026-10-01 Bayes.html", title: "Bayes", date: "2026-10-01" }, { name: "2026-09-30 Conditional probability.html", title: "Conditional probability", date: "2026-09-30" }, { name: "2026-09-29 Independence.html", title: "Independence", date: "2026-09-29" }],
    } : { cheatsheet: [], pages: [] },
    readLearnPage: async ({ examId, name }) => {
      const titles: Record<string, string> = { "2026-10-01 Bayes.html": "Bayes", "2026-09-30 Conditional probability.html": "Conditional probability", "2026-09-29 Independence.html": "Independence" };
      if (examId !== "exam-st370" || !Object.hasOwn(titles, name)) throw new Error("Study page not found for this goal");
      return `<article><h1>${titles[name]}</h1><p>Count the outcomes you want, then divide by all possible outcomes.</p></article>`;
    },
  } satisfies Pick<StudiRendererApi, "getLearnNotes" | "readLearnPage" | "getLearnState" | "importLearnSource" | "importLearnFile" | "findLearnSyllabus" | "retryLearnSource" | "setLearnExam"
    | "removeLearnGoal" | "addLearnTopic" | "removeLearnTopic" | "getTutorSession" | "startTutorSession" | "answerTutorBlock" | "hintTutorBlock" | "saveTutorDraft"
    | "sendTutorMessage" | "pauseTutorSession" | "resumeTutorSession" | "cancelTutorSession" | "listMemories" | "readMemory" | "createMemory" | "updateMemory" | "deleteMemory">;
}
