# Final scan-to-queue repair review

Date: 2026-09-02  
Role: read-only quality reviewer  
Verdict: **approve**  
Quality score: **9/10**

## Decision

The two previously reproduced release blockers are closed. The repair remains direct, traceable, and owned by the existing scan, permission, queue, lease, and assignment-execution boundaries. No follow-up polish is required.

## Closed blocker 1: contradictory linked-system state

`scan_record_linked_system` still requires the claimed state text in the current browser snapshot, then rejects contradictory verified-state facts before constructing evidence or calling the repository (`electron/scan/coordinator.ts:375-386`). `requireLinkedSystemStateFact` now rejects negated sign-in text and explicit signed-out, sign-in-required, expired-session, and access-denied states before applying the positive verified markers (`electron/scan/coordinator.ts:731-748`).

The focused regression presents separate `WebAssign` and `Not signed in` elements, asserts that the verified claim fails, and confirms the persisted linked system remains `needs_user`; a later `Signed in as Avery` snapshot succeeds (`tests/storage/school-scan-coordinator.test.mjs:64-91`). This closes the exact false-verification path without adding a second evidence owner.

## Closed blocker 2: exact selected-task start

The manager tool still accepts only an existing queued task backed by scan evidence, but the composition root now delegates its exact task ID to `AssignmentExecutionCoordinator.start(taskId)` (`electron/manager/coordinator.ts:405-423`, `electron/main.ts:1113-1119`). That owner calls `ManagerCoordinator.startTask(taskId)` rather than the next-task selector (`electron/assignment/coordinator.ts:97-112`).

`startTask` checks only the requested row. It shares `#refreshStartPermission` and `#startEntry` with `startNext`, so permission resolution, cancellation, queue removal, lease acquisition, and worker activation still have one implementation (`electron/manager/coordinator.ts:151-184`, `electron/manager/coordinator.ts:442-496`). A denied selected task now fails before lease acquisition and cannot fall through to another entry.

The two-task regression revokes permission immediately before `manager_assignment_start` and confirms the selected task is cancelled, the other remains queued, and no lease exists (`tests/storage/manager-coordinator.test.mjs:146-175`).

## Quality judgment

The sign-in repair is one local boundary predicate for a real invalid state. The exact-start repair adds one domain operation while extracting only the permission-refresh and lease-acquisition decisions that both start modes genuinely share. It introduces no second queue, resolver, worker owner, state machine, adapter, or speculative recovery path. The runtime flow is easier to trace than the rejected fall-through design.

## Verification

- `npm run typecheck` — passed
- `node --test tests/storage/school-scan-coordinator.test.mjs tests/storage/manager-coordinator.test.mjs` — 5/5 passed
- Updated source fingerprints — exact match with `.agents/qa/evidence/final/scan-to-queue-repair.md`

No production code or tests were edited during this review. This report is accepted without optional follow-ups.
