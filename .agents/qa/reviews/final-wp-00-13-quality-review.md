# Final WP-00 through WP-13 quality review

Date: 2026-09-02  
Role: final read-only whole-repository reviewer  
Verdict: **changes_required**  
Quality score: **6.5/10**

## Decision

The repository has a sound set of main-process owners, but the current private-beta loop is not connected end to end. A scan can populate the weekly dashboard without creating any executable task, and the scan recording tools can label model-supplied claims as verified without proving that those claims appeared in the browser snapshot. Those are current release defects, not requests for more hardening or test coverage.

Do not accept WP-00 through WP-13 as a complete private-beta implementation yet. Run one narrow repair pass covering the two findings below, then repeat the real signed-in scan through queue intake and one safe assignment attempt.

## Ownership assessment

The important owners are mostly clear:

- `AuthCoordinator` owns Clerk tokens, entitlement evaluation, offline approval, and sign-out. `projectProtectedAuthState` now keeps approved auth hidden until the existing protected runtime is ready. There is no second renderer auth state machine.
- `LocalStore` owns one SQLite root and one artifact root. Task events remain the durable task history, projections remain rebuildable, and backup/migration reuse the same validation and restore path.
- `BrowserController` owns the visible `WebContentsView` mutations. `VisibleBrowserWork` combines the short in-process reservation with the durable manager lease and scan state. There is no hidden second browser or second queue.
- `ManagerCoordinator` owns queue order and the single worker lease. `AssignmentExecutionCoordinator` adds execution detail without introducing another queue. The task event stream still carries the canonical task state.
- `SchoolScanCoordinator` owns scan state and the workflow artifact. The problem is not duplicate ownership. It is that its evidence check is too weak and its output never enters the task owner.
- `TelemetryService` owns the typed main-process event boundary and scrubbed inspector. Renderer replay is a separate SDK client because it records only the Studi renderer. Both share consent and identity through the existing projection.
- Forge owns the packaged tree. The portable ZIP is honest evidence for the current unsigned beta transport. It does not prove a native installer, and the retained reports correctly avoid that claim.

The auth, local data, browser, lifecycle, telemetry, and packaging code therefore do not need an architectural rewrite. The current defects sit at the seams between already valid owners.

## Blocking finding 1: scan claims are attached to a snapshot but not proved by it

`scan_record_course`, `scan_record_assignment`, and `scan_record_linked_system` accept a model-supplied label, title, due date, or state, take any fresh snapshot, and write the claim as verified evidence. They never check that the claimed course, assignment, linked system, or due date is present in the snapshot. See `electron/scan/coordinator.ts:270`, `electron/scan/coordinator.ts:302`, and `electron/scan/coordinator.ts:344`.

`scan_finish` has the same weakness. A free-form coverage target with status `verified` receives evidence from the current page even when the target is unrelated to that page. See `electron/scan/coordinator.ts:422`.

The focused test demonstrates the gap rather than closing it. It records `Calculus`, `Limits practice`, and `WebAssign` while the fake browser snapshot contains only `SECRET_PAGE_HTML should never be persisted`. See `tests/storage/school-scan-coordinator.test.mjs:29` and `tests/storage/school-scan-coordinator.test.mjs:188`.

The dashboard then treats `lastVerifiedScanId` plus any evidence entry as enough to display an assignment as verified. See `src/app/WorkspaceScreens.tsx:58`. A model hallucination can therefore become durable school truth even though the browser never showed it. This directly violates the approved evidence rule.

## Blocking finding 2: verified assignments never become tasks or queue entries

The scan recorder writes assignments through `assignments.put` and adds their IDs to the scan, but it never appends a `task_created` event and never calls `ManagerCoordinator.enqueue`. See `electron/scan/coordinator.ts:302` through `electron/scan/coordinator.ts:340`.

