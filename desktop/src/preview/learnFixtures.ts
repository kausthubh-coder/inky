import type { StudiRendererApi } from "../../shared/index.js";
import type { LearnState } from "../../shared/learn-state.js";
import type {
  PublicTutorBlock,
  PublicTutorSession,
} from "../../shared/tutor.js";
import type { NoteDocument } from "../../shared/note.js";
import { planLearn } from "../../shared/learn.js";

/** Controlled preview state only. Never installed by the production entry point. */
export function learnPreview(id: string) {
  const now = () => new Date().toISOString();
  const today = new Date().toLocaleDateString("en-CA");
  const examDay = new Date();
  examDay.setDate(examDay.getDate() + 6);
  const date =
    examDay.getFullYear() +
    "-" +
    String(examDay.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(examDay.getDate()).padStart(2, "0");
  const topics: LearnState["topics"] = [
    "Counting and sets",
    "Conditional probability",
    "Bayes’ theorem",
    "Random variables",
    "Distributions",
  ].map((title, index) => ({
    topicId: "topic-" + index,
    examId: "exam-stats",
    courseId: "course-csc316",
    title,
    chapter: index,
    weight: 1,
    sourceId: "source-stats",
    origin: "source",
    updatedAt: now(),
  }));
  const block = (
    tool: PublicTutorBlock["tool"],
    args: unknown,
  ): PublicTutorBlock =>
    ({
      blockId: crypto.randomUUID(),
      toolCallId: crypto.randomUUID(),
      sequence: 0,
      status: "open",
      createdAt: now(),
      answeredAt: null,
      hintsUsed: 0,
      draft: "",
      result: null,
      tool,
      args,
    }) as PublicTutorBlock;
  const model = id.slice("tutor-".length);
  const first: PublicTutorBlock =
    model === "typed"
      ? block("tutor_ask_typed", {
          question:
            "Now 1 in 10 people has the disease. Same 90% test. What are the odds?",
          hints: [],
          hasMoreHints: true,
        })
      : model === "explain"
        ? block("tutor_ask_explain", {
            prompt:
              "Explain it to a friend who thinks a positive test means 90%.",
          })
        : model === "population"
          ? block("tutor_show_model", {
              model: "population_grid",
              params: { population: 1000, sampleSize: 100, proportion: 0.1 },
              controls: ["sample", "sampleSize", "reset"],
            })
          : model === "flashcards"
            ? block("tutor_show_model", {
                model: "flashcards",
                params: {
                  cards: [
                    {
                      front: "P(A | B)",
                      back: "The probability of A, given B.",
                    },
                    {
                      front: "Base rate",
                      back: "How common something is before new evidence.",
                    },
                  ],
                },
                controls: ["flip", "next", "previous"],
              })
            : model === "number-line"
              ? block("tutor_show_model", {
                  model: "number_line",
                  params: { min: -10, max: 10, step: 1, points: [-2, 4] },
                  controls: ["move", "reset"],
                })
              : model === "function-plot"
                ? block("tutor_show_model", {
                    model: "function_plot",
                    params: {
                      family: "quadratic",
                      a: 1,
                      b: 0,
                      c: 0,
                      xMin: -5,
                      xMax: 5,
                    },
                    controls: ["a", "b", "c", "reset"],
                  })
                : model === "code"
                  ? block("tutor_show_model", {
                      model: "code_runner",
                      params: {
                        language: "javascript",
                        code: "console.log([3, 1, 2].sort((a, b) => a - b));",
                        instructions: "Change the numbers, then run the sort.",
                        timeoutMs: 500,
                      },
                      controls: ["edit", "run", "reset"],
                    })
                  : block("tutor_ask_choice", {
                      question: "P(A given B) means the chance of A…",
                      options: [
                        "when B already happened",
                        "and B both happen",
                        "or B, either one",
                      ],
                    });
  const makeSession = (): PublicTutorSession => ({
    sessionId: "preview-tutor",
    topicId: "topic-2",
    goal: "Bayes’ theorem · shaky to getting there",
    mode: "topic",
    topicIds: ["topic-2"],
    examId: "exam-stats",
    initialLevels: { "topic-2": 1 },
    status: id === "tutor-paused" ? "paused" : "active",
    startedAt: now(),
    updatedAt: now(),
    finishedAt: null,
    budgetSeconds: 900,
    elapsedSeconds: 60,
    activeSince: id === "tutor-paused" ? null : now(),
    initialLevel: 1,
    blocks: [first],
    messages: [],
    result: null,
    error: null,
  });
  let tutor = makeSession();
  if (id === "tutor-finished")
    tutor = {
      ...tutor,
      status: "completed",
      activeSince: null,
      finishedAt: now(),
      blocks: [],
      result: {
        summary: "You tied the result to the base rate.",
        previousLevel: 1,
        level: 2,
        evidence: [],
        missing: ["Practise missed cases."],
        next: "A five minute recap in two days.",
        assessments: [],
      },
    };
  let state: LearnState = {
    sources:
      id === "learn-empty"
        ? []
        : [
            {
              sourceId: "source-stats",
              courseId: "course-csc316",
              title: "ST 370 Syllabus.pdf",
              kind: "file",
              sourceTarget: null,
              contentHash: "a".repeat(64),
              status:
                id === "learn-reading"
                  ? "reading"
                  : id === "learn-error"
                    ? "failed"
                    : "ready",
              extractedAt: id === "learn-reading" ? null : now(),
              error:
                id === "learn-error"
                  ? "This file could not be read. Try another copy."
                  : null,
              createdAt: now(),
              updatedAt: now(),
            },
          ],
    exams:
      id === "learn-empty"
        ? []
        : [
            {
              examId: "exam-stats",
              courseId: "course-csc316",
              title: "ST 370 midterm",
              date,
              sourceId: "source-stats",
              dateOrigin: "source",
              updatedAt: now(),
            },
          ],
    topics: id === "learn-empty" ? [] : topics,
    mastery: [],
    sessions: id.startsWith("tutor-") ? [tutor] : [],
    plan: {
      leadExam: null,
      todayTopic: null,
      readiness: { status: "unknown", percent: null, knownWeight: 0 },
      recapDue: false,
      recapTopic: null,
      path: [],
    },
  };
  if (id === "learn" || id === "learn-partial")
    state.mastery = topics
      .slice(0, id === "learn-partial" ? 2 : 5)
      .map((topic, index) => ({
        topicId: topic.topicId,
        level: [4, 3, 1, 2, 0][index]!,
        evidenceCount: 1,
        /* Preview assessment is generated below for the deterministic planner. */
        updatedAt: now(),
      }));
  const masteryRecords = state.mastery.map((record, index) => ({
    ...record,
    evidence: [
      {
        sessionId: "previous",
        blockId: "evidence-" + index,
        kind: "typed" as const,
        correct: index < 2,
        answer: "Simulated answer",
        rationale: "Simulated session evidence",
        hintsUsed: 0,
        recordedAt: now(),
      },
    ],
  }));
  const read = (selectedExamId?: string) => {
    state = {
      ...state,
      sessions: state.sessions.map((item) =>
        item.sessionId === tutor.sessionId ? tutor : item,
      ),
      plan: planLearn({
        ...state,
        mastery: masteryRecords,
        today,
        ...(selectedExamId ? { selectedExamId } : {}),
      }),
    };
    return structuredClone(state);
  };
  let memories: NoteDocument[] = [
    {
      frontmatter: {
        schemaVersion: 1,
        noteId: "preview-preference",
        scope: "student",
        subjectId: "preview",
        about: "preference",
        key: "citations",
        title: "Use APA citations",
        revision: 1,
        updatedAt: now(),
      },
      content: "Use APA citations for my written assignments.",
    },
  ];
  const getMemory = (noteId: string) => {
    const note = memories.find((item) => item.frontmatter.noteId === noteId);
    if (!note) throw new Error("Memory no longer exists.");
    return note;
  };
  const session = () => structuredClone(tutor);
  const status = (status: PublicTutorSession["status"]) => {
    tutor = {
      ...tutor,
      status,
      updatedAt: now(),
      activeSince: status === "active" ? now() : null,
    };
    return session();
  };
  return {
    getLearnState: async (input) => read(input?.selectedExamId),
    importLearnSource: async (input) => {
      state.sources.push({
        sourceId: crypto.randomUUID(),
        courseId: input.courseId,
        title: input.title,
        kind: "paste",
        sourceTarget: null,
        contentHash: "b".repeat(64),
        status: "ready",
        extractedAt: now(),
        error: null,
        createdAt: now(),
        updatedAt: now(),
      });
      return read();
    },
    importLearnFile: async () => {
      throw new Error(
        "Native file selection is available in the desktop app. Paste text here to exercise the preview.",
      );
    },
    findLearnSyllabus: async () => {
      throw new Error(
        "Connected source discovery is available in the desktop app.",
      );
    },
    retryLearnSource: async ({ sourceId }) => {
      state.sources = state.sources.map((source) =>
        source.sourceId === sourceId
          ? { ...source, status: "ready", error: null, extractedAt: now() }
          : source,
      );
      return read();
    },
    setLearnExam: async (input) => {
      const exam = {
        ...input,
        examId: input.examId ?? crypto.randomUUID(),
        sourceId: "student-entered",
        dateOrigin: "student" as const,
        updatedAt: now(),
      };
      state.exams = [
        ...state.exams.filter((item) => item.examId !== exam.examId),
        exam,
      ];
      return read();
    },
    getTutorSession: async () => session(),
    startTutorSession: async (input) => {
      tutor = {
        ...makeSession(),
        sessionId: crypto.randomUUID(),
        goal:
          input.topic ??
          topics.find((topic) => topic.topicId === input.topicId)?.title ??
          "Mock exam",
        mode: input.mode ?? "topic",
        budgetSeconds: (input.minutes ?? 15) * 60,
      };
      state.sessions = [tutor];
      return session();
    },
    answerTutorBlock: async ({ blockId, answer }) => {
      tutor = {
        ...tutor,
        updatedAt: now(),
        blocks: tutor.blocks.map((item) =>
          item.blockId === blockId
            ? {
                ...item,
                status: "answered",
                answeredAt: now(),
                result: {
                  answer,
                  correct:
                    answer.kind === "choice" ? answer.picked === 0 : null,
                  hintsUsed: item.hintsUsed,
                  seconds: 10,
                },
              }
            : item,
        ),
      };
      const next = block("tutor_ask_typed", {
        question: "What does the base rate tell us?",
        hints: [],
        hasMoreHints: true,
      });
      tutor.blocks.push({ ...next, sequence: tutor.blocks.length });
      return session();
    },
    hintTutorBlock: async ({ blockId }) => {
      tutor = {
        ...tutor,
        updatedAt: now(),
        blocks: tutor.blocks.map((item) =>
          item.blockId === blockId && item.tool === "tutor_ask_typed"
            ? {
                ...item,
                hintsUsed: item.hintsUsed + 1,
                args: {
                  ...item.args,
                  hints: [
                    ...item.args.hints,
                    "Start by counting how many people are in each group.",
                  ],
                  hasMoreHints: item.hintsUsed < 2,
                },
              }
            : item,
        ),
      };
      return session();
    },
    saveTutorDraft: async ({ blockId, draft }) => {
      tutor = {
        ...tutor,
        updatedAt: now(),
        blocks: tutor.blocks.map((item) =>
          item.blockId === blockId ? { ...item, draft } : item,
        ),
      };
      return session();
    },
    sendTutorMessage: async ({ text, messageId }) => {
      tutor = {
        ...tutor,
        updatedAt: now(),
        messages: [
          ...tutor.messages,
          {
            messageId: messageId ?? crypto.randomUUID(),
            text,
            createdAt: now(),
            delivered: true,
          },
        ],
      };
      return session();
    },
    pauseTutorSession: async () => status("paused"),
    resumeTutorSession: async () => status("active"),
    cancelTutorSession: async () => status("cancelled"),
    listMemories: async () =>
      structuredClone(memories.map((note) => note.frontmatter)),
    readMemory: async ({ noteId }) =>
      structuredClone(
        memories.find((note) => note.frontmatter.noteId === noteId) ?? null,
      ),
    updateMemory: async ({ noteId, expectedRevision, title, content }) => {
      const note = getMemory(noteId);
      if (note.frontmatter.revision !== expectedRevision)
        throw new Error("Memory changed. Reload the latest version.");
      note.frontmatter = {
        ...note.frontmatter,
        title,
        revision: expectedRevision + 1,
        updatedAt: now(),
      };
      note.content = content;
      return structuredClone(note);
    },
    deleteMemory: async ({ noteId, expectedRevision }) => {
      const note = getMemory(noteId);
      if (note.frontmatter.revision !== expectedRevision)
        throw new Error("Memory changed. Reload the latest version.");
      memories = memories.filter((note) => note.frontmatter.noteId !== noteId);
      return { noteId, deleted: true as const };
    },
  } satisfies Pick<
    StudiRendererApi,
    | "getLearnState"
    | "importLearnSource"
    | "importLearnFile"
    | "findLearnSyllabus"
    | "retryLearnSource"
    | "setLearnExam"
    | "getTutorSession"
    | "startTutorSession"
    | "answerTutorBlock"
    | "hintTutorBlock"
    | "saveTutorDraft"
    | "sendTutorMessage"
    | "pauseTutorSession"
    | "resumeTutorSession"
    | "cancelTutorSession"
    | "listMemories"
    | "readMemory"
    | "updateMemory"
    | "deleteMemory"
  >;
}
