# Partial first-scan retry repair

Date: 2026-09-02  
Scope: source-only repair; no package/make, ZIP rebuild, conclusion edit, storage reset, or protected Sites-file edit.

## Result

The dashboard's scan recovery actions now select the next command from the durable workflow state:

- `workflowRevision=null` routes **Scan again**, **Retry visible scan**, and **Retry** to `startSchoolScan`, which starts a new evidence-backed `first_scan` at the saved canonical school root.
- A positive workflow revision routes those same actions to `replaySchoolScan`, preserving replay's strict requirement for a successfully written workflow.
- The dashboard callback was renamed from `onReplay` to `onScanAgain` so the component no longer claims that every recovery action is a replay.

The decision lives beside `hasCompletedSchoolOnboarding` as `nextSchoolScanAction`. `StudiApp` applies it once at the application/IPC routing boundary. Electron scan coordination, replay validation, school repositories, retained scan/course evidence, browser ownership, profile storage, and browser partitions were not changed. Starting a fresh retry writes a new scan record through the existing coordinator; it does not delete the retained partial scan or reset the persistent browser profile.

## Focused regression

`tests/contracts/product-projection.test.mjs` now proves the routing policy that reproduced the live blocker: a state with no successful workflow selects `scan`, while a state with workflow revision 1 selects `replay`. The adjacent existing projection checks continue to prove that an evidence-backed partial first scan may display the dashboard even with `workflowRevision=null`, and that a later failed scan remains on the dashboard when a prior successful workflow exists.

## Gates

All final commands exited 0:

- `npm run typecheck`
- `npm run build:electron && node --test tests/contracts/product-projection.test.mjs` — 3/3
- `npm run build` — emitted `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`
- `npm run test:sites` — 4/4
- `npm run test:foundation` — 12/12, including all four protected-file byte-identity checks
- `npm run test:packaging` — 1/1 static packaging contract; no package/make or ZIP rebuild
- `npm run test:electron` — positive renderer/storage/agent/browser/lifecycle receipt passed; invalid-profile, renderer-load, malformed-manifest, and malformed-runtime fail-closed cases passed; cleanup reported `removed=true`

Two earlier Electron invocations timed out at the positive runner's 25-second boundary while the manager's isolated packaged Studi process still owned the live single-instance boundary. The manager stopped that exact process without clearing its user data or browser profile. The unchanged production source then passed the full Electron gate. No timeout or lifecycle workaround was added.

The production build emitted only the existing third-party Rollup annotation warnings and chunk-size warning.

## Source fingerprint

This saved project has no Git metadata available. SHA-256 after the green gates:

```text
6CF3DEE5EC1E35FAAF123347111C762DA39AA007C138450C858FE1028331751F  shared/school-scan.ts
CA2C78FA4787271223FD029BF16B1D6311F4D51A5A13539ACDDEE9CD22E1CB8E  src/app/StudiApp.tsx
91AD2ED86126125C9F9A32151E2F0193FC192CB262778001F20713D0E3CB551B  src/app/WorkspaceScreens.tsx
A86E1ABEC3440C4EFC958601F7FD7E315B7B5F7828FEE6653A9721520D1B4FDD  tests/contracts/product-projection.test.mjs
```

## Subtraction pass

The final repair is one two-way policy function, one application call site, a semantic callback rename, and one focused two-assertion regression. It adds no retry engine, renderer state machine, IPC method, storage migration, workflow fallback, LMS adapter, browser reset, compatibility path, or replay exception. Every remaining change directly supports the observed blocker or guards its routing invariant.
