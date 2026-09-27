# Studi handoff (2026-09-27)

Context for a new thread. Worktree `C:\Users\kaust\.t3\worktrees\studi-2\t3code-7b59ae23`, branch `t3code/learn-redo`.

## What Studi is
Electron + React desktop app. The engine (`desktop/electron`) owns all data (SQLite plus Markdown notes); the screens (`desktop/src`) only show it. Convex handles accounts only. The agent runs on the Pi SDK, using GPT-6 Sol through the student's ChatGPT plan.

## Done in this thread (latest first)
- `507094d`, `ac4752e`: `docs/redesign/homework-plan.html`, with Now/New mockups of the week and assignment page, Dot, and the new icon.
- `b3ad188`: single sign-on hand-off pages are recognised, so they're never saved as documents. Sign-in requests open the system's sign-in page. Moodle calendar rows are plain text.
- `9dcc6c2`:
  - context is shortened in batches, so the prompt cache holds (run 5: 6% uncached, about $2 per setup scan);
  - the scan and the Learn document reader update exams by id;
  - documents behind single sign-on are read;
  - a quiz-page fallback reads quizzes the lists miss;
  - the agent can state what a status means;
  - the read-only guard allows sign-in steps and a posted page load after a plain link click.
- Earlier: scan v2 (`0bd302c`), real-scan fixes (`4cf4327`, `d155c03`, `4c25a67`), CP5/CP7.

## Real-school results (WolfWare, read-only)
- **Run 5 setup scan:** 12.8 min of work, about $1.98, 49 items. ST 370's WebAssign past homework was read with scores, 9 exams with no duplicates, and class notes include sections.
- **Known leftovers:**
  - the CSC 316 syllabus site is only reachable on NC State's network;
  - some items have no dates in Moodle at all.
- **Test profiles:** `C:\Users\kaust\AppData\Roaming\Studi Real Test 5` is the latest. To give the app back to the student's account, release their device in Convex with `npx convex run account:releaseDevice '{"deviceId":…}' --identity '{"subject":"user_3IrCkdRGy1RVfPbxJO1Ydgge2kx","issuer":"https://clerk"}'` from `C:\Users\kaust\OneDrive\Documents\dev\studi-2`.
- **Helper scripts** in `.agents/tmp`:
  - `real2/watch.mjs` (progress; set the `PROFILE` env var);
  - `real2/usage.mjs "<profile>"` (cost);
  - `real2/trace.mjs "<profile>"` (steps).

## Next work (agreed scope)
1. **Icon and characters.** Build the yellow S icon and Dot/Chalky from `C:\Users\kaust\.t3\worktrees\studi-2\t3code-89eac3bf\.agent\plans\characters-and-icon.html`. The drawing code is extracted in `docs/redesign/characters.js` and `characters.css`. Target files: `desktop/shared/characters/rig.ts`, `states.ts`, `desktop/src/app/Character.tsx`, `characterMotion.ts`, and replacements for the `assets/studi-inky.*` icons. Open question: does Inky stay on loading screens, or is it Dot everywhere?
2. **Staying signed in.** Keep sign-in cookies that are lost when the app quits (store them encrypted, restore on launch). Touch sessions while Studi runs in the tray (Moodle `core_session_touch` is already allowed as read-only). Remind the student to tick "remember this device". When the school forces a sign-out: notify once, carry on with everything else, and resume after sign-in.
3. **Week, list and chat redesign**, in the real components, checked in the UI preview (`node scripts/preview-ui.mjs`, then `?preview=gallery`). Screenshots of today's week and assignment screens are in `docs/redesign/homework-now/`; the list view and chat can be seen in the preview (`?preview=week`, then List, or open the chat box).
   - **Week:** keep the feel. The headline gives the one fix needed, cards say one plain thing, done work moves into All work.
   - **List:** groups (Needs you / This week / Later), one action per row, "Something wrong?" in one menu.
   - **Chat:** a sheet rising from the chat box, with no tabs. Remove the repeated "Session finished / View session" lines, show the context label only when it changes, and offer suggestions when empty.
   - The user wants bigger changes here, not minimal ones.
4. **Testing and recording.**
   - Fake-school scenarios (`agent-harness/lms`) with many kinds of work and failure injection: sign-out mid-run, slow pages, moved dates.
   - A per-build scorecard: found, correct dates and statuses, time, cost, errors.
   - PostHog for the private beta: a consent screen, full screen replay of Studi (today it's off and text is masked, in `desktop/src/telemetry/renderer.ts`), and every scan step, error and cost. Passwords and sign-in codes stay hidden.
5. **Learn with Chalky**, from `docs/redesign/learn-plan.html`.

## Not included
Autonomous completion and submission of graded work, and features to hide AI involvement, were declined in this thread and are not part of this plan.

## Working rules the user set
- Explain before changing code during real-school tests.
- During test runs, only monitor and report.
- General mechanisms, not special cases.
- No UI slop: no sidebars, pills or busy cards; one leading button per screen.
- Real schools are read-only.
- Never use bare `git stash`, and don't push unless asked.
- The student's NC State password was shared in the earlier thread. Recommend changing it.

## Uncommitted in the worktree
- The GPT-6 Sol tester's harness edits (`agent-harness/benchmark/*`, `agent-harness/lms/*`), not reviewed.
