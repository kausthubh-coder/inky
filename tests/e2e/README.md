# Checkpoint 4 Electron e2e

`bun run test:e2e` builds the real renderer/main process and fake LMS, then launches `dist/electron/main.js` with Playwright's Electron driver. Every profile, LMS database, and homework folder is created under the system temporary directory and removed by the harness. The tests never open a real school.

The harness uses the checkout's `playwright` dev dependency. `STUDI_PLAYWRIGHT_PATH` can point to an existing QA runtime if needed.

The suite uses three narrow, unpackaged-only hooks:

1. `STUDI_E2E_RUNTIME_MODULE`: dynamically import the absolute module and call its exported `createE2eRuntime()` instead of constructing `PiAgentRuntime`. Pass the resulting runtime through the normal manager, scan, assignment, browser-tool, storage, and renderer paths. Reject the hook in packaged builds. The test-owned runtime calls the real tool definitions; it does not seed SQLite or replace IPC.
2. `STUDI_E2E_HOMEWORK_ROOT`: when the real folder-selection command runs, return this directory instead of opening the OS picker, then run the existing empty-folder validation and workspace initialization unchanged. Reject a non-empty or invalid directory normally.
3. `STUDI_E2E_REVIEW_WINDOW_MS`: pass this positive integer to `AssignmentExecutionCoordinator` as the review window so the automatic submission timer can be observed without waiting a full minute. Production and packaged builds must ignore it.

The existing `STUDI_SELF_TEST` identity/profile isolation is reused. No Clerk account, provider login, private profile, production database, or real school session is copied into the run. A missing hook fails the case so a refactor cannot silently substitute seeded data for the real app path.
