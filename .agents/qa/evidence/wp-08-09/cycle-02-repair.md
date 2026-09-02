# WP-08/09 Cycle 02 — Focused Repair Evidence

Date: 2026-09-01

Role: focused repair implementer

Inputs: `.agents/plans/packages/wp-08-09-lifecycle-execution.html`, `.agents/qa/evidence/wp-08-09/cycle-01-implement.md`, and the four live blockers in `.agents/qa/evidence/wp-08-09/cycle-01-test.md`

## Outcome

Repaired the four demonstrated lifecycle failures without changing the master plan or conclusion artifacts and without submitting real schoolwork.

- A daily wall-clock occurrence that has already passed by seconds now advances to the next eligible local day. The DST-gap fallback runs only when the requested local minute truly does not exist.
- The durable due-schedule claim refuses to advance while an assignment task owns the browser lease. The occurrence remains due and coalesced; the kernel checks again after 30 seconds instead of spinning or touching the visible page.
- Restart from `ready_review` no longer claims that the page survived. Studi writes the durable Markdown answer artifact, changes to an explicit `needs_user` handoff, keeps the task lease, and exposes **Open saved answers** in that handoff.
- The stale submit ref was independently caused by the assignment coordinator's pre-submit snapshot, not only by the scheduled-scan collision. The coordinator now refreshes evidence and uniquely re-identifies the same role/name control on the same URL with exactly one expected revision change. Only then does it durably mark the single destructive attempt and click the refreshed ref. A stale, ambiguous, duplicated, or concurrently changing control fails before the effect checkpoint; an error after the checkpoint remains an ambiguous handoff and is never retried.

## Production changes

- `electron/lifecycle/schedule.ts`
- `electron/lifecycle/kernel.ts`
- `electron/storage/lifecycle-records.ts`
- `electron/browser/controller.ts`
- `electron/assignment/coordinator.ts`
- `src/app/StudiApp.tsx`

No schema, migration, second scheduler, second browser controller, retry loop, compatibility path, or LMS-specific submit behavior was added.

## Focused checks

- `npm run build:electron; node --test tests/storage/lifecycle-execution.test.mjs tests/agent/browser-controller.test.mjs` — exit 0, 13/13 passed before the final safety subtraction.
- Final post-subtraction rerun: `npm run typecheck; npm run build:electron; node --test tests/storage/lifecycle-execution.test.mjs tests/agent/browser-controller.test.mjs` — exit 0, 13/13 passed.

The focused cases now reproduce and protect:

1. nonzero seconds after a daily minute selecting the next local day;
2. an active assignment lease deferring a due occurrence without advancing it;
3. pre-submit evidence invalidating the supplied ref, followed by deterministic unique re-identification and exactly one click;
4. restart from review producing readable saved answers and an honest handoff;
5. restart during an already-started submit remaining non-repeatable.

## Package gates

- `npm run test:agent` — exit 0, 11/11 passed.
- `npm run test:storage` — exit 0, 38/38 passed.
- `npm test` — exit 0: typecheck/build passed, contracts 48/48, foundation/protected-file checks 12/12.
- `npm run test:electron` — exit 0: production build and positive Electron self-test passed; invalid-profile, renderer-load, malformed-manifest, and malformed-runtime negative cases passed; cleanup completed.
- `npm run test:sites` — exit 0, 4/4 passed.
- `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort` — preview server started; `GET http://127.0.0.1:5173/` returned HTTP 200; the preview was opened in the Codex browser and the temporary server was stopped.
- Required build outputs exist: `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Corrected failure and ownership decision

No failed repair attempt was hidden. The first code inspection established two independent stale-ref causes:

- the live repeating schedule could revise or replace the shared page;
- even with that collision removed, `AssignmentExecutionCoordinator.#submit` called `browser.snapshot()` immediately before `browser.click(ref)`, and `snapshot()` intentionally expires every prior ref.

The repair therefore does not retry a failed click. Browser ownership blocks the scheduled claim, while the destructive boundary deliberately refreshes and rebinds the control before the durable attempt marker. Once that marker exists, all uncertain outcomes still hand off without another click.

## Subtraction pass

- Kept the wall-clock correction inside the existing scheduler rather than adding a timer abstraction.
- Enforced lease deferral at the existing transactional schedule-claim boundary and reused the kernel's one timer.
- Reused the deterministic answer artifact ID and one small writer for timeout and restart preservation.
- Kept control matching in the existing browser controller, where refs and revisions are owned.
- Added one browser regression and extended the existing lifecycle suite; no fixtures, retry matrices, or speculative recovery cases were added.

## Remaining limits and tester handoff

- This implementer did not rerun the official Playwright MCP disposable-profile scenario. The independent tester should repeat the controlled local daily-schedule/active-review/auto-submit/restart flow and confirm a live verified receipt plus zero page interference.
- Restart deliberately chooses the safe fallback because Chromium form state is not durably restorable from the allowed stored data. It does not persist page HTML, cookies, screenshots, or passwords.
- A scheduled scan already running before a new assignment is started is outside the cycle-one reproduction. The renderer normally serializes its own action, and the repaired invariant specifically prevents a scheduled scan from starting or being claimed while an assignment lease exists.
- Native tray and notification surfaces remain covered by the existing deterministic Electron receipts; no new OS-surface behavior was added.

## Workspace fingerprint

The workspace has no Git metadata. The aggregate is SHA-256 over eight rows of `relative-path<TAB>file-sha256`, in the production/test order listed below, joined with LF and encoded as UTF-8.

- File count: 8
- Aggregate SHA-256: `965fc7f1ce255b0b654b1c34ac00695334dd561c00dc96a3672b79041cd5542e`

Rows:

```text
electron/lifecycle/schedule.ts	6fc41ff108bfe10cfb1829faad2c5e14bb41b2757cdafd212ad52a60b0a15dca
electron/lifecycle/kernel.ts	b022d5a7cfd1cef429336f46a7a3b796e3a487398bd5d9444a5639ce24b7cc24
electron/storage/lifecycle-records.ts	5ef076d687e57a8e5fdb5b588413bcb7ce6ba5ace429a4ad5464b058e4f23197
electron/browser/controller.ts	23717db9fb00b14a2c921ec2bc3ae7f369bdea0eff8f20bfb604ac6b684ab384
electron/assignment/coordinator.ts	4fc7087816102fb648c7a2b954ed3a18ffdb0d0d116c8b0108dbcb957f282306
src/app/StudiApp.tsx	5586961f5cdfd062a337028b0baaff9154e4f77ab5c4af86c1639a98dd686c61
tests/storage/lifecycle-execution.test.mjs	79a3c575dfc6d2e1646c432307175793cd9feb3eac798e44c74357d12bd882a1
tests/agent/browser-controller.test.mjs	dc83ecf5037489b68e89da753db2d911ce77cb854c1ae9acc369d9e0bf92eba3
```
