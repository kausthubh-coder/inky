import type {
  AgentJob,
  Assignment,
  ConversationTarget,
  Course,
  EngineTopic,
  LifecycleState,
  StudiRendererApi,
  TaskDetail,
} from "../../../shared/index.js";
import { planLearn, type Exam, type LearnTopic } from "../../../shared/learn.js";
import type { PublicTutorBlock, PublicTutorSession } from "../../../shared/tutor.js";

// The tour's practice class. It lives only here, laid over the real engine while the tour runs:
// nothing is saved, nothing reaches school, and every other call goes to the real API.
export const PRACTICE = {
  course: "practice-studi-101",
  assignment: "practice-assignment",
  task: "practice-task",
  exam: "practice-exam",
  topic: "practice-topic",
  session: "practice-session",
  title: "Practice: sort five numbers",
  quiz: "Practice quiz",
} as const;

export type PracticeStage = "ready" | "working" | "review" | "submitted";
export type PracticeApi = StudiRendererApi & { practiceStage: () => PracticeStage };

const WORK_SECONDS = 6;
const SOURCE = "https://studi.local/practice";

export function practiceApi(real: StudiRendererApi): PracticeApi {
  const started = new Date().toISOString();
  let stage: PracticeStage = "ready";
  let stageAt = started;
  let session: PublicTutorSession | null = null;
  let thread: AgentJob["messages"] = [];
  let timer = 0;
  const listeners = new Set<(topics: readonly EngineTopic[]) => void>();
  const changed = (topics: readonly EngineTopic[] = ["homework", "school"]) => { for (const listener of listeners) listener(topics); };
  const move = (next: PracticeStage) => {
    stage = next; stageAt = new Date().toISOString();
    window.clearTimeout(timer);
    if (next === "working") timer = window.setTimeout(() => move("review"), WORK_SECONDS * 1000);
    changed();
  };

  const evidence = { schemaVersion: 1 as const, evidenceId: "practice-evidence", reference: "practice-evidence", kind: "text_snapshot" as const, sourceTarget: SOURCE, capturedAt: started, summary: "The practice page." };
  const course: Course = { schemaVersion: 1, courseId: PRACTICE.course, label: "Studi 101 Practice", sourceTarget: SOURCE, lastVerifiedScanId: "practice", lastVerifiedAt: started, evidence };
  const due = new Date(); due.setHours(23, 59, 0, 0);
  const assignment = (): Assignment => ({
    schemaVersion: 1, assignmentId: PRACTICE.assignment, courseId: PRACTICE.course, title: PRACTICE.title, sourceTarget: SOURCE,
    dueAt: due.toISOString(), deadlinePrecision: "datetime", deadlineEvidence: evidence,
    schoolStatus: stage === "submitted" ? { state: "submitted", text: "Submitted", evidence } : { state: "not_submitted", text: "Not submitted", evidence },
    requirementEvidence: [{ text: "Put 5, 2, 9, 1, 7 in order, smallest first.", evidence }, { text: "Say which way of sorting you used.", evidence }],
    requirementsState: "complete", discoveredAt: started, lastVerifiedScanId: "practice", evidence: [evidence],
    instructions: "Put these five numbers in order, smallest first: 5, 2, 9, 1, 7. Then say which way of sorting you used.",
  });
  const checkpoint = (summary: string) => ({ revision: 2, url: SOURCE, title: PRACTICE.title, capturedAt: stageAt, summary });
  const execution = (): TaskDetail["execution"] => stage === "ready" ? null : {
    schemaVersion: 1, taskId: PRACTICE.task, assignmentId: PRACTICE.assignment, phase: stage === "review" ? "ready_review" : stage,
    taskBudget: { maxAgentTurns: 24, maxRecoveryAttempts: 2 }, turnCount: 3, attemptCount: 1, updatedAt: stageAt,
    ...(stage === "working" ? { actions: [
      { actionId: "practice-open", occurredAt: stageAt, kind: "tool" as const, label: "Opened the practice homework", outcome: "succeeded" as const },
      { actionId: "practice-read", occurredAt: stageAt, kind: "tool" as const, label: "Read the instructions", outcome: "succeeded" as const },
      { actionId: "practice-sort", occurredAt: stageAt, kind: "tool" as const, label: "Sorting the numbers", outcome: "started" as const },
    ] } : {}),
    ...(stage === "review" ? {
      reviewCheckpoint: checkpoint("The answer is typed on the practice page."),
      answerSnapshot: "1, 2, 5, 7, 9, sorted by insertion sort.",
      doubts: [{ where: "Part 2", why: "It didn't say which sort to use. I used insertion sort and said so." }],
      completionChecklist: [
        { requirement: "Numbers in order", evidence: "1, 2, 5, 7, 9 is typed in the answer box." },
        { requirement: "Name the sort", evidence: "The answer says it used insertion sort." },
      ],
    } : {}),
    ...(stage === "submitted" ? { submissionReceiptId: "practice-receipt" } : {}),
  };
  const permission = { mode: "attempt" as const, mayAttempt: true, maySubmit: false, matchedRuleId: null, rationale: "Practice homework. Nothing is sent anywhere." };
  const detail = (): TaskDetail => ({
    task: { schemaVersion: 1, taskId: PRACTICE.task, assignmentId: PRACTICE.assignment, state: stage === "ready" ? "discovered" : stage === "review" ? "ready_review" : stage, revision: 1, createdAt: started, updatedAt: stageAt },
    assignment: assignment(), execution: execution(), permission, events: [], runs: [], attempts: [], activity: [],
    submissionReceipt: stage === "submitted" ? { schemaVersion: 1, receiptId: "practice-receipt", taskId: PRACTICE.task, preSubmit: checkpoint("The answer is on the page."), postSubmit: { ...checkpoint("The practice page shows Submitted."), revision: 3 }, verifiedStatus: "Submitted", submittedAt: stageAt } : null,
  });
  const lifecycle = (state: LifecycleState): LifecycleState => {
    const run = execution();
    if (!run) return state;
    const receipt = detail().submissionReceipt;
    return { ...state, execution: run, submissionReceipt: receipt ?? state.submissionReceipt,
      manager: stage === "working" ? { ...state.manager, lease: { schemaVersion: 1, leaseId: "browser-worker", taskId: PRACTICE.task, state: "active", acquiredAt: stageAt, workerSessionId: "practice", workerSessionPath: "practice" } } : state.manager };
  };
  const isPractice = (target: ConversationTarget | { kind: "school" }) => target.kind === "assignment" && target.assignmentId === PRACTICE.assignment;
  const job = (): AgentJob => ({ schemaVersion: 1, jobId: "practice-job", target: { kind: "assignment", assignmentId: PRACTICE.assignment }, phase: "idle", turnIndex: thread.length, runId: "practice-run", sessionId: null, claim: null, messages: thread, createdAt: started, updatedAt: stageAt });

  // Learn: one practice quiz with one topic, about Studi itself.
  const exam: Exam = { examId: PRACTICE.exam, courseId: PRACTICE.course, title: PRACTICE.quiz, date: new Date(Date.now() + 3 * 86_400_000).toLocaleDateString("en-CA"), sourceId: null, dateOrigin: "student", updatedAt: started, kind: "exam", scopeNote: null, hidden: false };
  const topic: LearnTopic = { topicId: PRACTICE.topic, examId: PRACTICE.exam, courseId: PRACTICE.course, title: "How Studi works", chapter: 0, weight: null, sourceId: null, origin: "student", updatedAt: started, hidden: false };
  const now = () => new Date().toISOString();
  const block = (sequence: number, tool: PublicTutorBlock["tool"], args: unknown, extra: Partial<PublicTutorBlock> = {}): PublicTutorBlock => ({
    blockId: `practice-block-${sequence}`, toolCallId: `practice-call-${sequence}`, sequence, status: tool === "tutor_say" ? "complete" : "open", createdAt: now(), answeredAt: null, firstAnsweredAt: null,
    erasedAt: null, updatedAt: null, explored: [], attempts: [], elapsedAtCreation: 0, phase: "check", hintsUsed: 0, draft: "", result: null, tool, args, ...extra }) as PublicTutorBlock;
  const startSession = (): PublicTutorSession => ({
    sessionId: PRACTICE.session, topicId: PRACTICE.topic, goal: "How Studi works", mode: "topic", topicIds: [PRACTICE.topic], examId: PRACTICE.exam, phase: "check",
    initialLevels: {}, status: "active", startedAt: now(), updatedAt: now(), finishedAt: null, budgetSeconds: 300, elapsedSeconds: 0, activeSince: now(), wrapStartedAt: null, initialLevel: 0,
    blocks: [block(0, "tutor_say", { text: "A practice question. Go with your gut." }), block(1, "tutor_ask_choice", { topicId: PRACTICE.topic, question: "Who presses Submit on your homework?", options: ["You do", "Dot does", "Chalky does"] })],
    messages: [], newestBlockId: null, result: null, error: null,
  });
  const edit = (change: (current: PublicTutorSession) => PublicTutorSession) => { session = change(session ?? startSession()); return structuredClone(session); };

  const api: PracticeApi = {
    ...real,
    practiceStage: () => stage,
    onEngineChanged: (listener) => { listeners.add(listener); const stop = real.onEngineChanged(listener); return () => { listeners.delete(listener); stop(); }; },
    // The live school page stays hidden; the practice page is drawn instead.
    setBrowserLayout: () => real.setBrowserLayout({ mode: "hidden" }),
    navigateBrowser: async (input) => input.url.startsWith(SOURCE) ? real.getWorkspaceState() : real.navigateBrowser(input),
    selectBrowserPage: async (input) => isPractice(input) ? real.getWorkspaceState() : real.selectBrowserPage(input),

    // While Dot does the practice homework, the page it shows is the practice page.
    getWorkspaceState: async () => { const state = await real.getWorkspaceState(); return stage === "ready" ? state : { ...state, browser: { ...state.browser, url: SOURCE, title: "Studi 101", driver: stage === "working" ? "inky" : "none" } }; },
    getSchoolOnboardingState: async () => { const state = await real.getSchoolOnboardingState(); return { ...state, courses: [...state.courses, course], assignments: [...state.assignments, assignment()] }; },
    getLibraryState: async () => {
      const state = await real.getLibraryState();
      const { events: _events, runs: _runs, attempts: _attempts, submissionReceipt: _receipt, activity: _activity, ...summary } = detail();
      return { ...state, tasks: [...state.tasks, summary] };
    },
    getLifecycleState: async () => lifecycle(await real.getLifecycleState()),
    getTaskDetail: async (input) => input.taskId === PRACTICE.task ? detail() : real.getTaskDetail(input),
    startAssignment: async (input) => { if (input.taskId !== PRACTICE.task) return real.startAssignment(input); move("working"); return lifecycle(await real.getLifecycleState()); },
    resumeAssignment: async (input) => { if (input.taskId !== PRACTICE.task) return real.resumeAssignment(input); move("working"); return lifecycle(await real.getLifecycleState()); },
    cancelAssignment: async (input) => { if (input.taskId !== PRACTICE.task) return real.cancelAssignment(input); move("ready"); return lifecycle(await real.getLifecycleState()); },
    requestAssignmentTakeover: async (input) => input.taskId === PRACTICE.task ? lifecycle(await real.getLifecycleState()) : real.requestAssignmentTakeover(input),
    submitReviewedAssignment: async (input) => { if (input.taskId !== PRACTICE.task) return real.submitReviewedAssignment(input); move("submitted"); return lifecycle(await real.getLifecycleState()); },
    watchHandIn: async (input) => { if (input.taskId !== PRACTICE.task) return real.watchHandIn(input); move("submitted"); return lifecycle(await real.getLifecycleState()); },
    verifyStudentSubmission: async (input) => { if (input.taskId !== PRACTICE.task) return real.verifyStudentSubmission(input); move("submitted"); return lifecycle(await real.getLifecycleState()); },
    queueAssignmentNext: async (input) => input.taskId === PRACTICE.task ? real.getManagerState() : real.queueAssignmentNext(input),
    openAnswerArtifact: async (input) => input.taskId === PRACTICE.task ? true : real.openAnswerArtifact(input),
    getAssignmentFiles: async (input) => input.assignmentId === PRACTICE.assignment ? stage === "review" || stage === "submitted" ? [{ path: "answer.md", kind: "file", size: 64, modifiedAt: stageAt }] : [] : real.getAssignmentFiles(input),
    readAssignmentFile: async (input) => input.assignmentId === PRACTICE.assignment ? { path: input.path, content: "1, 2, 5, 7, 9\n\nI used insertion sort: take each number and slide it left until it fits.", modifiedAt: stageAt } : real.readAssignmentFile(input),
    openAssignmentFolder: async (input) => input.assignmentId === PRACTICE.assignment ? false : real.openAssignmentFolder(input),
    openAssignmentFile: async (input) => input.assignmentId === PRACTICE.assignment ? false : real.openAssignmentFile(input),
    importAssignmentFiles: async (input) => input.assignmentId === PRACTICE.assignment ? { imported: [], errors: [{ name: "Practice", message: "The practice homework doesn't take files." }] } : real.importAssignmentFiles(input),
    setAssignmentOwner: async (input) => input.assignmentId === PRACTICE.assignment ? api.getSchoolOnboardingState() : real.setAssignmentOwner(input),
    correctAssignment: async (input) => input.assignmentId === PRACTICE.assignment ? api.getSchoolOnboardingState() : real.correctAssignment(input),
    selectAssignment: async (input) => input.assignmentId === PRACTICE.assignment ? { target: { kind: "assignment", assignmentId: PRACTICE.assignment }, job: job() } : real.selectAssignment(input),
    getScopedConversation: async (target) => isPractice(target) ? { job: job(), activity: "idle" } : real.getScopedConversation(target),
    stopScopedConversation: async (target) => isPractice(target) ? { job: job(), activity: "idle" } : real.stopScopedConversation(target),
    send: async (input) => {
      if (!isPractice(input.target)) return real.send(input);
      const reply = "This is the practice homework, so I'll keep it simple: I put the numbers in order and said how. Real homework works the same way.";
      thread = [...thread, { messageId: `practice-you-${thread.length}`, role: "user", text: input.text, createdAt: now(), turnIndex: thread.length }, { messageId: `practice-dot-${thread.length}`, role: "assistant", text: reply, createdAt: now(), turnIndex: thread.length }];
      return { outcome: "completed", text: reply, job: job() };
    },

    getLearnState: async (input) => {
      const state = await real.getLearnState(input);
      const exams = [...state.exams, exam], topics = [...state.topics, topic];
      const sessions = session ? [...state.sessions, { sessionId: session.sessionId, topicId: session.topicId, mode: session.mode, goal: session.goal, status: session.status, updatedAt: session.updatedAt, startedAt: session.startedAt, finishedAt: session.finishedAt, result: null }] : state.sessions;
      const selectedExamId = input?.selectedExamId ?? undefined;
      return { ...state, exams, topics, sessions, plan: planLearn({ exams, topics, mastery: state.mastery, sessions, today: new Date().toLocaleDateString("en-CA"), ...(selectedExamId ? { selectedExamId } : {}) }) };
    },
    getLearnNotes: async (input) => input.examId === PRACTICE.exam ? { cheatsheet: [], pages: [] } : real.getLearnNotes(input),
    setLearnExam: async (input) => input.examId === PRACTICE.exam ? api.getLearnState() : real.setLearnExam(input),
    removeLearnGoal: async (input) => input.examId === PRACTICE.exam ? api.getLearnState() : real.removeLearnGoal(input),
    addLearnTopic: async (input) => input.examId === PRACTICE.exam ? api.getLearnState() : real.addLearnTopic(input),
    startTutorSession: async (input) => input.examId === PRACTICE.exam || input.topicId === PRACTICE.topic ? edit(() => startSession()) : real.startTutorSession(input),
    getTutorSession: async (input) => input.sessionId === PRACTICE.session ? edit(current => current) : real.getTutorSession(input),
    answerTutorBlock: async (input) => {
      if (input.sessionId !== PRACTICE.session) return real.answerTutorBlock(input);
      return edit(current => {
        const right = input.answer.kind === "choice" && input.answer.picked === 0;
        const result = { answer: input.answer, correct: right, hintsUsed: 0, seconds: 5 };
        const blocks = current.blocks.map(item => item.blockId === input.blockId ? { ...item, status: right ? "answered" : "open", answeredAt: right ? now() : null, firstAnsweredAt: item.firstAnsweredAt ?? now(), result, attempts: [...item.attempts, { ...result, answeredAt: now() }] } as PublicTutorBlock : item);
        const say = right ? "Right. You always press Submit, never Dot and never me. That's the whole lesson. Real ones are short too." : "Not quite. Dot does the work, but who hands it in? Try again.";
        const said = [...blocks, block(blocks.length, "tutor_say", { text: say })];
        // A right answer ends the practice lesson, so it closes like a real one.
        return right ? { ...current, updatedAt: now(), blocks: said, status: "completed", phase: "wrap", activeSince: null, finishedAt: now(),
          result: { summary: "You know who hands the work in: you do.", previousLevel: null, level: null, evidence: [], missing: [], next: "Your real tests are waiting in Learn.", assessments: [], clicked: [], cheatsheet: ["You press Submit. Dot only hands work in if you choose “Do it and hand it in”."] } }
          : { ...current, updatedAt: now(), blocks: said };
      });
    },
    hintTutorBlock: async (input) => input.sessionId === PRACTICE.session ? edit(current => current) : real.hintTutorBlock(input),
    saveTutorDraft: async (input) => input.sessionId === PRACTICE.session ? edit(current => current) : real.saveTutorDraft(input),
    sendTutorMessage: async (input) => input.sessionId === PRACTICE.session
      ? edit(current => ({ ...current, updatedAt: now(), messages: [...current.messages, { messageId: input.messageId ?? `practice-message-${current.messages.length}`, text: input.text, createdAt: now() }],
        blocks: [...current.blocks, block(current.blocks.length, "tutor_reply", { text: "Good question. In a real lesson I'd answer it here, next to the board." }, { replyTo: input.messageId ?? `practice-message-${current.messages.length}` })] }))
      : real.sendTutorMessage(input),
    pauseTutorSession: async (input) => input.sessionId === PRACTICE.session ? edit(current => ({ ...current, status: "paused", activeSince: null })) : real.pauseTutorSession(input),
    resumeTutorSession: async (input) => input.sessionId === PRACTICE.session ? edit(current => ({ ...current, status: "active", activeSince: now() })) : real.resumeTutorSession(input),
    cancelTutorSession: async (input) => input.sessionId === PRACTICE.session ? edit(current => ({ ...current, status: "cancelled", activeSince: null })) : real.cancelTutorSession(input),
  };
  return api;
}
