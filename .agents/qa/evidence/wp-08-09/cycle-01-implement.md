# WP-08/09 Cycle 01 — Implementer Evidence

Date: 2026-09-01

Role: fresh implementer

Package dossier: `.agents/plans/packages/wp-08-09-lifecycle-execution.html`

## Outcome

Implemented the approved lifecycle and assignment-execution package directly in the saved project. The app now owns durable schedules, assignment runs, bounded recovery, review windows, submission permission checks and receipts, timeout answer preservation, restart reconciliation, tray/close behavior, and typed renderer controls. Existing state, manager, scan, browser, Pi, SQLite, permission, and artifact boundaries were reused.

No real school submission was attempted. The master architecture plan and package conclusion artifact were not edited.

## Delivered behavior

- Added versioned SQLite records for automation schedules, assignment executions, attempts, notification intents, and submission receipts.
- Added DST-aware wall-clock scheduling, transactional due-run claims, pause/resume state, and wake/resume coalescing.
- Added a single assignment coordinator that retains the active manager lease and browser page through work, recovery, review, submission, preservation, or an honest handoff.
- Capped recovery at two distinct attempts and kept retry history durable.
- Required a fresh stored permission decision immediately before automatic submission.
- Captured pre-submit browser state, durably marked the destructive-effect attempt, and required verified post-submit evidence before issuing a receipt.
- Converted ambiguous submission or restart-during-submit states to `needs_user`; the coordinator does not repeat the click.
- Preserved answer snapshots to a local Markdown artifact before releasing an expired review task.
- Added manual-submission verification from the live page.
- Added application-kernel ownership for close-to-tray, Open/Pause/Quit tray actions, persisted notification intents, focus-on-notification, deadline reconciliation, and schedule timers.
- Added compact renderer controls for schedule state, pause, run/resume, retry visibility, review countdown, handoff, receipt, manual verification, and opening a saved answer artifact.
- Kept the plain-web boundary explicit: lifecycle controls require the desktop preload contract.

## Production changes

- `shared/lifecycle.ts`
- `shared/index.ts`
- `shared/ipc.ts`
- `electron/storage/lifecycle-records.ts`
- `electron/storage/store.ts`
- `electron/storage/index.ts`
- `electron/storage/database.ts`
- `electron/storage/backup.ts`
- `electron/storage/artifacts.ts`
- `electron/browser/tools.ts`
- `electron/agent/runtime.ts`
- `electron/manager/coordinator.ts`
- `electron/assignment/coordinator.ts`
- `electron/lifecycle/schedule.ts`
- `electron/lifecycle/kernel.ts`
- `electron/main.ts`
- `src/app/StudiApp.tsx`
- `src/app/app.css`

## Test changes

- `tests/contracts/ipc.test.mjs`
- `tests/storage/storage.test.mjs`
- `tests/storage/lifecycle-execution.test.mjs`
- `tests/electron-self-test-runner.mjs`

The focused lifecycle suite covers:

1. DST/local wall-clock behavior and a single coalesced claim.
2. Attempt-only review retaining its lease/page while the next task remains queued.
3. Automatic submission with a fresh permission decision and pre/post receipt evidence.
4. Permission revocation immediately before submit blocking the click and producing a handoff.
5. Two distinct failed recoveries producing an honest handoff.
6. Restart during submission producing `needs_user`, retaining the same lease, and not clicking again.

## Verification evidence

Baseline before implementation:

- `npm run typecheck` — exit 0.

Final gates:

- `npm run typecheck; npm run build:electron; node --test tests/storage/lifecycle-execution.test.mjs` — exit 0; focused lifecycle suite 6/6 passed.
- `npm run test:agent` — exit 0; 10/10 passed.
- `npm run test:storage` — exit 0; 37/37 passed.
- `npm test` — exit 0; typecheck and build passed, IPC/contracts 48/48 passed, foundation/protected-file checks 12/12 passed.
- `npm run test:electron` — exit 0; positive self-test passed with contract version 4, storage schema version 4, real Pi probe, browser probe, and lifecycle receipts for the single-instance lock, close-to-hide, and tray Open handling. All malformed-profile, renderer, manifest, and runtime negative cases also passed.
- `npm run test:sites` — exit 0; 4/4 passed.
- `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort` — local preview opened in the in-app browser. The expected desktop-required boundary rendered and the browser console contained no errors or warnings. The temporary server was then stopped.

The final build contains:

- `dist/client/index.html`
- `dist/server/index.js`
- `dist/.openai/hosting.json`

## Corrected attempts

Two implementation-loop corrections are retained as evidence rather than hidden:

- The first scheduling implementation scanned minute-by-minute with `Intl` over a 36-hour range and exceeded the focused test time budget. That run was terminated and the implementation was replaced with a bounded timezone-offset search. The focused suite then passed 6/6.
- The first enhanced Electron check expected a hidden self-test window to become visibly restored from its load callback. That assertion did not exercise the actual boundary and failed twice. It was replaced with deterministic application-kernel receipts for intercepted close, hidden-but-live window state, and handled Open action—the durable main-process boundary prescribed by the project. The full Electron gate then passed.

## Subtraction and quality decisions

- Scheduling ownership is concentrated in one lifecycle kernel and one small wall-clock module.
- Lifecycle persistence uses one repository rather than per-table service layers.
- Assignment execution uses the existing manager lease/session and browser tool layer; it does not introduce a second queue, browser controller, provider session, or permission model.
- The coordinator owns the one destructive submit tool so the generic browser tool registry cannot bypass the fresh-permission and durable-attempt boundary.
- Recovery coverage is scenario-focused; no repetitive per-field tests or speculative abstractions were added.
- Existing manager `finish` semantics were retained for prior package compatibility, while assignment completion uses explicit lifecycle methods.

## Workspace fingerprint

This workspace has no Git metadata, so the implementation fingerprint is a deterministic SHA-256 over the 22 production/test paths listed above. Each row is `relative-path<TAB>file-sha256`, rows follow the order in this report, are joined with LF, and the UTF-8 bytes are hashed.

- File count: 22
- Aggregate SHA-256: `2a1a5166d18fb8ca0c03490a1183c744438f908c48924299441f3c2593a3900e`

The protected Sites handoff files were not edited. The foundation gate's protected-file assertions passed, and the required client/server/hosting build artifacts are present.

## Tester handoff and limitations

There is no implementation blocker.

The independent user-like tester should still exercise the OS-owned tray, native notification click, close/reopen visibility, wake/resume behavior, and a real signed-in provider/browser session through Playwright MCP and the loopback-only Electron CDP endpoint. The Vite preview cannot expose desktop preload APIs, so it only verifies the deliberate desktop-required renderer boundary. A real school site must remain non-destructive: do not submit school work during verification.
