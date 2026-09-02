# WP-12 implementer evidence

Date: 2026-09-01

Role: user-visible implementer task. This report records implementation evidence only; it is not the package conclusion.

## Delivered behavior

- Replaced the narrow renderer with the complete typed desktop journey: auth gate, runtime-first onboarding, local profile and scan scheduling, visible school-browser handoff, evidence-backed scan progress, weekly dashboard, manager command bar, active task desk, Library, Settings, and contextual feedback.
- The weekly dashboard renders only repository-backed assignments. Partial scans remain visibly partial and no production path creates demo schoolwork.
- The active task desk projects the durable task, run, event, tool, attempt, evidence, receipt, and artifact records beside the real `WebContentsView`; takeover, resume, cancel, review, and artifact actions cross typed IPC.
- Settings persist review/handoff defaults and memory visibility, manage global/course/pattern/assignment permission rules, configure the scan schedule, expose the selected runtime, and retain the telemetry controls.
- Library returns task and artifact metadata first; artifact content crosses IPC only after the student requests a specific record.
- Added a self-test-only UI scenario switch for partial-dashboard and needs-user desk states. The production renderer has no scenario or seeded-data branch.

## Main implementation surfaces

- `shared/product.ts` and `shared/ipc.ts`: strict product projection schemas and IPC contract version 7.
- `electron/storage/product-preferences.ts`: validated, versioned, atomic local preference storage.
- `electron/main.ts`: typed handlers, product projections, native browser layout modes, and bounded deterministic UI capture fixtures.
- `electron/lifecycle/assignment-execution-coordinator.ts` and `electron/manager/manager-coordinator.ts`: live activity projection plus takeover/cancel behavior.
- `src/app/StudiApp.tsx`, `OnboardingScreen.tsx`, `WorkspaceScreens.tsx`, `DeskScreen.tsx`, `Ui.tsx`, and `app.css`: clean-room React product surface using cream dotted paper, dark hand-drawn borders, Shantell Sans headings, Nunito Sans body copy, and the approved course palette.
- `tests/storage/product-preferences.test.mjs`, `tests/contracts/ipc.test.mjs`, and `tests/electron-self-test-runner.mjs`: focused persistence, boundary, real Electron, password-field, landmark, and keyboard-focus checks.

## Visual inspection

- `partial-dashboard-1440x900.png`: truthful partial-coverage warning, manager bar, and five-day assignment layout at 1440×900.
- `desk-handoff-1120x760.png`: active-only desk, needs-user handoff, plan/transcript/evidence, and visible browser split at 1120×760.
- `settings-1280x800.png`: work defaults, schedule, permission rules, runtime, and telemetry at 1280×800.
- `library-1280x800.png`: task/artifact index with content-on-request empty state at 1280×800.

The paired `.log` files contain the successful Electron scenario receipts. Visual review found no clipped content, overlap, illegible contrast, or missing navigation affordance in the captured states.

## Verification

- `npm run typecheck` — pass.
- `npm run test:contracts` — 48/48 pass.
- `npm run test:storage` — 41/41 pass, including new preference persistence coverage.
- `npm run test:agent` — 11/11 pass.
- `npm run test:auth` — 6/6 pass.
- `npm run test:telemetry` — 4/4 pass after correcting sign-out so renderer telemetry resets before the sign-out IPC call.
- `npm test` — pass: typecheck, production build, 48 contract tests, and 12 foundation/protected-file checks.
- `npm run test:sites` — 4/4 pass; the protected handoff still produces `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
- `npm run test:electron` — pass, including real Electron/SQLite/Pi/browser/tray observations, IPC contract version 7, zero renderer password fields, one main landmark, seven interactive controls, and successful programmatic focus movement.

The production build retains one existing Vite advisory for the 663 kB Pi runtime chunk; it is non-blocking and not a WP-12 behavior failure.

## Subtraction and truthfulness pass

- Removed the unreachable post-scan “Open this week” control; successful/partial scans already transition through the repository projection to the dashboard.
- Kept deterministic scenario seeding behind both `STUDI_SELF_TEST=1` and an explicit scenario name.
- No LMS UI, password input, production assignment seed, renderer-owned task truth, arbitrary IPC invocation, or extra abstraction layer was added.
- Protected Sites handoff files passed byte-identity checks.

## Known boundary

The Settings surface persists the handoff reminder duration for the next timer-oriented runtime package; WP-12 does not invent an Electron timer that the approved domain contract does not yet expose. Review timing, schedule changes, and permission rules do affect current runtime behavior.
