# Release interaction verification — 2026-09-19

Actual React components were exercised through Microsoft Playwright with local
preview IPC at 1440×950, plus the existing 390px and 720px recovery checks.
These are controlled renderer results, not proof of live providers or installation.

Passed:

- `preview-routes.journey.mjs`: all 68 registered scenario URLs load, identify this
  checkout/version and expose the expected auth fixture, with no page errors.
  Settings URLs share the same redesigned settings page; these are not 68 unique screens.
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

Older workspace, assignment, school-check, chat and Markdown journey scripts still
reference the previous design's selectors and require migration. Their failures
were retained in the local QA logs; they are not counted as passing current coverage.
The current suites above exercise replacement paths, but do not establish every
old assertion (including dedicated historical scan details and old settings search).

Remaining release gates include live scan/chat/homework/tutor completion, Claude,
restart persistence, native installers and installed upgrades. The first live scan
failed because the fixture process had exited; ChatGPT authorization succeeded and
the fixture was restarted. This failed run remains part of the evidence.
