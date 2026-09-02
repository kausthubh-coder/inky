# WP-07 cycle 01 user-like test

Date: 2026-09-01

Verdict: **NEEDS_USER**

The production Electron onboarding path reached a truthful, evidence-backed NC State sign-in handoff. The real school session was not authenticated, so I stopped before entering credentials or pressing resume. This run does not verify courses, assignments, linked systems, successful workflow creation, or replay.

## Build used

- Working directory: `C:\Users\kaust\OneDrive\Documents\dev\studi-2`
- `npm run build`: exit 0.
- The build produced `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
- Launched the built app as `electron . --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1` (PID 46148).
- Electron reported `DevTools listening on ws://127.0.0.1:9222/...`; the listener was loopback-only.
- Connected the configured official Microsoft Playwright MCP server `playwright-electron` and operated the production renderer through accessibility snapshots and semantic controls.

## Exact user steps

1. Opened the built Studi renderer through the Electron CDP target.
2. Observed `Codex is ready` and selected model `GPT-5.6 Terra`.
3. Queried the renderer DOM and observed exactly two inputs: a text input for the student's name and a URL input for the school. `input[type=password]` count was 0.
4. Entered student name `Kaust`.
5. Entered the previously verified NC State course root `https://moodle-courses2527.wolfware.ncsu.edu/course/view.php?id=13261&bp=s`.
6. Selected default work rule `Ask first` (`do_not_attempt`) and scan cadence `Manual`.
7. Clicked `Save and continue`, then `Open school browser`.
8. The visible persistent school browser redirected to the real `NC State Shibboleth Login` page at `shib.ncsu.edu`.
9. Clicked `Run school scan` once. A real Pi session using provider `openai-codex`, model `gpt-5.6-terra`, and Studi's `browser_snapshot` tool observed the Shibboleth page.
10. The Pi session called `scan_request_handoff` with kind `school_sign_in` and reason `NC State Shibboleth login requires the student's password and Duo verification.`
11. Observed the renderer change to `Waiting for you to sign in`, keep all counts at zero, and expose `I signed in, resume` without marking any course, assignment, linked system, coverage, or workflow complete.
12. Stopped without entering credentials, changing the school account, clicking resume, or submitting/changing any schoolwork.

## Provider and real site

- Provider: real cached `openai-codex` authentication.
- Model: `gpt-5.6-terra`, medium thinking.
- Pi session: `01a05d2a-07bb-7598-aa8c-c1511ba840ed`.
- School root: NC State WolfWare Moodle course URL above.
- Observed authentication boundary: real NC State Shibboleth with Duo notice.

## Observations

- PASS: the production renderer had no password field.
- PASS: profile choices persisted as `Kaust`, `do_not_attempt`, and `manual`.
- PASS: the provider was ready and the scan created a real Codex-backed Pi session.
- PASS: the scanner observed the current visible browser page before requesting handoff.
- PASS: the handoff was explicit, evidence-backed, and correctly remained `needs_user`.
- PASS: the UI and SQLite both remained truthful at 0 courses, 0 assignments, 0 linked systems, empty coverage, and no failures.
- PASS: no workflow artifact or revision was created for the incomplete scan.
- NOT RUN: sign-in verification and explicit resume, because the user must enter the password and complete Duo inside the visible school browser.
- NOT RUN: course and assignment discovery, linked-system status, successful workflow write, partial-preservation behavior against live prior rows, and replay re-observation.
- No concrete product failure was observed before the required user handoff.

## Evidence

- Screenshot: `.agents/qa/evidence/wp-07/cycle-01-needs-user.png`.
- State receipt: `.agents/qa/evidence/wp-07/cycle-01-state-receipt.json`.
- Electron stdout: `.agents/qa/evidence/wp-07/cycle-01-electron.stdout.log`.
- Electron stderr/CDP receipt: `.agents/qa/evidence/wp-07/cycle-01-electron.stderr.log`.
- Pi session receipt: `C:\Users\kaust\AppData\Roaming\studi-2\studi-data\pi\sessions\2026-09-01T13-30-30-716Z_01a05d2a-07bb-7598-aa8c-c1511ba840ed.jsonl`.
- SQLite receipt source: `C:\Users\kaust\AppData\Roaming\studi-2\studi-data\studi.sqlite3`, schema migrations 1 through 3.

## Exact user handoff

In the already open Studi window, enter the NC State password and complete Duo only inside the visible NC State Shibboleth browser. Return to the Studi sidebar and click `I signed in, resume`. Do not send credentials through chat.

After resume, this same tester pass must continue through current course and assignment discovery, any linked-system handoffs, successful workflow creation, and one replay that returns to the stored root and re-observes current data.

## Tester boundary

I touched no production code, automated tests, fixtures, plans, conclusions, skills, or prior evidence. A pre/post SHA-256 comparison covered 85 files under `shared/`, `electron/`, `src/`, `tests/`, `.agents/plans/`, `.agents/skills/`, `AGENTS.md`, and `package.json`; no file changed. The only authored evidence is this report, the new state receipt, the new screenshot, and the two new Electron log files for this run. The production Electron process remains open at the sign-in handoff for the user.