Repository-wide inspection finds no production caller of `ManagerCoordinator.enqueue`; its callers are tests. The manager agent tools can inspect, steer, or cancel existing queue entries, but cannot create a task, enqueue an assignment, or start the assignment coordinator. See `electron/manager/coordinator.ts:82` and `electron/manager/coordinator.ts:392`.

The UI exposes the contradiction. The weekly grid can show scan assignments without tasks, while the durable queue is built only from `library.tasks`. `Start next assignment` is disabled when that queue is empty, and the command bar says the manager can start schoolwork even though its tools cannot. See `src/app/WorkspaceScreens.tsx:58`, `src/app/WorkspaceScreens.tsx:80`, and `src/app/WorkspaceScreens.tsx:97`.

This blocks the main beta journey after a successful first scan. The deterministic UI scenario hides the gap by seeding a task directly in `electron/main.ts`; no real scan follows that path.

## Narrow repair brief

Repair the existing scan-to-manager seam. Do not add a workflow engine, second queue, client state store, evidence service, or LMS adapter.

1. Bind recorded scan claims to observed browser facts. A course or assignment label must match normalized text or a current element in the fresh snapshot. Store a due date only when the same observation proves it. Require the assignment recorder to retain a usable assignment target, preferably the current assignment detail URL after visible navigation. Derive verified coverage from entities and observations already recorded in the scan instead of granting verification to an unrelated free-form target.
2. When a scan records or refreshes an assignment, idempotently create its durable task origin if none exists. Pass that task through the existing permission resolver and existing `ManagerCoordinator.enqueue` owner. Preserve manual priority on replay, leave denied work out of the runnable queue, and never create duplicate task origins.
3. Make the command bar honest at the same seam. Give the manager only the minimum existing-owner operation needed to queue or start the selected verified task, or remove the promise that it can start work. Do not let the manager invent an assignment ID or permission provenance.
4. Add one focused boundary proof that starts with a scan recording tool and ends with the same assignment visible in the dashboard, backed by a task origin and queue entry. The proof must reject a claim absent from the snapshot. Then run the real signed-in browser scan and one safe attempt-only assignment path.

The onboarding permission default also needs to stay explicit during this repair. The current renderer always sends `attempt` for a fresh profile at `src/app/StudiApp.tsx:98`, and `SchoolScanCoordinator.saveProfile` turns it into the global rule at `electron/scan/coordinator.ts:91`, while the onboarding form has no permission choice. Do not connect automatic queue intake to that hidden default. Present the existing permission choice or default safely to `do_not_attempt` until the student selects one.

## Reader load and subtraction judgment

`electron/main.ts` is now roughly 1,500 lines. It mixes composition, IPC handlers, product projections, Electron self-test receipts, and seeded UI scenarios. That is high reader load, but it is not the reason the current flow fails. Splitting it before the seam repair would mostly move code. The self-test scenario is also clearly gated and does not enter a normal profile.

The older WP-02 cycle-named storage tests add navigation cost, but their retained cases cover distinct restore and filesystem failure boundaries. Removing them is not part of this repair.

The Squirrel maker/import is inert in the current ZIP delivery, as the WP-13 reviewer noted. It is small and does not block the beta. Native-installer work, ASAR pruning, updater design, broader platform packaging, and more test permutations are outside this verdict.

## Evidence interpretation

The WP-13 safe Example Domain run ending without `scan_finish` is not by itself a defect. The approved rule says a zero-course scan remains incomplete, and `scan_finish` correctly refuses success without one verified course. That run does prove packaged provider use, truthful failure, tray reopen, and restart persistence. It does not prove the real happy-path school scan.

Read-only checks during this review passed:

- `npm run typecheck`
- `node --test tests/storage/school-scan-coordinator.test.mjs tests/storage/manager-coordinator.test.mjs tests/contracts/product-projection.test.mjs`, 6 of 6 tests

Those green tests do not cover the two missing integration invariants above.

I changed no production code, tests, configuration, plans, conclusions, skills, evidence, or release artifacts. This report is the only file added.
