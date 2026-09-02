# WP-08/09 Cycle 03 — Independent Live Retest

Date: 2026-09-01

Verdict: **PASS**

Role: narrow independent live retester. No production code, automated tests, plans, conclusions, or prior reviews changed.

## Boundary and runtime

- `npm run build` — exit 0.
- Production Electron ran with `--remote-debugging-address=127.0.0.1 --remote-debugging-port=9222` and isolated disposable user-data profiles.
- The official Microsoft Playwright Electron MCP drove the renderer and visible school `WebContents` through accessibility snapshots, semantic controls, and the preload IPC boundary.
- The school fixture was bound only to `127.0.0.1:4323`; it contained no credentials or real schoolwork.
- The existing authenticated Studi runtime credential was copied temporarily without inspecting its contents. Every disposable profile was removed after the run.

## One visible-browser owner — pass

### Assignment review blocks every scan entry

The production assignment worker opened the controlled `/review` page, retained answer `42`, and reached `ready_review` with lease `task-cycle03-review`. This re-proved the inherited attempt-only happy path.

While that review owned the visible browser, the three manual IPC entries returned:

```text
startSchoolScan  -> Assignment task-cycle03-review must finish before a school scan can start
resumeSchoolScan -> Assignment task-cycle03-review must finish before a school scan can resume
replaySchoolScan -> Assignment task-cycle03-review must finish before a school scan can start
```

A daily schedule was then armed for a loopback occurrence due at `2026-09-01T16:10:13.655Z`. After the timer fired:

- `nextRunAt` remained the same due occurrence;
- `lastClaimedOccurrence` remained absent;
- no scan row was created;
- the lease remained `task-cycle03-review` in `ready_review`;
- Playwright still observed `{ url: "/review", answer: "42" }`.

### Running scan blocks assignment start

With durable scan `scan-cycle03-active` in `running`, starting queued task `task-cycle03-scan-block` returned:

```text
School scan scan-cycle03-active must finish before an assignment can start
```

The manager lease and assignment execution both remained `null`, the queue remained at one task, and Playwright still observed `/scan-root` with heading `Safe loopback school root`.

## Submission evidence boundary — pass

### Confirmation already visible: zero effect

On `/preexisting`, `Submitted successfully` was visible before the only submit control. Production auto-submit moved `task-cycle03-preexisting` to `needs_user` with:

```text
The claimed submission confirmation was already visible before the submit control was used.
```

The loopback effect count was `0`, `submissionAttemptedAt` was absent, and the durable submission receipt was `null`. The retained task lease remained active for student handoff.

### Newly appearing confirmation: exactly one effect and receipt

On corrected `/fresh`, the expected phrase was absent before the effect. Production auto-submit activated the single safe control once. The loopback count was exactly `1`, the queue became empty, and the lease released.

Durable receipt:

```json
{
  "taskId": "task-cycle03-fresh",
  "phase": "submitted",
  "receiptCount": 1,
  "receiptId": "receipt-997a0d09-a723-414f-b020-e20ff097a400",
  "preSubmit": { "revision": 5, "url": "http://127.0.0.1:4323/fresh" },
  "postSubmit": { "revision": 8, "url": "http://127.0.0.1:4323/effect-fresh?" },
  "verifiedStatus": "Submitted successfully"
}
```

Evidence screenshot: [cycle-03-fresh-receipt.png](./cycle-03-fresh-receipt.png)

The first fresh fixture draft accidentally included the exact confirmation phrase in its own instruction text. Studi correctly refused that attempt with zero effects. I removed only that phrase from the loopback fixture and reran in a new disposable profile; no product code changed.

## Final assessment

**PASS.** The repaired ownership decision is bidirectional across manual, replayed, resumed, scheduled, and assignment entry points. The confirmation gate distinguishes pre-existing text from a newly observed post-effect state: the former produces zero click and zero receipt, while the latter produces exactly one controlled effect and exactly one verified receipt. No real schoolwork was submitted and no credentials were entered.
