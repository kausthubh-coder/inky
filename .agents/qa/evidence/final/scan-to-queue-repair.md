# Final scan-to-queue repair evidence

Date: 2026-09-02  
Scope: source-only repair; no package/make, portable artifact rebuild, conclusion edit, or final-review edit.

## Result

- A scan claim now survives only when its normalized label/title appears in the current fresh snapshot, preferring an exact current element ref. Linked-system state requires a separate visible state fact with explicit sign-in/sign-out semantics.
- A linked system cannot be persisted as `verified` when its current state fact is negated or otherwise contradictory. The production tool now rejects observations such as `Not signed in`, `Signed out`, sign-in-required, expired-session, and access-denied states before the linked-system repository is called.
- A due date is stored only when exact visible due text exists in that snapshot and parses to the claimed instant. The safe current URL remains the assignment target.
- Verified coverage is projected from courses, assignments, and verified linked systems recorded in the current scan. A free-form verified target is rejected unless it names one of those observations.
- The first verified assignment creates one `task_created` origin. The existing permission resolver decides eligibility and the existing `ManagerCoordinator.enqueue` writes the runnable queue row. Replay reuses both records and preserves manual priority. Denied work remains a discovered task with no queue row.
- Onboarding visibly presents `do_not_attempt`, `attempt`, and `auto_submit`; a fresh renderer state defaults to `do_not_attempt`.
- The manager session receives one narrow `manager_assignment_start` tool only when the composition root supplies the existing assignment execution owner. It accepts only a verified task already in the durable queue, steers that task next, and calls `AssignmentExecutionCoordinator.start(taskId)`. That owner delegates exact selection to `ManagerCoordinator.startTask`, which shares the same fresh permission resolution and lease acquisition as `startNext`; a newly denied selected task is cancelled and rejected without inspecting or starting another queue row.

## Focused proof

`tests/storage/school-scan-coordinator.test.mjs` starts at the scan recording tools with current element refs. It rejects `Hallucinated extra credit` because that title is absent, records the observed `Limits practice`, and leaves WebAssign in `needs_user` after a realistic snapshot exposes separate `WebAssign` and `Not signed in` elements while the tool claims `verified`. A later positive `Signed in as Avery` snapshot succeeds. The scan finishes with the same assignment backed by exactly one task origin and one manager queue entry; replay leaves both counts at one and preserves the manually steered priority.

`tests/storage/manager-coordinator.test.mjs` proves both selected-start boundaries. The manager start tool rejects invented provenance by selecting an already verified queued task and delegating its exact task ID through the configured execution-owner callback. A focused two-task regression then revokes permission for the selected task immediately before `manager_assignment_start`; the selected task becomes `cancelled`, the other task remains `queued`, and no browser lease is acquired.

## Gates

All commands exited 0:

- `npm run typecheck`
- `node --test tests/storage/school-scan-coordinator.test.mjs tests/storage/manager-coordinator.test.mjs` — 5/5
- `npm run test:contracts` — 50/50
- `npm run test:agent` — 15/15
- `npm run test:storage` — 43/43
- `npm run build`
- `npm run test:sites` — 4/4
- `npm run test:foundation` — 12/12, including all four protected-file byte-identity checks
- `npm run test:packaging` — 1/1 (static packaging contract only; no package/make)
- `npm run test:electron` — isolated temp-profile self-test and all fail-closed cases passed; cleanup reported `removed=true`

The production build retained `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`. Rollup emitted only its existing third-party annotation warnings and chunk-size warning.

## Source fingerprint

This saved project has no Git metadata available, so the repaired source fingerprint is the SHA-256 set below:

```text
795DF229954FE18DF1D1EAEAA77313FE2F18D7F426CB4B7A43B07AA5596586C5  electron/scan/coordinator.ts
4284B3CD64216F90F76E275DB90A997553D44429A80CD1992ACB5DAACD3620C0  electron/manager/coordinator.ts
7894D3214727C53C9AD0CD71F51CA05AAD2F85DB725ACFB38FBBF7164F59BECE  electron/assignment/coordinator.ts
E8843B885B38D46E4BDB053352875890974863C74EA087C68705CC6E0D10BEF5  electron/agent/runtime.ts
EE71DD3575D2803D7715357B88CD13DC27B4883D47C1EF01A28B2847E044BB8E  electron/main.ts
EBBD96979191C236CB7A520D77F8FD404D4F5CA659F7B72E4B7760232D3C14FA  src/app/StudiApp.tsx
CD578EF06EEDDED46D0CAEE47A54E7526A04820A54E12067D410343821198AE9  src/app/OnboardingScreen.tsx
1673B0E58F190AD5002C8A98C067A50ADE3D35F1D353D5E54FE82153B342A6FD  tests/storage/school-scan-coordinator.test.mjs
45E2FA8372D39725E66DA931D23A4AABF007E0AE98BD6133CC778E6E840BB63D  tests/storage/manager-coordinator.test.mjs
```

## Subtraction pass

The repair reuses the browser snapshot, assignment/task repositories, task event stream, permission resolver, manager queue, visible-browser ownership, and assignment execution coordinator. The exact-start path extracts only the permission-refresh and lease-acquisition decisions already shared by selected and next-task starts. It adds no workflow engine, LMS adapter, evidence service, client state store, event bus, queue, execution owner, migration, or recovery layer. The four protected Sites handoff sources were untouched.
