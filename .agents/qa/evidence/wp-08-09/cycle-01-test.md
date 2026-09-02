# WP-08/09 Cycle 01 — Independent User-Like Test

Date: 2026-09-01

Verdict: **FAIL**

Role: independent user-like tester; no production code, tests, plans, dossier, or conclusion artifact changed.

Package dossier: `.agents/plans/packages/wp-08-09-lifecycle-execution.html`

## Outcome

The production Electron build passed the basic close-to-tray, restore, schedule-control, durable-review, Markdown-fallback, and truthful-handoff boundaries. It failed the integrated one-browser lifecycle contract.

A daily schedule created at 10:59 advanced to 11:00, 11:01, 11:02, and so on instead of the next day. Those scheduled scans used the same visible browser while an assignment lease was active. The observed interference reloaded or changed the controlled assignment page, cleared the visible review answer, and invalidated submit references. Three controlled auto-submit attempts ended in the same conservative `needs_user` handoff before any submit effect occurred, so the required verified submission receipt was never produced.

Restart preserved the `ready_review` execution and deadline but reopened the school browser at `about:blank`, so it did not retain the assignment page or its answer.

No real schoolwork was submitted. The existing NC State Moodle profile was inspected only far enough to confirm the already-visible Shibboleth/Duo handoff.

## Test boundary

- Built with `npm run build` — exit 0.
- Launched `electron . --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1` and drove the renderer with the official Microsoft Playwright Electron MCP.
- Used a disposable Electron user-data profile and an ephemeral `127.0.0.1:4311` school page. The page contained review-only, safe submit-receipt, slow-submit, and student-handoff controls. It counted submit effects independently.
- Reused the already-authenticated local Codex provider in the disposable profile. The temporary profile, including its temporary auth copy, was deleted after evidence was retained.
- Restored and left the normal Studi profile running on the loopback CDP endpoint at the end.

## Observed flow

### Close, hide, and restore — pass

1. On the normal profile, Playwright sent `Alt+F4` to the visible renderer.
2. The Electron root process and `127.0.0.1:9222` listener remained alive.
3. Launching a second instance exited without replacing the root process and restored the existing window through the app's single-instance Open path.
4. Pause and Resume schedule controls changed the lifecycle projection between `enabled` and `paused`, then back to `enabled`.

The OS-owned tray menu itself was not inspected. This observation is paired with the existing deterministic Electron receipt for close interception and tray Open handling.

### Attempt-only review and fallback — partial pass, integrated failure

1. The queue showed four controlled tasks and no lease.
2. Starting `task-qa-review` acquired one lease and reached `ready_review` with a 15-minute countdown and `0/2` recovery plans.
3. The durable checkpoint said `Entered 42 for 6 × 7`, and the answer snapshot was `Review answer: 42`.
4. The actual controlled school textbox was empty when inspected. The first daily scheduled scan had fired at the minute boundary and reused the same browser.
5. A production-process restart retained `ready_review`, the same lease, and the pending deadline, but the school browser reopened at `about:blank`.
6. Using a controlled expired-deadline receipt and restarting caused startup reconciliation to move the task to `preserved`, release the lease, leave the next tasks queued, and write a readable Markdown artifact before continuation.

The fallback boundary itself passed. The requirement that completed answers stay in the page through review and restart failed.

Evidence:

- [Ready-review renderer screenshot](./ready-review-before-restart.png)
- [Controlled page snapshot showing the empty review field](./review-page-snapshot.md)
- [Readable saved-answer fallback](./controlled-review-fallback.md)

### Daily schedule and one-browser ownership — fail

The persisted schedule receipt at 11:09 showed:

- cadence `daily`;
- local time `10:59`;
- last claimed occurrence `11:09`;
- next run `11:10`.

The latest notification was `Scheduled school scan failed` with `The current school scan must finish or resume before another scan starts`. This is direct evidence that a daily schedule was being claimed every minute and that a later wake collided with an unfinished scan.

The scheduled scan did not respect the assignment worker's active browser lease. The shared page changed while assignment execution was active, violating the package's single-browser-worker ownership model.

### Explicit auto-submit and receipt — fail safe, no receipt

Three controlled auto-submit runs were attempted:

1. `Controlled auto-submit worksheet`, with a normal answer field and immediate safe confirmation.
2. `Receipt-only controlled acknowledgment`, with no answer field to eliminate fill-induced revision changes.
3. The same receipt-only boundary with a stored preference requiring a fresh snapshot immediately before `browser_submit` and no intervening browser action.

All three reached:

`Submission effect was ambiguous: Stale or unknown browser ref. Take a new snapshot before acting.`

Each run retained its lease and projected `Waiting for you`. The loopback page reported zero `receipt`, zero `simple`, and zero `restart` submit effects, and SQLite contained zero submission receipts. Studi therefore failed safely—no click was mislabeled as submitted—but did not satisfy the required explicit auto-submit outcome.

Evidence:

- [Stale-submit handoff screenshot](./stale-submit-handoff.png)
- [Controlled run receipt](./controlled-run-receipt.json)

### Restart during submission — deterministic receipt passes

`node --test tests/storage/lifecycle-execution.test.mjs` — exit 0, 6/6 passed.

The focused production-boundary test confirmed that a persisted `submitting` execution becomes `needs_user` on reopen, retains the same lease, and does not repeat the destructive click. It also confirmed coalesced missed occurrences in its seeded DST case, attempt-only preservation, fresh permission checks, verified post-submit evidence, permission revocation, and two-plan handoff.

This receipt does not erase the live failure: the production daily schedule created by the renderer did not remain daily, and the live controlled auto-submit path never reached a verified receipt.

### Truthful handoff — pass

- Normal profile: the existing NC State page remained at Shibboleth login and the onboarding state said the student's password and Duo verification were required. No credential was entered.
- Controlled profile: every stale submit reference produced `needs_user`, retained the page lease, displayed the exact error, and created no false receipt.

## Smallest reproductions

### Daily schedule repeats every minute

1. Save a profile with Daily cadence at a time that includes nonzero seconds.
2. Keep Studi running through the next minute.
3. Inspect lifecycle persistence after the scheduled minute.
4. Observe `lastClaimedOccurrence` at the current minute and `nextRunAt` at the following minute rather than the next day.

### Scheduled scan interferes with an assignment lease

1. With the repeating daily schedule enabled, queue an attempt-only assignment on the visible browser.
2. Start it just before the minute boundary and let it reach `ready_review`.
3. Let the scheduled scan wake.
4. Observe the shared browser reload/change while the assignment lease remains active; the visible answer is lost or later refs become stale.

### Restart loses the retained page

1. Reach `ready_review` with a live assignment page.
2. Restart the production Electron process using the same user-data profile.
3. Observe that the execution and deadline persist but the browser is `about:blank`.

### Auto-submit cannot produce a receipt under the live collision

1. Queue an `auto_submit` task on a safe local page with an immediate visible confirmation.
2. Start the task while the repeating scheduled scan is active.
3. Observe the stale-ref `needs_user` handoff, zero submit effects, and no submission receipt.

## Final assessment

**FAIL.** The safe fallback and conservative handoffs work, but the package's core promise does not: schedule ownership is not truly daily, scheduled scans can contend with the active assignment browser lease, restart discards the retained page, and the live explicit auto-submit flow cannot reach a verified receipt. These are concrete package blockers, not polish issues.
