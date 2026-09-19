# Release interaction verification — 2026-09-19

Actual React components were exercised through Microsoft Playwright with local
preview IPC at 1440×950, plus the existing 390px and 720px recovery checks.
These are controlled renderer results, not proof of live providers or installation.

Passed:

- `preview-routes.journey.mjs`: all 68 registered scenario URLs load, identify this
  checkout/version and expose the expected auth fixture, with no page errors.
  Settings URLs share the same redesigned settings page; these are not 68 unique screens.
  They now scroll to the named section. Scan and update routes open the relevant view.
- `redesign.journey.mjs`: correction persistence, receipt/session navigation,
  typed/explanation draft recovery, isolated JavaScript execution and timeout recovery,
  memory revision updates, narrow layouts and keyboard focus restoration.
- `release-controls.journey.mjs`: calendar/list/undated/filters, one pending start,
  pause/resume/stop, manual submission confirmation, edit takeover, blocked homework,
  failed-work retry, review-time validation, memory visibility, permission target changes,
  failed save/retry/delete, and feedback retention/retry.
- `release-learning.journey.mjs`: exam correction, source validation and import retry,
  error persistence across polling, population/flashcard/number-line/function-plot
  exploration, and choice persistence after leaving/reopening.
- Both exports in `connected-apps-preview.journey.mjs`: independent pending apps,
  success/outage/retry, expired/missing/disconnected accounts, keyboard interaction,
  onboarding authorization polling, failed connection retry and 720px layout.
- Native `onboarding-reconnect`: saved school profile returns to AI sign-in; native
  guest layers remain hidden after a window resize and the normal polling interval.

The sweep uncovered and fixed the native school-pane overlap, stale reconnect
failure, permission choices carrying across targets, Start remaining enabled for
restricted homework, and Learn refresh erasing an action error.

Older workspace, assignment, chat and Markdown journey scripts still
reference the previous design's selectors and require migration. Their failures
were retained in the local QA logs; they are not counted as passing current coverage.
The current suites above exercise replacement paths, but do not establish every
old assertion (including dedicated historical scan details and old settings search).

## September 19 follow-up

Real ChatGPT scan recovered after the fixture server was restored, discovered one
course and the smoke assignment, and saved them across restart. A real home chat
answered about that assignment. Tutor generated its first real choice exercise;
the complete tutor journey is still pending. Live homework Start was blocked by
automatic approval review. Claude is not connected; neither boundary is passed.

Native screenshots exposed a hidden school report, a blank initial school browser,
and tutor controls under Windows caption buttons. Fixed the inherited report CSS,
browser initialization, report width, caption insets and header spacing. The scan
sign-in action also incorrectly toggled an already-open browser closed; it now
opens it consistently. The School check action remains available at small sizes.

The updated `school-check.journey.mjs` passes sign-in, browser close, scan results,
details/focus, changed dates, 800px layout, discovery, pause, failure and navigation
to assignment work. `desktop-layout.journey.mjs` passes nonoverlap/visibility checks
for Today, Learn, school handoff, tutor and assignment review at 1120px and 800px,
plus settings section landing. Screenshots were inspected for school report,
tutor and small-window headers. These are renderer previews with simulated
caption insets, not native verification. Native interaction was stopped with
Escape after rebuilding; final desktop verification remains pending.

CI on cc2e7fe passed 421/422 Windows Node tests and the Windows native checks;
the shell timeout used milliseconds for Pi's seconds and killed a command early.
Fixed the conversion and explicit timeout reporting. Focused tests now prove a
1.5-second command completes with a 10-second timeout and timeout/recovery works.
macOS controlled checks passed but packaged first-launch proof failed. The launch
checker now resolves the mounted app's canonical path and retains the last probe
failure/state. A fresh CI result is required; this is not a claimed macOS pass.

Remaining release gates: complete live homework/tutor, Claude, final native visual
verification, successful packaged first launch and installed Windows upgrades on
the exact final source/artifacts. No release has been published.

## Queue follow-up

The scope audit found that "Do this next" only reordered existing queue entries
and did not request execution in manual mode. `queueAssignmentNext` now records
an explicit student request transactionally, using existing eligibility and rule
checks. Higher manager priority now sorts first in Today. The lifecycle kernel
waits for browser ownership to become free and starts only the requested work;
other automatically queued homework stays stopped in manual mode.

Controlled manager/IPC/UI/kernel checks passed in
`.agents/studi-qa/checks/2026-09-19T16-49-26.056Z-37948/result.json`, including
duplicate requests, permission denial without partial queue changes, saved
priority across reopening, browser contention and manual mode. The separate
`queue-next.journey.mjs` passes the real row interaction with controlled IPC.
This is not a live assignment completion result.

CI 35455821589 at 2afb7fe passed macOS first launch (renderer plus auth-state IPC)
and its welcome screenshot was inspected. DMG unmount then failed because a
process still held the image. Windows shell tests timed out at 10 seconds; local
checks pass. These failed jobs remain failures pending fresh runner evidence.
