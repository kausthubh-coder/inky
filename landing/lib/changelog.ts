// Newest first. Dates are the published GitHub release dates in UTC.
// Add the next entry when preparing a desktop release; keep unreleased work out.
export const changelog = [
  {
    version: "0.1.10", date: "2026-09-14", title: "A more complete school check",
    summary: "Inky keeps the instructions, deadline and school status together, with the sources they came from.",
    changes: [
      "Read PDF instructions and text rubrics through your signed-in school session, and keep the files with the assignment.",
      "Check for submitted, locked, incomplete or stale work before starting. Recheck one assignment without starting its homework.",
      "Resume saved scan progress, keep completed setup after a failed check, and show collected instructions and scan messages.",
      "Added a fake-school testing harness to compare scanner results and track usage.",
    ],
    note: "The more complete test scan took more time and tokens. Support across different schools is still being validated.",
  },
  {
    version: "0.1.9", date: "2026-09-14", title: "PDFs, rubrics and readable replies",
    summary: "School attachments can become part of the work, even when the built-in PDF viewer gets stuck.",
    changes: [
      "Download school files into the right assignment folder without replacing existing files.",
      "Read PDF text, diagrams and scanned pages, with another reading path when the viewer stalls.",
      "Show formatted Inky replies in chats, assignments, onboarding and school checks.",
    ],
  },
  {
    version: "0.1.8", date: "2026-09-12", title: "One place for each assignment",
    summary: "Instructions, files and Inky’s work sit together, with clearer controls for what happens next.",
    changes: [
      "Switch between Assignment, Files and Inky’s work; add files and start, pause, resume or review homework.",
      "See dated scan results, newly found homework and deadline changes, with a Continue action beside school sign-in.",
      "Improved assignment-chat handoff, saved homework rules, exact deadlines and settings feedback.",
    ],
  },
  {
    version: "0.1.7", date: "2026-09-10", title: "Know where your school check stands",
    summary: "Find the scan, see what it needs, and get back to the assignment using the browser.",
    changes: [
      "Clearer scan progress, requests for help, and actions to open, wait for or stop competing assignment work.",
      "Reconcile verified course aliases while preserving saved work; show unresolved identity conflicts.",
      "Simpler homework rules, clearer browser controls and feedback drafts kept until delivery is confirmed.",
    ],
  },
  {
    version: "0.1.6", date: "2026-09-10", title: "Keep Inky and your work together",
    summary: "Assignments and school checks get their own conversations, with the right browser page attached.",
    changes: [
      "Open an assignment’s instructions, conversation, saved answers and files in a centered workspace.",
      "Pause and continue school checks; keep browser activity with the correct assignment when switching views.",
      "Improved duplicate detection, scan coverage and connected-app sign-in, progress and retry controls.",
      "Retain drafts, conversations and saved work across closing and restarting Studi.",
    ],
  },
  {
    version: "0.1.5", date: "2026-09-07", title: "A clearer desk, fewer interruptions",
    summary: "The paper interface and browser handoff improvements come together with fixes from full app testing.",
    changes: [
      "Clearer onboarding progress and more readable, searchable settings.",
      "Retain scanned instructions and deadlines, and reuse assignment records across repeated scans.",
      "Improve draft saving, cancellation, retries and browser handoffs; start homework from chat and report saved results.",
    ],
  },
  {
    version: "0.1.4", date: "2026-09-07", title: "Better clues when something goes wrong",
    summary: "More useful private-beta diagnostics help trace a problem from a student action through Inky’s work.",
    changes: [
      "Connect chat, assignment and scan activity with model requests, tool results, retries and failures.",
      "Record model timing, token usage and reported costs, with improved scan and session error context.",
      "Keep password fields and known credentials filtered, while honoring existing analytics and replay preferences.",
    ],
  },
  {
    version: "0.1.3", date: "2026-09-07", title: "A conversation that stays with you",
    summary: "A persistent Inky chat joins the week board, along with desktop update controls.",
    changes: [
      "Reference assignments in chat, browse previous and upcoming weeks, and find work without a due date.",
      "Keep chat history and drafts, with stop and retry controls and a school browser beside the conversation.",
      "Add automatic Windows update checks and Restart & update, plus a Mac download-and-replace path.",
    ],
  },
  {
    version: "0.1.2", date: "2026-09-05", title: "An easier first hello",
    summary: "Repairs to desktop sign-in and startup, plus a landing demo made for smaller screens.",
    changes: [
      "Fix desktop sign-in and startup behavior.",
      "Add an immersive mobile version of the landing-page demo.",
    ],
  },
  {
    version: "0.1.1", date: "2026-09-04", title: "The right connection",
    summary: "A small connection fix after the first release.",
    changes: ["Point the desktop app at the correct Inky backend."],
  },
  {
    version: "0.1.0", date: "2026-09-04", title: "Meet Studi. Meet Inky.",
    summary: "The first published private-beta release of the desktop app and Studi website.",
    changes: [
      "Bring together school scanning, assignment work, a live school browser and conversations with Inky.",
      "Let students use the page during sign-in and confirm when taking the page back from Inky.",
      "Add notification settings and model usage tracking.",
      "Launch the interactive landing demo, account and waitlist flow, and mobile refinements.",
    ],
  },
] as const;
