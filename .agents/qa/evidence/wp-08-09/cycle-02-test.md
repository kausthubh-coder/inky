# WP-08/09 Cycle 02 — Independent User-Like Retest

Date: 2026-09-01

Verdict: **PASS**

Role: fresh independent live retester. No production code, automated tests, plans, dossier, or conclusion artifact changed.

Package dossier: `.agents/plans/packages/wp-08-09-lifecycle-execution.html`

## Outcome

All four former live blockers passed after the cycle-two repair, and close/hide/restore passed again.

- A daily schedule saved at 11:29:51 local time selected 11:29 on the next local day, not the next minute.
- A due occurrence remained due and unclaimed while `task-cycle02-review` owned the browser. The controlled page stayed at `/review` with answer `42` before and after the claim boundary.
- Attempt-only reached `ready_review` with `42` visibly retained and no submission effect. Restart then truthfully changed to `needs_user`, retained the task lease, saved readable Markdown, and exposed **Open saved answers** while the browser reopened at `about:blank`.
- Explicit auto-submit refreshed and re-identified the controlled submit button, produced exactly one loopback submit effect, and persisted one verified receipt with fresh pre/post evidence.
- An OS `WM_CLOSE` hid the window while the root process and loopback CDP listener remained alive. Starting a second instance exited cleanly and restored the existing window.

No real schoolwork was submitted and no credentials were entered.

## Live boundary

- `npm run build` — exit 0. Production Electron, client, server, and Sites handoff outputs built successfully.
- Launched `electron . --user-data-dir=<disposable profile> --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1`.
- Drove the renderer and embedded school WebContents with the official Microsoft Playwright Electron MCP, using accessibility snapshots and semantic locators.
- Used an isolated temp profile with a temporary copy of the existing local Codex credential and an ephemeral school page bound only to `127.0.0.1:4322`.
- Used production storage/manager repositories only to seed two discovered controlled tasks into the durable queue; task execution, browser work, permissions, scheduling, restart reconciliation, receipts, and renderer projections ran through the production app.

The first scan attempt was conservatively partial because the disposable fixture's link text contained `auto-submit`, which the browser layer correctly treated as a submission control. I renamed only that fixture link to `Controlled color worksheet` and reran; the production scan then completed with one course and two currently verified assignments. This was a fixture correction, not a product change.

## Former blocker 1 — daily schedule rollover: pass

The setup form saved a daily schedule at `2026-09-01T15:29:51.548Z` (`11:29:51` America/New_York). The durable record was:

- cadence `daily`;
- local time `11:29`;
- next run `2026-09-02T15:29:00.000Z`.

The nonzero seconds therefore advanced to the next eligible local day. No same-day minute-by-minute recurrence appeared.

## Former blocker 2 — due scan and browser ownership: pass

While `task-cycle02-review` held the active lease, the controlled occurrence was made due at `2026-09-01T15:36:45.362Z`. The production durable claim returned `null`, left `nextRunAt` unchanged and due, and left `lastClaimedOccurrence` unset. Startup reconciliation observed the same due occurrence with the retained lease and did not create a scan notification or advance the occurrence.

Playwright sampled the embedded page on both sides of the claim:

```json
{ "url": "http://127.0.0.1:4322/review", "answer": "42" }
```

The URL and answer were identical after the claim. The scheduled work neither touched nor reloaded the page.

## Former blocker 3 — attempt-only and restart fallback: pass

The live agent entered `42` for `6 × 7`, left the submit button untouched, and recorded `ready_review`. The renderer showed the active lease, `0/2` recovery plans, and a 15-minute review countdown. The loopback server's only submit effect occurred later during the explicit auto-submit task, so attempt-only produced zero effects.

After a production-process restart with the same disposable profile:

- browser: `about:blank`;
- execution: `needs_user`;
- lease: still `task-cycle02-review`;
- answer snapshot: `Answer to 6 × 7: 42`;
- handoff: explicitly said the page could not be retained;
- renderer action: **Open saved answers**;
- Markdown: [cycle-02-restart-fallback.md](./cycle-02-restart-fallback.md).

This matches the repaired contract: do not pretend Chromium form state survived; preserve the answer and hand it back honestly.

Evidence: [ready-review screenshot](./cycle-02-ready-review.png).

## Former blocker 4 — explicit auto-submit: pass

The profile rule was changed through the setup form to `auto_submit`, the browser was placed on the safe `/submit` page, and the second task was started from the renderer.

Observed durable receipt:

- one loopback submit effect;
- one SQLite submission receipt;
- pre-submit revision `7` at `/submit`;
- post-submit revision `10` at `/submit-effect?`;
- verified status `Submitted successfully`;
- final task phase `submitted`;
- lease released and queue empty.

The control was therefore rebound across fresh evidence and activated exactly once. No stale-ref handoff or duplicate click occurred.

Evidence: [submission receipt screenshot](./cycle-02-submission-receipt.png) and [machine-readable receipt](./cycle-02-receipt.json).

## Close, hide, and restore: pass

Playwright keyboard dispatch did not reach the native window chrome, so the closest OS boundary sent `WM_CLOSE` to the Electron root window. The main process intercepted it:

- root process remained alive;
- `127.0.0.1:9222` remained listening;
- lifecycle projection reported `windowVisible: false`.

Launching a second instance with the same profile exited 0 and the original projection changed to `windowVisible: true`. This rechecks the close-to-tray and single-instance Open path without using screenshot coordinates.

## Final assessment

**PASS.** The four cycle-one blockers are no longer reproducible. Schedule rollover is daily, a leased assignment blocks and coalesces due scan work without page interference, restart preserves answers through a truthful local fallback, and explicit auto-submit reaches one verified receipt from exactly one safe effect. Close/hide/restore also remains intact.

