# WP-06 cycle 01 implementation

## Changed behavior

- Electron now owns one `ManagerCoordinator` backed by SQLite rather than an in-memory queue.
- Queue entries order by explicit priority, deadline, enqueue time, then task ID. Steering raises one queued task above the current maximum priority.
- Enqueue and lease acquisition resolve stored permission rules from repository-owned confirmed pattern matches. Manager tools accept no pattern identity.
- A singleton SQLite row prevents two browser workers from leasing the visible browser. Interrupted acquisition returns to queued work on reopen. An active working lease resumes its saved Pi worker session.
- The coordinator creates or resumes one durable manager Pi session. New assignment workers are Pi sessions with the manager transcript recorded as their parent.
- Global preference Markdown is loaded on every manager turn. Only requested memory Markdown is loaded, under a separate `Scoped memories` prompt section.
- The manager has three narrow Pi tools: inspect queue, steer an existing queued task, and cancel queued or working work.
- The desktop renderer shows the durable queue and exposes a Codex-backed Pi manager prompt. The old unrestricted manual browser-agent turn is no longer exposed through IPC.
- Storage schema 2 adds confirmed pattern matches, the durable queue, the singleton browser-worker lease, and the singleton manager-session link.

## Files changed

Production:

- `shared/manager.ts`, `shared/index.ts`, `shared/ipc.ts`
- `electron/manager/coordinator.ts`
- `electron/agent/runtime.ts`
- `electron/storage/database.ts`, `electron/storage/manager-records.ts`, `electron/storage/records.ts`, `electron/storage/store.ts`, `electron/storage/index.ts`, `electron/storage/artifacts.ts`, `electron/storage/backup.ts`
- `electron/main.ts`
- `src/app/StudiApp.tsx`, `src/app/app.css`

Focused and contract checks:

- `tests/storage/manager-coordinator.test.mjs`
- `tests/agent/manager-session.test.mjs`
- `tests/storage/storage.test.mjs`
- `tests/contracts/ipc.test.mjs`
- `tests/electron-self-test-runner.mjs`

The workspace has no Git metadata, so a Git fingerprint was unavailable. `npm run test:foundation` confirmed all four protected Sites files remained byte-identical.

## Commands and exit codes

- Baseline `npm run typecheck`: exit 0.
- First `npm run test:storage`: exit 1. Existing schema-version expectations still required version 1 after the approved version 2 migration.
- Second `npm run test:storage`: exit 1. One migration-list assertion still expected only migration 1.
- Final `npm run test:storage`: exit 0, 29 tests passed.
- `npm run test:contracts`: exit 0, 48 tests passed.
- First `npm run test:electron`: exit 1. The Electron observation validator still required storage schema 1.
- Final `npm run test:electron`: exit 0. The packaged renderer, SQLite reopen, Pi session receipt, IPC manifest, and failure cases passed.
- Final `npm run test:agent`: exit 0, 10 tests passed. This includes a real Pi `AgentSession` executing `manager_queue_steer_next` against the durable queue through a deterministic provider.
- Final `npm run typecheck`: exit 0.
- Focused `node --test tests/storage/manager-coordinator.test.mjs`: exit 0, 2 tests passed.
- `npm run test:foundation`: exit 0, 12 tests passed.
- `npm run test:sites`: exit 0, 4 tests passed.
- `npm run build` ran inside the final Electron gate and exited 0. It produced `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Failures fixed

- Updated the existing storage, IPC, and Electron receipts to the version 2 storage and IPC contracts.
- Restart recovery originally called the public enqueue path for an orphaned queued task. The final code reconstructs the durable row directly when permission still allows work and cancels the task when it does not.
- The first manager-record read path trusted duplicated SQLite sort columns after validating only JSON. The final read path rejects disagreement between queue, lease, confirmed-pattern, and session columns and their canonical JSON.

## Subtraction

- Removed the renderer and IPC path that created an unleased browser-driving agent session.
- Kept one coordinator, one manager repository, one manager session, and one active lease row. No provider, job-runner, distributed-queue, plugin, or generic multi-agent layer was added.
- Reused the existing permission resolver, task event stream, artifact store, Pi runtime, IPC registry, and browser tool layer.
- Kept only two focused coordinator recovery tests and one real Pi manager-tool test. Existing gates cover migration, backup, renderer, and protected-file behavior.

## Deliberate omissions

- No LMS discovery, scans, course-pattern clustering, or seeded assignments. WP-07 owns discovery.
- No tray scheduling or notifications. WP-08 owns background scheduling.
- No browser completion, submission, review timer, or Markdown answer fallback. WP-09 owns completion and submission.
- No live OpenAI Codex account turn was run by the implementer. The desktop control and provider check use the real `openai-codex` runtime, while the programmatic Pi proof uses the deterministic provider. The independent tester owns the signed-in provider run.
- No package status, master plan, or conclusion artifact was edited.
