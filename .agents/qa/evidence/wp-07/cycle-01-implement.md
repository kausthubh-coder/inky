# WP-07 cycle 01 implementation

Date: 2026-09-01

Role: implementer. This report does not mark WP-07 verified.

## Working-tree fingerprint

`git status --short` exited 128 because the saved project has no `.git` repository. I used the final SHA-256 inventory below instead of a commit or diff fingerprint.

| SHA-256 | Lines | File |
|---|---:|---|
| `e51fb02900d37f677c0563615277243ff5ce5afc062bae60a871bb85405ebf53` | 108 | `shared/school-scan.ts` |
| `a216b0424f50d73bda370de1fb1502ae18b25a1a0cabb4817f91ad87aaed3559` | 19 | `shared/assignment.ts` |
| `b386feca51a67321ddefec9c53cb6a23f792a57d27f8546e8314b038c1f52059` | 45 | `shared/artifact.ts` |
| `5971b39e4f00d7072ca6dd9b01dbd857de35a96f9011be05c9de87cfd4fcb954` | 15 | `shared/index.ts` |
| `fbfc9f8c5133fa3629230706bd8fb4f36902308493562314b8c584e05318653e` | 338 | `shared/ipc.ts` |
| `980b5544a11d3b3d3ba8da15ccbef2319e14158504b4b9ed0c17658c0d81a67b` | 623 | `electron/storage/database.ts` |
| `e624957ea381a310856a645b773b1fa649dda3ecd7b85322404fddbfa86560fe` | 290 | `electron/storage/school-records.ts` |
| `6a90179bf8c002ad8b9fc9a2151817a9369e827e0259cec8f349d035e80cca83` | 75 | `electron/storage/store.ts` |
| `af8cf0b66a00773b9e348e6a886467fae221867212447a42fae2649d98292a8e` | 16 | `electron/storage/index.ts` |
| `2da45e60b5dd65322ea166dcd04dc986715825eef29f727d0a25f90243af2e39` | 536 | `electron/storage/backup.ts` |
| `1382b99e844a644ab91a79d6d48f16887ada0b1ee590fb8e5ed0d0c0f5170d3c` | 429 | `electron/manager/coordinator.ts` |
| `fbf1842dee44ce693872c9a2ee0849dfe3969e035b6281615ed9bbbef46bcf17` | 843 | `electron/agent/runtime.ts` |
| `9864cf17f1d23152a063f5dbeb801800f00999386445d675d4899701f5000d4a` | 576 | `electron/scan/coordinator.ts` |
| `03ac80cc9e77a60a8f08a597475b62037cf2c4b391d0447eac9f140de113011a` | 702 | `electron/main.ts` |
| `6e21784b4b9cf0d879786011cb2fc2548db747adcd82dd501c338fef7e542a14` | 218 | `src/app/StudiApp.tsx` |
| `ba0ef8dcc6e8b7773dc27abfc1145da9a823892f4ed8dae270669f04b576b5dd` | 47 | `src/app/app.css` |
| `83098bdbfaa3e0a104cf2ee8a59737a9917266e553d8185341182dcee97911e7` | 349 | `tests/contracts/ipc.test.mjs` |
| `b5e296912219f01b139b920a0bb576878b930d5961fb5e6f726d18102ef82762` | 394 | `tests/storage/storage.test.mjs` |
| `fada5fd1fa81bc416fcec88cb67d7617f0409cfb9c9e9069b16c653aa8d97c19` | 226 | `tests/storage/manager-coordinator.test.mjs` |
| `73ea1595fcbe208b8e2662b8b3a5f257a42788ec5315c8562d29416958f6ea72` | 235 | `tests/storage/school-scan-coordinator.test.mjs` |
| `6c859fed0317fbfb51e55311988324101a805347d781dbf2a648151b3a2fb9d8` | 172 | `tests/electron-self-test-runner.mjs` |

The four protected Sites source files were not edited. `npm run test:foundation` checked their byte identity.

## Behavior changed

- Schema 3 adds one local school profile, scan runs, courses, and linked systems. Coverage and failures stay inside the validated scan record. Existing assignments gain optional `lastVerifiedScanId` provenance.
- Saving the profile stores the student's name, safe school root, permission default, cadence, onboarding state, and missed-course corrections. The default also writes the existing global permission rule. Changing the school root drops the prior ready flag.
- `SchoolScanCoordinator` is the only writer for verified school entities and scan terminal state. React receives a read-only projection and can only save the profile, start, resume, replay, or record feedback through the typed IPC registry.
- Pi now creates a real scan session with the existing general browser tools plus five narrow recording tools. Course, assignment, linked-system, handoff, and coverage claims each take a fresh snapshot inside the tool. The tool creates the evidence reference from the current safe browser URL. The model cannot supply evidence IDs or mark a scan complete without the guarded finish tool.
- A school or linked-system sign-in records `needs_user` with browser evidence. The visible browser keeps the credential session. Resume is explicit and tells the same scan session to re-observe the page.
- Successful scans write one versioned Markdown workflow. Replay always opens the profile root before giving Pi the prior workflow as hints. Partial and zero-result scans keep prior rows, remain incomplete, and do not write a workflow. A workflow write failure changes the scan to partial.
- Linked systems remain `needs_user` until a later current-page observation records them as verified.
- Missed-course feedback updates the local profile and increments the workflow revision so the next replay receives the correction.
- Re-enqueuing an existing WP-06 task without a supplied priority now preserves its manually steered priority and original enqueue time.
- The renderer now shows the first-run setup, runtime state, visible sign-in handoff, polled scan step, verified counts, failures, linked-system status, replay action, missed-course feedback, course assignments, and the existing durable queue summary. It has no password input.

