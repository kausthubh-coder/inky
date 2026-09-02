# WP-06 cycle 01 user-like test

## Verdict

Pass. The built desktop app completed a real `openai-codex` Pi manager turn, truthfully reported the empty durable queue, and reopened with the same queue state. The existing deterministic coordinator control passed the non-empty ordering, restart, and single-lease cases that the live empty queue could not exercise.

## Build used

- Workspace: `C:\Users\kaust\OneDrive\Documents\dev\studi-2`
- Date: 2026-09-01, America/New_York
- `npm run build`: exit 0
- `dist/electron/main.js`: SHA-256 `3814B670F0E40D245D2FE75CAFE26D755AD87D9511A7CB387B88CD5FE77A800D`
- `dist/electron/preload.cjs`: SHA-256 `0195C57FB74DE594C49FFE91E27D465AAEB2CE6B2639E9960FFC6F94731F6AD7`
- `dist/client/index.html`: SHA-256 `5E5B31087E41969F0F0DA4D9D361AF69C995C866C38120BAA98D02FEE81747BC`
- The workspace has no Git metadata, so I could not record a commit or dirty-tree fingerprint.

## Live student flow

1. Built the current workspace with `npm run build` and opened the built Electron app.
2. Read the left control panel before acting. It showed `Codex connected`, `OpenAI Codex is ready to use.`, model `GPT-5.6 Terra`, `0 queued`, and `No assignment is waiting`.
3. Left the default prompt unchanged: `Inspect the durable queue and tell me what should run next.`
4. Clicked `Run manager turn` in the Electron UI.
5. Waited for the UI result and read the queue again.

Observed result:

- The manager outcome was `COMPLETED`.
- The exact visible answer was: `The durable queue is empty, so nothing is scheduled to run next.`
- The durable queue remained `0 queued` with `No assignment is waiting` and no worker lease.
- This is the correct WP-06 result because WP-07 discovery has not populated assignments. The model did not invent work or claim a steering action.
- User-supplied live proof screenshot: `C:\Users\kaust\AppData\Local\Temp\codex-clipboard-66f9f92b-f8bb-42c6-9a78-2b89c09dbfee.png`, SHA-256 `FF864A88FDAAFC87DC90D4B344093FDDF749465DABCF0ED15B9475F8454A1C4C`.

## Restart and lease proof

After the first Electron process ended, I launched the same built app again against its normal local data directory. On reopen, the UI reported `Codex connected`, `0 queued`, `No assignment is waiting`, and no browser-worker lease. That is the same durable queue ordering visible before restart. An empty live queue cannot demonstrate competing starts, so I ran the existing focused coordinator control without changing it:

```text
node --test tests/storage/manager-coordinator.test.mjs
```

The command exited 0. Both tests passed in 3.37 seconds.

The first case used the built coordinator and a temporary file-backed SQLite store. It queued two equal-deadline tasks in stable order, steered the second task to the front, refreshed permission at start, cancelled the newly denied task, leased the allowed task, and rejected a second `startNext()` while that lease was active. It then closed and reopened the store, reproduced the exact saved manager state and active lease, resumed the worker and manager sessions, and rejected another competing start. Finishing the leased task released the lease and exposed the same next queued item.

The second case wrote an interrupted `acquiring` lease, closed SQLite, reopened it, cleared the orphaned lease, and restored the same task as the durable next item in `queued` state.

## Failures and limitations

- No WP-06 failure reproduced.
- The live profile had no discovered assignments, so non-empty ordering and lease contention could not be exercised from the renderer. The existing deterministic control is the closest available real boundary for those states.
- The first app instance showed the already signed-in CSC 217 Moodle page. The restarted instance opened its browser at `about:blank`. Browser-page restoration is outside WP-06, and I did not treat it as queue evidence.
- Future Electron testing should use a dedicated Electron/CDP MCP or Studi app-control channel. The supplied screenshot and focused restart/lease receipts were sufficient for this package.
- I did not test LMS discovery, browser completion, tray scheduling, or submission. Those belong to later packages.

## File discipline

I touched no production, test, or fixture files. I did not edit package plans or conclusions. This evidence note is the only file I added; `npm run build` refreshed generated files under `dist/`.
