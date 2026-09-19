# PR 38 renderer handoff

Source checkout: C:/Users/kaust/.codex/worktrees/studi-redesign-release/studi-2.
No shared/backend/IPC edits, commits, dependency installs, Electron builds, or full release suite by this renderer task.

Implemented renderer paths:

- AppChrome/StudiApp/WorkspaceScreens, renderer fonts and redesign.css: concept paper tokens, mode switch, centered Today, flat settings; actual Inky retained.
- Today.tsx/todayGroups.ts: grouping, details, due correction, manual add, ownership, existing-queue ordering and changed-row flash.
- AssignmentWorkspace/AssignmentWork/HomeworkFiles/assignmentActivity: phase side panel, actual school browser, readable activity/doubts/checklist/markdown, files tree/reader, manual confirmation and submit-by-rule, recorded receipt.
- ChatWorkspace/ConversationTimeline/WorkspaceDialog: contextual drafts and existing send routes, unified event/message sheet, event links to assignments/receipts and persisted tutor results, native modal keyboard behavior.
- LearnScreen/LearnConversation/TutorScreen/TutorModels: source state/retry/imports/exam dates, real Learn chat, source planning and homework hints, recap/mock exam start, public tutor projection, all five fixed models, bounded sandbox integration, hints/answers/drafts/pause/resume.
- MemorySettings/HomeworkRules: real revision-checked memory edit/forget, scope/kind rule controls and authoritative rule checker.
- OnboardingScreen: lapsed sign-in port from 6034a0c; no automatic OAuth, runtime_login overrides provider-ready.
- UpdateControls: work_start notification label. Preview routes/fixtures and tests/ui/redesign.journey.mjs.

Evidence:

- Renderer noEmit: bunx tsc -p tsconfig.json --noEmit --pretty false passed.
- Focused actual React browser journey passed: due correction persistence, timeline receipt/session navigation, immediate Leave flush for typed/explanation drafts, memory revision update, five 390px routes.
- Code sandbox browser checks passed: JavaScript result, fetch/indexedDB/importScripts/WebSocket/Worker absent, infinite loop timeout, subsequent run recovery. This caught a shared nested-template escaping bug that Newton fixed.
- Keyboard sheet Enter/Escape/focus restoration passed separately; assertion is saved in redesign.journey.mjs.
- 19 unit checks passed: week-calendar, chat-timeline, stop-assignment-for-scan, scan-browser-owner, connected-app-polling.
- Actual preview screenshots were inspected against concept. Header measured 60px, Today column 752px. Playwright tool places artifacts in its configured original-checkout output directory (direct integration-output filename was refused).
  - Concept: C:/Users/kaust/OneDrive/Documents/dev/studi-2/.agents/playwright-mcp/page-2026-09-19T15-04-42-844Z.png
  - Today desktop: C:/Users/kaust/OneDrive/Documents/dev/studi-2/.agents/playwright-mcp/page-2026-09-19T15-15-34-694Z.png
  - Assignment review: C:/Users/kaust/OneDrive/Documents/dev/studi-2/.agents/playwright-mcp/page-2026-09-19T15-06-39-513Z.png
  - Learn desktop: C:/Users/kaust/OneDrive/Documents/dev/studi-2/.agents/playwright-mcp/page-2026-09-19T15-06-49-083Z.png
  - Tutor narrow: C:/Users/kaust/OneDrive/Documents/dev/studi-2/.agents/playwright-mcp/page-2026-09-19T15-15-35-774Z.png
  Learn/assignment/tutor captures precede final small typography and focus corrections.

Remaining integration/verification limits:

- Backend has no queue-only IPC for a discovered task while work is active. Ampere confirmed reorderQueue accepts existing queue IDs only. Do this next is restricted to already queued rows; coordinator owns completing nonqueued enqueue/steer.
- Native file chooser remains wired; drag/drop import has no renderer IPC and was not implemented. File command-output panel is not implemented; readable action history and file previews are present.
- Receipt displays recorded before/after checkpoint summaries, not screenshot images (current receipt contract supplies summaries).
- Historical scan context links open the school-check view; there is no historical scan-by-ID read API in this renderer.
- Controlled preview proof is not live ChatGPT/Claude, native browser/chooser, credential recovery, or submission proof. Coordinator owns integrated build and the single final verification task.
- Old journey selectors have not been rewritten globally. The new bounded journey preserves behavioral assertions; native self-test runner untouched.