## Production files

New:

- `shared/school-scan.ts`
- `electron/storage/school-records.ts`
- `electron/scan/coordinator.ts`

Changed:

- `shared/assignment.ts`
- `shared/artifact.ts`
- `shared/index.ts`
- `shared/ipc.ts`
- `electron/storage/database.ts`
- `electron/storage/store.ts`
- `electron/storage/index.ts`
- `electron/storage/backup.ts`
- `electron/manager/coordinator.ts`
- `electron/agent/runtime.ts`
- `electron/main.ts`
- `src/app/StudiApp.tsx`
- `src/app/app.css`

## Programmatic checks

New:

- `tests/storage/school-scan-coordinator.test.mjs` covers school and linked-system handoffs, explicit resume, verified persistence, workflow creation, replay from root, re-observation, partial preservation, zero-result failure, missed-course revision, page-text exclusion, and secret-shaped source rejection.

Changed:

- `tests/storage/manager-coordinator.test.mjs` now proves re-enqueue preserves manual priority.
- `tests/contracts/ipc.test.mjs` records the version 3 typed registry.
- `tests/storage/storage.test.mjs` and `tests/electron-self-test-runner.mjs` record schema 3.
- The Electron self-test now records that the real renderer has a name field, school URL field, scan action, and zero password fields.

## Commands and exit codes

Baseline before implementation:

- `npm run typecheck`: exit 0.
- `npm run test:storage`: exit 0, 29 tests.
- `npm run test:agent`: exit 0, 10 tests.
- `npm run test:electron`: exit 0, positive and four negative receipts.

Final after the subtraction pass:

- `npm test`: exit 0. This ran typecheck, build, 48 contract tests, and 12 foundation tests.
- `npm run test:storage`: exit 0, 31 tests.
- `npm run test:agent`: exit 0, 10 tests.
- `npm run test:electron`: exit 0. The receipt reported Electron 37.10.3, Node 22.21.1, schema 3, contract 3 with 14 methods, real Pi self-test session persistence and resume, the bounded visible browser, the onboarding UI fields, and zero password fields. All four rejection paths passed.
- `npm run test:sites`: exit 0, 4 tests.
- Local preview: Vite opened at `http://127.0.0.1:5173/` in the in-app browser. Its web-only state correctly displayed "Open the desktop app to use the school browser." The server was then stopped. The actual onboarding UI requires Electron's preload and was checked by the Electron receipt; the independent tester still owns user-like Electron testing.

Build left `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json` in place.

## Failed attempts and fixes

- First `npm run test:contracts`: exit 1, 47 of 48 passed. The fixed IPC snapshot still described contract 2. Updated the existing contract receipt for the six approved WP-07 methods and contract 3.
- First `npm run test:storage`: exit 1, 28 of 31 passed. Two inherited schema expectations still said 2. The new comprehensive test also let a failed assertion keep SQLite open, so cleanup hid the assertion. Updated schema expectations, closed the coordinator and store in `finally`, then ran the focused test.
- First focused scan test: exit 1. All test timestamps were identical, so ordering scans by timestamp and random ID could select the prior partial scan. Changed the repository's latest-scan query to creation order using SQLite `rowid`. The focused test then passed 2 of 2.
- One `npm run typecheck`: exit 1 after the workflow-failure subtraction change because the finish result remained `const`. Changed it to `let`; the next typecheck passed.
- One `npm run test:electron`: exit 1 after the positive receipt because the inherited renderer-load rejection exceeded its outer timeout. Running the already-built self-test alone exited 0 with all positive and negative receipts. The final full `npm run test:electron` also exited 0 without a timeout, so no timeout or production behavior was changed.

## Subtraction and design review

- Kept one coordinator instead of adding a workflow engine, LMS adapter, scan state machine framework, evidence service, or second repository abstraction.
- Reused the existing browser controller, browser tools, Pi session creation, assignment repository, artifact store, permission rule repository, SQLite validation, and typed IPC factory.
- Removed the redundant post-session workflow writer. The guarded finish tool owns the single workflow write, and a write failure leaves the scan partial.
- Kept mutable scan-session state inside the coordinator. SQLite owns durable scan truth. React derives counts and groups assignments without duplicating operational state.
- The source audit found no LMS name or seeded-data path in production. Password references only reject or describe credential handling. No password field exists.
- Every added table, method, tool, and test supports an approved WP-07 behavior or the WP-06 priority correction.

## Deliberate omissions and remaining proof

- No LMS-specific scanner, fake production schoolwork, seeded dashboard data, scheduler, tray lifecycle, notification, assignment worker, submission, fallback answer, pattern framework, generic workflow engine, or cloud school-data path was added.
- No password, cookie, authorization header, page HTML, or screenshot is written by the new storage path. The focused test proves its synthetic page text is absent from both SQLite and the workflow artifact.
- This implementer used scripted tool execution for deterministic failure and persistence checks. It did not claim a real signed-in school scan. The manager's separate user-like tester must use the official Playwright MCP through Electron's loopback CDP endpoint, complete the visible browser handoff against the available real school, and retain the observed coverage. The later read-only reviewer owns the quality verdict.
- The saved project is not a Git repository, so the manager must use this hash inventory and direct source inspection instead of a Git diff.
