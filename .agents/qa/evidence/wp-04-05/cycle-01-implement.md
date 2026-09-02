# WP-04 + WP-05 cycle 01 implementation

Implemented the approved visible browser-agent path. Electron now owns one persistent `WebContentsView` and one CDP controller. Pi receives eight named Studi tools that operate that same view. The desktop UI can open a school URL, start the built-in `openai-codex` OAuth flow in the system browser, select an installed Codex model, and run a Pi agent turn.

The controller returns accessibility snapshots capped at 80 interactive elements and 8,000 text characters. Each snapshot creates a new revision, so older refs fail closed. HTTP credentials and non-HTTP navigation are rejected. Ordinary click refuses known submission controls. Enter also refuses to run when the focused control could submit a form. Only `browser_submit` accepts a submission ref, and its schema requires the literal confirmation `SUBMIT`.

The first Electron smoke exposed a self-test race: the renderer requested workspace state before the desktop Pi runtime existed. Startup now creates the view and runtime before loading the renderer. The final smoke had no handler error.

## Evidence

- `npm run typecheck` exited 0.
- `npm run test:agent` exited 0. Nine tests passed, including bounded snapshots, stale refs, click and Enter submission separation, URL checks, and a real Pi session with exactly the eight browser tools.
- `npm run test:contracts` exited 0. All 49 contract tests passed after adding the fixed workspace IPC methods.
- `npm run test:foundation` exited 0. All 12 clean-room, build-shape, and protected-file checks passed.
- `npm run test:electron` exited 0. The packaged receipt recorded `web-contents-view`, `visible-school-browser`, `about:blank`, `bounded: true`, and a positive revision. Renderer, storage reopen, Pi probe, and negative startup cases also passed.

No storage or Sites-only suite was repeated. The Electron smoke performed the required production build and prepared the existing Sites output as part of its unchanged command.

## Tester handoff

The programmatic checks do not claim a live provider or LMS result. A separate tester still needs to launch Studi, complete the real Codex subscription login, enter the user's Moodle URL, let the user sign in inside the visible browser, run a safe page-navigation request, restart Studi, and confirm both stored authentications remain usable. No automatic submission should occur during that proof.
