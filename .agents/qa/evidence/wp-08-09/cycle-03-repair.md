# WP-08/09 cycle 03 repair evidence

Date: 2026-09-01

Role: focused repair implementer

Inputs: the approved combined dossier, cycle-two repair and live-test evidence, the quality oracle, and `.agents/qa/reviews/wp-08-09-cycle-02-review.md`

## Outcome

Repaired the two cycle-two review blockers without changing the master plan, conclusion artifacts, renderer policy, schema, or school-specific browser behavior.

1. One `VisibleBrowserWork` decision now guards assignment start and resume plus manual, replayed, resumed, and scheduled scans. It reads the durable manager lease and latest scan run state, and it holds a small in-process reservation across the asynchronous gap before either durable owner exists. The production composition passes the same instance to the assignment coordinator, scan coordinator, and app kernel.
2. Auto-submit now rejects a claimed confirmation phrase found in the fresh pre-submit snapshot. That path moves to `needs_user` with no click, no attempt marker, and no receipt. After a valid pre-submit snapshot, Studi still writes the durable effect marker before one gated click. Only a phrase absent before the click and present in the returned post-click snapshot can produce a receipt.

No real school submission ran.

## Ownership flow

The decision is deliberately domain-specific, not a job framework.

- Assignment start reserves browser work, then the existing manager lease becomes the durable assignment owner.
- Scan start, replay, and resume reserve browser work, then the existing scan row becomes the durable scan owner.
- Scheduled work acquires the same reservation before its durable occurrence claim. If assignment or scan work owns the browser, the claim callback never runs and the existing kernel timer checks again after 30 seconds.
- `needs_user` scan state continues to own the visible browser for the student's sign-in. A retained assignment lease continues to own it through review and assignment handoff.

The old `activeBrowserTaskId` argument was removed from `LifecycleRepository.claimDueSchedule`. Schedule storage now claims only due occurrences; visible-browser policy has one owner.

## Submission flow

The coordinator now follows this sequence:

1. Resolve fresh assignment permission.
2. Refresh and uniquely rebind the supplied submit control.
3. Capture the fresh pre-submit snapshot.
4. Reject confirmation text already present there and hand the task to the student.
5. Persist `submissionAttemptedAt`, move the manager task to `submitting`, and click once.
6. Require the confirmation phrase in the returned post-click snapshot.
7. Persist a receipt only after that new confirmation appears.

An exception after the attempt marker or missing post-click confirmation remains `needs_user`. No path retries the effect.

## Changed code

- `electron/browser/work-ownership.ts`
- `electron/assignment/coordinator.ts`
- `electron/scan/coordinator.ts`
- `electron/lifecycle/kernel.ts`
- `electron/main.ts`
- `electron/storage/lifecycle-records.ts`
- `tests/storage/lifecycle-execution.test.mjs`

## Focused proof

`npm run build:electron; node --test tests/storage/lifecycle-execution.test.mjs tests/storage/school-scan-coordinator.test.mjs tests/agent/browser-controller.test.mjs`

Exit 0, 17/17 passed.

The focused cases prove:

- a retained assignment lease blocks manual start, resume, replay, and scheduled scan entry;
- a blocked scheduled scan does not call the durable occurrence claim;
- a running scan blocks assignment lease acquisition before the assignment snapshots or changes the page;
- pre-existing confirmation text moves to `needs_user` with zero clicks, no attempt marker, and no receipt;
- the valid auto-submit case still refreshes its control, clicks exactly once, and writes one receipt from distinct pre/post revisions;
- earlier rollover, review preservation, permission, recovery, and restart cases remain green.

The first typecheck after wiring the scheduled callback exposed an inferred `never` from closure mutation in the kernel. I replaced that hidden mutation with one typed return containing both the claimed occurrence and scan state. The next typecheck and all retained gates passed.

## Retained gates

- `npm run test:agent`: exit 0, 11/11 passed.
- `npm run test:storage`: exit 0, 40/40 passed.
- `npm test`: exit 0. Typecheck and production build passed; contracts 48/48 and foundation/protected-file checks 12/12 passed.
- `npm run test:electron`: exit 0. The positive Electron self-test and invalid-profile, renderer-load, malformed-manifest, and malformed-runtime rejection cases passed; cleanup completed.
- `npm run test:sites`: exit 0, 4/4 passed.
- Required handoff outputs exist: `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
- `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`: the local preview opened at `http://127.0.0.1:5173/`. Its DOM showed the Studi desktop landing message and the browser reported no console errors.

## Subtraction pass

- Kept one narrow ownership class with four domain entry methods and one private conflict decision.
- Reused the manager lease, scan state, existing kernel timer, existing submission attempt marker, browser ref refresh, and receipt records.
- Removed the repository's duplicate browser-policy argument.
- Added one shared submission-handoff helper because all ambiguous effect outcomes perform the same durable state change, manager pause, and notification.
- Added no renderer checks, generic mutex package, scheduler layer, retry loop, schema, migration, LMS branch, or new fixture.

## Workspace fingerprint

The workspace has no Git metadata. The aggregate is SHA-256 over seven `relative-path<TAB>file-sha256` rows joined with LF and encoded as UTF-8.

- File count: 7
- Aggregate SHA-256: `e07757f5e87c1101076807ee83e62815f8edeec26619935d1b09a14b2b64a699`

```text
electron/browser/work-ownership.ts	13a14fc99444c6b8deebcdd5fd3de33040e4b6f858d4037bd49130d3cfd95dbd
electron/assignment/coordinator.ts	3491607963bf2e8b395b5f8a21b976c1fde39d18169e61ad0bf4b2c74bc02d34
electron/scan/coordinator.ts	507d9f22327f70211b052e0ff1eb763227300eb0549f5b1e54169077f5f7f376
electron/lifecycle/kernel.ts	715655859794bfec7a90c714b52c9e7fe777c256d0eeca1cba2d8ff2d45f8b4b
electron/main.ts	842b87e83e4d2a8fa5e754d35cb1f26c98f43eb865737f6a4c8d97c8101cc08f
electron/storage/lifecycle-records.ts	92dccff1e61ed1693b5ff4a0bbea6da3caf69fa7e4614cef411983db043feaad
tests/storage/lifecycle-execution.test.mjs	7b151b2015905dd4346c8c9c981a89f5620b54af9615c1471e6caff25d5dcdf3
```
