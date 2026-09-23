import type { Activity, SchoolState } from "./domain.js";

// Authored fixtures. The scorer reads checked-in expected files, never these rows.
export function configureSchoolTheme(
  state: SchoolState,
  activity: (
    id: string,
    course: string,
    title: string,
    changes: Partial<Activity>,
  ) => Activity,
): void {
  const moodle = state.scenarioId.startsWith("moodle-");
  state.scenarioVersion = 3;
  state.presentation = {
    theme: moodle ? "moodle" : "canvas",
    connectorApis: !state.scenarioId.endsWith("-no-api"),
    remembered: true,
    duoDelayMs: 1500,
  };
  state.sessions.school = state.scenarioId !== "moodle-sso";
  state.sessions.statistics = false; // Reached by a real cross-origin LTI POST.
  state.courses = state.courses.filter((course) =>
    ["programming", "structures"].includes(course.id),
  );
  const task = (id: string, title: string, changes: Partial<Activity> = {}) =>
    activity(id, "programming", title, {
      moduleType: "assign",
      workKind: "problem_set",
      closeAt: null,
      requirements: ["Read the activity instructions before starting."],
      instructions: "Read the activity instructions before starting.",
      ...changes,
    });
  state.activities = [
    task("exercise-05", "Exercise 05", {
      workKind: "code",
      attachments: ["starter-c", "programming-guide"],
    }),
    task("concept-quiz", "Concept quiz", {
      kind: "quiz",
      moduleType: "quiz",
      workKind: "quiz",
      dueAt: "2026-09-21T17:00:00.000Z",
      dueText: "September 21, 2026 at 1:00 PM ET",
    }),
    task("design-doc", "Design document", {
      workKind: "essay",
      dueAt: null,
      dueText: "Oct 7",
      instructions: "Due Oct 7. No submission time is specified.",
    }),
    task("reflection", "Weekly reflection", {
      workKind: "essay",
      dueAt: null,
      dueText: "Due Friday",
      instructions: "Due Friday. Submit a reflection; no time is specified.",
    }),
    task("pacific-lab", "Pacific lab", {
      workKind: "code",
      dueAt: "2026-09-19T06:59:00.000Z",
      dueText: "September 18, 2026 at 11:59 PM PT (September 19 at 2:59 AM ET)",
    }),
    task("project-proposal", "Project: proposal", {
      workKind: "essay",
      dueAt: null,
      dueText: "September 20, 2026 (no time specified)",
      instructions:
        "Proposal due September 20, 2026; no time specified. Final report is a separate submission due September 28 at 5 PM ET.",
    }),
    task("project-final", "Project: final report", {
      workKind: "essay",
      dueAt: "2026-09-28T21:00:00.000Z",
      dueText: "September 28, 2026 at 5:00 PM ET",
      closeAt: "2026-10-01T21:00:00.000Z",
      latePenalty:
        "Late submissions accepted until October 1 at 5 PM ET. The due date remains September 28.",
    }),
    task("webassign-1", "WebAssign problem set 1", {
      kind: "external",
      moduleType: "lti",
      service: "statistics",
      submissionChannel: "vendor",
      dueAt: "2026-09-17T03:59:00.000Z",
      dueText: "September 16, 2026 at 11:59 PM ET",
    }),
    task("gradescope-1", "Gradescope worksheet 1", {
      kind: "external",
      moduleType: "lti",
      service: "feedback",
      submissionChannel: "vendor",
      dueAt: "2026-09-18T03:59:00.000Z",
      dueText: "September 17, 2026 at 11:59 PM ET",
    }),
  ];
  const noise = [
    "resource",
    "page",
    "url",
    "folder",
    "forum",
    "label",
    "grade",
  ] as const;
  const titles = [
    "Lecture slides",
    "Course notes",
    "Lecture video",
    "Reference files",
    "Questions and answers",
    "Week overview",
    "Grade summary",
  ];
  for (let index = 0; index < (moodle ? 121 : 12); index++) {
    const type = noise[index % noise.length]!;
    state.activities.push(
      activity(
        `material-${String(index + 1).padStart(3, "0")}`,
        "programming",
        `${titles[index % titles.length]} ${index + 1}`,
        {
          moduleType: type,
          kind: type === "forum" ? "forum" : "lesson",
          workKind: "reading",
          module: `Week ${Math.floor(index / 12) + 1}`,
          dueAt: null,
          dueText: "No submission required",
          closeAt: null,
          submissionChannel: "none",
          requirements: [],
          instructions:
            "Reference material only. No work is assigned and no submission is required.",
          attachments: type === "resource" ? ["programming-slides"] : [],
        },
      ),
    );
  }
  for (const course of state.courses) {
    state.assets.push(
      {
        id: `${course.id}-review`,
        name: `${course.id}-review.docx`,
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        format: "docx",
        text: `${course.title}: midterm review\n1. Trace a stack push and pop.\n2. Explain an invariant.\n3. Compare linear and binary search. Show your reasoning.`,
      },
      {
        id: `${course.id}-slides`,
        name: `${course.id}-slides.pdf`,
        mime: "application/pdf",
        format: "pdf",
        text: `${course.title}: lecture slides\nFoundations: state and invariants.\nCore methods: trace each step.\nApplications: choose an algorithm and justify complexity.`,
      },
      {
        id: `${course.id}-past-quiz`,
        name: `${course.id}-past-quiz.pdf`,
        mime: "application/pdf",
        format: "image-pdf",
        text: "PAST QUIZ\nGRADE 70\nPUSH A THEN B\nPOP RETURNS B\nREVIEW STACKS",
      },
    );
    // Attach published learning sources to an ordinary reference row, not homework.
    const materials = [
      `${course.id}-review`,
      `${course.id}-slides`,
      `${course.id}-past-quiz`,
    ];
    const existing = state.activities.find(
      (item) =>
        item.courseId === course.id && item.submissionChannel === "none",
    );
    if (existing) existing.attachments = materials;
    else
      state.activities.push(
        activity(
          `${course.id}-resources`,
          course.id,
          "Midterm study materials",
          {
            moduleType: "resource",
            kind: "lesson",
            dueAt: null,
            dueText: "No submission required",
            closeAt: null,
            submissionChannel: "none",
            attachments: materials,
            requirements: [],
          },
        ),
      );
  }
}
