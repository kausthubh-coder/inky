import { type Activity, type Asset, type SchoolState, validateState } from "./domain.js";

export const SCENARIO_IDS = [
  "semester",
  "scan-regression",
  "partial-login",
  "interrupted-scan",
  "deadline-change",
  "workshop-unlock",
  "resume-draft",
  "lost-submit-response",
  "smoke",
] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];
const future = "2026-09-15T03:59:00.000Z";
function activity(id: string, courseId: string, title: string, changes: Partial<Activity> = {}): Activity {
  return {
    id,
    courseId,
    title,
    module: "Week 3",
    kind: "assignment",
    service: "school",
    dueAt: future,
    dueText: "September 14, 2026 at 11:59 PM America/New_York",
    closeAt: "2026-09-18T03:59:00.000Z",
    status: "not_started",
    grade: null,
    gradeVisible: true,
    submissionChannel: "lms",
    instructions: "Read the instructions and every required attachment before completing this activity.",
    requirements: ["Write an original response and save your work."],
    requiredFiles: [],
    attachments: [],
    prerequisites: [],
    maxAttempts: 1,
    ...changes,
  };
}
export function createScenario(scenarioId: string = "semester", seed = 42): SchoolState {
  if (!SCENARIO_IDS.includes(scenarioId as ScenarioId)) throw new Error(`Unknown scenario: ${scenarioId}`);
  if (!Number.isSafeInteger(seed)) throw new Error("Seed must be an integer");
  const courses = [
    {
      id: "programming",
      code: "CS 230",
      title: "Programming in C",
      aliases: ["CS230 - Fall", "Programming in C (Section 01)"],
    },
    {
      id: "structures",
      code: "CS 316",
      title: "Data Structures",
      aliases: ["Data Structures - 002"],
    },
    {
      id: "statistics",
      code: "ST 370",
      title: "Statistics for Engineers",
      aliases: ["ST370"],
    },
    { id: "games", code: "CS 281", title: "Game Design", aliases: [] },
    {
      id: "lab",
      code: "CS 217",
      title: "Software Development Lab",
      aliases: [],
    },
    {
      id: "writing",
      code: "ENG 101",
      title: "Writing and Society",
      aliases: [],
    },
  ];
  const assets: Asset[] = courses.flatMap((course) => [
    {
      id: `${course.id}-guide`,
      name: `${course.code.replaceAll(" ", "-")}-instructions.pdf`,
      mime: "application/pdf",
      format: "pdf" as const,
      text: `${course.title}\nActivity instructions\nRead each requirement before starting.\nProvide an explanation and supporting evidence.\nDo not confuse a saved draft with a final submission.\nUse the activity page for its due date and submission channel.`,
    },
    {
      id: `${course.id}-rubric`,
      name: `${course.id}-rubric.txt`,
      mime: "text/plain",
      format: "text" as const,
      text: "Rubric\nCompleteness: 40 points\nReasoning and evidence: 40 points\nFile format and clarity: 20 points\nA blank grade means feedback has not been released.\n",
    },
  ]);
  assets.push(
    {
      id: "observations",
      name: "observations.csv",
      mime: "text/csv",
      format: "text",
      text: "day,rain_mm\nMonday,5\nTuesday,10\nWednesday,0\nThursday,5\n",
    },
    {
      id: "starter-c",
      name: "starter.c",
      mime: "text/plain",
      format: "text",
      text: "#include <stdio.h>\nint main(void) { /* Calculate the requested statistic. */ return 0; }\n",
    },
    {
      id: "game-walkthrough",
      name: "README-template.md",
      mime: "text/markdown",
      format: "text",
      text: "# Game title\n## Controls\n## Walkthrough for every level\n## Screenshots\n",
    },
  );
  const activities: Activity[] = [
    activity("exercise-05", "programming", "Exercise 05", {
      attachments: ["programming-guide", "starter-c"],
      requirements: [
        "Read the attached PDF.",
        "Upload a C source file.",
        "Explain the output in the response.",
      ],
      requiredFiles: [".c"],
    }),
    activity("exercise-06", "programming", "Exercise 06", {
      status: "submitted",
      requirements: ["Already submitted; do not submit again."],
    }),
    activity("exercise-07", "programming", "Exercise 07", {
      status: "graded",
      grade: 92,
    }),
    activity("homework-1", "programming", "Homework 1", {
      status: "unknown",
      kind: "external",
      submissionChannel: "repository",
      dueAt: "2026-09-05T03:59:00.000Z",
      dueText: "September 4 at 11:59 PM",
      closeAt: null,
      instructions:
        "No Moodle submission is required. Submit source code through the linked repository. A timeline warning does not establish repository status.",
    }),
    activity("closed-exercise", "programming", "Exercise 02", {
      dueAt: "2026-09-02T03:59:00.000Z",
      dueText: "September 1 at 11:59 PM",
      closeAt: "2026-09-04T03:59:00.000Z",
    }),
    activity("late-exercise", "programming", "Exercise 03", {
      dueAt: "2026-09-12T03:59:00.000Z",
      dueText: "September 11 at 11:59 PM",
      closeAt: "2026-09-16T03:59:00.000Z",
      instructions:
        "The on-time deadline has passed. Late submissions are accepted until September 15 at 11:59 PM Eastern.",
    }),
    activity("stack-lesson", "structures", "Stack and Queue lesson", {
      kind: "lesson",
      requirements: ["Read the lesson and mark it complete."],
      attachments: ["structures-guide"],
    }),
    activity("stack-review", "structures", "Stack and Queue review", {
      kind: "quiz",
      prerequisites: ["stack-lesson"],
      maxAttempts: 3,
      requirements: ["Explain how a stack differs from a queue."],
    }),
    activity("workshop-3", "structures", "Workshop 3: Stack and Queue", {
      prerequisites: ["stack-review"],
      dueAt: "2026-09-12T03:55:00.000Z",
      dueText: "September 11 at 11:55 PM",
      closeAt: "2026-09-14T03:55:00.000Z",
      requirements: [
        "Complete the written response.",
        "Upload source code.",
        "Review the build report for the exact revision.",
      ],
      requiredFiles: [".java"],
      attachments: ["structures-rubric"],
    }),
    activity("workshop-4", "structures", "Workshop 4: Recursion", {
      prerequisites: ["workshop-3"],
      kind: "quiz",
      dueAt: null,
      dueText: "September 16, 2026 (time not specified)",
      requirements: ["Give a base case and recurrence.", "Explain the running time."],
    }),
    activity("build-check", "structures", "Coding submission and build report", {
      service: "builds",
      kind: "external",
      submissionChannel: "repository",
      requirements: ["Confirm the reported build revision matches the submitted revision."],
      instructions: "A successful older build is not evidence that the latest revision passed.",
    }),
    activity("hidden-feedback", "structures", "Workshop 2 feedback", {
      service: "feedback",
      status: "submitted",
      grade: null,
      gradeVisible: false,
    }),
    activity("hw5", "statistics", "Homework 5", {
      service: "statistics",
      dueAt: "2026-09-17T03:59:00.000Z",
      dueText: "September 16 at 11:59 PM (personal extension)",
      extensionAt: "2026-09-17T03:59:00.000Z",
      dashboardDueText: "September 9 at 11:59 PM",
      submissionChannel: "vendor",
      announcement:
        "Extension approved. One extension has now been used. Do not request the same extension again.",
      attachments: ["observations", "statistics-guide"],
      requirements: ["Calculate the mean rainfall from observations.csv.", "Explain the calculation."],
      maxAttempts: 3,
    }),
    activity("hw6", "statistics", "Homework 6", {
      service: "statistics",
      submissionChannel: "vendor",
      status: "graded",
      grade: 100,
    }),
    activity("hw7", "statistics", "Homework 7", {
      service: "statistics",
      submissionChannel: "vendor",
      maxAttempts: 3,
      attachments: ["statistics-rubric"],
    }),
    activity("hw8", "statistics", "Homework 8", {
      service: "statistics",
      submissionChannel: "vendor",
      dueAt: null,
      dueText: "September 17, 2026; exact time unavailable",
    }),
    activity("partners", "statistics", "Find project partners", {
      kind: "forum",
      dueAt: null,
      dueText: "No deadline published",
      closeAt: null,
      submissionChannel: "none",
      instructions:
        "Students can use this board to find project partners. Maximum group size: three. Whether solo work is allowed is not specified. These are informational notices, not assigned discussion replies.",
    }),
    activity("project-proposal", "statistics", "Project proposal", {
      dueAt: null,
      dueText: "Conflicting dates: October 13 in schedule; November 13 in copied note",
      closeAt: null,
      announcement:
        "The proposal date needs instructor confirmation. Do not silently choose one of the two dates.",
    }),
    activity("game-pitch", "games", "Puzzle game pitch", {
      kind: "forum",
      requirements: ["Describe the core mechanic.", "Describe three supporting mechanics."],
      attachments: ["games-guide"],
    }),
    activity("final-game", "games", "Final puzzle game", {
      requirements: [
        "Upload the playable HTML game.",
        "Upload a README PDF with instructions and an all-level walkthrough.",
        "Include screenshots in the README.",
        "Bring the working game to class.",
      ],
      requiredFiles: [".html", ".pdf"],
      attachments: ["game-walkthrough", "games-rubric"],
      dashboardDueText: "During class on September 14",
      instructions:
        "The activity accepts submissions until 11:59 PM. The separate in-class demonstration is still required.",
    }),
    activity("reflection", "games", "Reflection 2", {
      status: "submitted",
      grade: null,
    }),
    activity("lab1", "lab", "Lab 1", {
      status: "graded",
      grade: 94,
      attachments: ["lab-rubric"],
    }),
    activity("lab2", "lab", "Lab 2", {
      dueAt: "2026-09-15T12:20:00.000Z",
      dueText: "September 15 at 8:20 AM America/New_York",
      requiredFiles: [".java", ".pdf"],
      requirements: ["Upload the source file.", "Upload the completed test plan as PDF."],
      attachments: ["lab-guide"],
    }),
    activity("lab-demo", "lab", "Instructor demonstration", {
      submissionChannel: "in_person",
      requirements: ["Demonstrate your program to the instructor in class."],
    }),
    activity("grade-zero", "lab", "Practice diagnostic", {
      status: "graded",
      grade: 0,
      submissionChannel: "none",
      instructions: "This diagnostic has an explicit score of zero. It is not an ungraded assignment.",
    }),
    activity("observation", "writing", "Observation paragraph", {
      requirements: ["Write three sentences about a rainy afternoon.", "Include a sound and a color."],
      attachments: ["writing-guide", "writing-rubric"],
    }),
    activity("reading", "writing", "Read the short essay", {
      kind: "lesson",
      requirements: ["Read the assigned text and mark the reading complete."],
    }),
  ];
  const state: SchoolState = {
    schemaVersion: 1,
    scenarioId,
    scenarioVersion: 1,
    seed,
    clock: "2026-09-13T16:00:00.000Z",
    timezone: "America/New_York",
    courses,
    activities,
    assets,
    drafts: {},
    submissions: [],
    completed: [],
    sessions: { school: true, statistics: true, builds: true, feedback: true },
    revision: 0,
    faults: {
      courseFailurePending: scenarioId === "interrupted-scan",
      lostSubmitResponsePending: scenarioId === "lost-submit-response",
      downloadFailurePending: false,
    },
    builds: [
      {
        revision: "rev-old",
        state: "success",
        description: "Older revision; all tests passed.",
      },
      {
        revision: "rev-current",
        state: "failed",
        description: "Current revision; style check failed before staff tests.",
      },
    ],
  };
  // Retain realistic ordinary activities as well as targeted regression cases.
  for (const course of courses)
    for (let week = 1; week <= 2; week++) {
      state.activities.push(
        activity(`${course.id}-reading-${week}`, course.id, `Week ${week} reading`, {
          kind: "lesson",
          module: `Week ${week}`,
          dueAt: null,
          dueText: "No submission deadline",
          closeAt: null,
          status: "submitted",
          submissionChannel: "none",
          instructions: "This reading has already been completed. There is no submission form.",
        }),
      );
    }
  if (scenarioId === "partial-login") {
    state.sessions.statistics = false;
    state.sessions.feedback = false;
  }
  if (scenarioId === "resume-draft")
    state.drafts.observation = {
      answer: "Rain tapped against the window.",
      files: [],
      revision: 1,
    };
  if (scenarioId === "deadline-change")
    state.activities.find((item) => item.id === "exercise-05")!.dashboardDueText = "September 12 at 11:59 PM";
  if (scenarioId === "smoke") {
    state.courses = courses.filter((item) => item.id === "writing");
    state.activities = activities.filter((item) => item.id === "observation");
  }
  if (scenarioId === "scan-regression") {
    const ids = new Set([
      "exercise-05",
      "exercise-06",
      "exercise-07",
      "closed-exercise",
      "late-exercise",
      "hw5",
      "hw8",
      "final-game",
      "grade-zero",
    ]);
    state.activities = activities.filter((item) => ids.has(item.id));
    state.courses = courses.filter((course) => state.activities.some((item) => item.courseId === course.id));
  }
  // Seed controls presentation order without changing canonical identities or facts.
  if (Math.abs(seed) % 2 === 1) state.courses.reverse();
  validateState(state);
  return state;
}
