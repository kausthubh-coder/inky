# WP-08/09 Cycle 02 — Final Read-Only Quality Review

Date: 2026-09-01  
Rating: **7/10**  
Verdict: **CHANGES REQUIRED**

## Evidence and quality judgment

The focused repairs are direct and largely well-owned:

- Daily rollover is fixed at the wall-clock calculation itself. `nextScheduleRun` now rejects a same-day occurrence once its minute has passed, while the DST-gap fallback is used only when that local minute does not exist. The focused check and live next-day record support the implementation.
- Due scheduled work is no longer claimed while an assignment lease already exists. The repository leaves the occurrence due, and the existing kernel timer rechecks without advancing or touching the page.
- Review restart is truthful and safe. `AssignmentExecutionCoordinator.#recover` writes the deterministic Markdown artifact before changing the execution to `needs_user`, retains the task lease, and no longer claims Chromium form state survived.
- Submit-control rebinding is narrow and coherent. `BrowserController.refreshRef` takes one fresh snapshot, requires the same URL and exactly one matching role/name, and returns only that fresh ref. The coordinator durably records `submissionAttemptedAt` before the click, so failures and restart hand off without a second destructive attempt. The live retest observed one effect and one receipt.

The code generally follows the quality oracle: existing scheduler, repository, browser controller, artifact writer, permission resolver, manager lease, and kernel timer were extended rather than wrapped in new frameworks. The repair adds no speculative scheduler, retry layer, LMS branch, or compatibility path.

## Blockers

1. **The visible browser still has two owners rather than one shared mutual-exclusion boundary.** `AppKernel.reconcile` defers a scheduled scan only when a manager assignment lease already exists, but the manual `startSchoolScan`, `resumeSchoolScan`, and `replaySchoolScan` IPC paths do not check that lease. Conversely, `AssignmentExecutionCoordinator.startNext` does not check whether `SchoolScanCoordinator` is running. These collisions are reachable from the renderer because scan controls are not disabled by an active assignment lease and assignment controls do not observe a background scheduled scan. The cycle-two live test proves only one direction—due scan while assignment is already leased. A manual scan can still replace a retained review page, and an assignment can still start after a background scan has begun. This leaves the package's one-browser-worker invariant and the root cause of the cycle-one page loss only partially repaired. The fix should establish one small, bidirectional browser-work ownership decision used by every scan and assignment entry point; duplicating more UI checks would not be sufficient ownership.

2. **A click can still become a “verified” receipt without new confirmation evidence.** `AssignmentExecutionCoordinator.#submit` accepts agent-supplied `expectedConfirmationText` and checks only that the post-click snapshot contains it. It never requires that text to be absent from the fresh pre-submit snapshot or otherwise proves a new confirmed state. A no-op or validation-rejected click can therefore be labeled `submitted` if the agent supplies text already visible before the click (for example the submit control's own label). Browser revisions do not close this gap because snapshots/actions deliberately advance revisions even when the page's meaningful state does not. This violates the dossier's “a click alone is never a receipt” invariant. The smallest current fix is to reject confirmation already present in pre-submit evidence and require it to newly appear after the effect; ambiguity must remain `needs_user`.

## Non-blocking follow-ups

- After browser ownership is unified, remove the `activeBrowserTaskId` policy parameter from `LifecycleRepository.claimDueSchedule` if it becomes a second expression of the same decision. The repository should own atomic schedule claiming, not independently interpret browser ownership.
- Keep the current `refreshRef` API narrowly submission-oriented. Its same-URL, single-revision, unique role/name contract pays rent; a generic locator or retry framework would add reader load without improving the approved behavior.

The green live evidence is credible for the scenarios it exercised, but the two blockers are current reachable safety/invariant failures rather than theoretical hardening. Approval requires another focused repair and retest.
