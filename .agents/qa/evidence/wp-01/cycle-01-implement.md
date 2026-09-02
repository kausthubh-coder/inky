# WP-01 cycle 1 implementation report

Role: implementer  
Date: 2026-08-30  
Package status: implementation finished and local gates green. WP-01 is not verified. Independent testing and review remain with the manager.

## Implemented behavior

- Added one `shared/` contract source based on Zod 4.5.4. Versioned schemas cover assignments, evidence references, permission rules, tasks, runs, event envelopes, and future tool mutation/result envelopes. Unknown schema versions fail parsing.
- IDs reject empty and whitespace-only strings. Timestamps accept only canonical UTC ISO strings with millisecond precision. Evidence schemas reject unknown secret-shaped fields, URL credentials, sensitive query keys, sensitive fragments, non-HTTP targets, and full-page fields such as `pageHtml`.
- Added the exact approved task transition table and terminal-state list. `transitionTask` is pure, increments revision only on success, returns an event payload, and returns `invalid_task_transition` without changing the input for every rejected pair.
- Added deterministic permission resolution with specificity `assignment > pattern > course > global`. Equal specificity uses newest `updatedAt`, then lexical ascending rule ID. No match returns `do_not_attempt`. Both the resolver and result schema enforce that only `auto_submit` may submit.
- Added event ordering checks that accept the first or any strictly increasing sequence and reject duplicate or decreasing sequence numbers.
- Added one IPC registry for `getRuntimeInfo` on `studi:runtime-info` and `getContractManifest` on `studi:contract-manifest`. Each entry owns its request and result schema. Main registration and removal iterate the registry. The sandboxed preload builds its frozen named-method object from the same registry and validates both sides of each call.
- Removed the renderer-only runtime interface. Main, preload, renderer declarations, and the self-test now use the shared runtime and manifest schemas.
- Added an explicit `STUDI_DEVELOPMENT_MODE=1` requirement before `VITE_DEV_SERVER_URL` is honored. Only credential-free local HTTP URLs pass.
- Added explicit self-test termination for rejected renderer loads and `did-fail-load`. The real Electron test also injects a malformed handler result and proves schema validation rejects it.
- Strengthened the default invalid-profile test to prove both the requested profile and its parent path remain absent.
- Pinned Zod 4.5.4, fast-check 4.9.0, and the already-present esbuild 0.25.12 in `package-lock.json`. Esbuild bundles the shared registry and validators into the sandboxed CommonJS preload.

## Changed files

Added:

- `shared/schema-version.ts`
- `shared/ids.ts`
- `shared/assignment.ts`
- `shared/evidence.ts`
- `shared/permission.ts`
- `shared/task.ts`
- `shared/run.ts`
- `shared/event.ts`
- `shared/tool.ts`
- `shared/ipc.ts`
- `shared/index.ts`
- `electron/development-url.ts`
- `tests/contracts/fixtures.mjs`
- `tests/contracts/schema.test.mjs`
- `tests/contracts/task-transition.test.mjs`
- `tests/contracts/permission.test.mjs`
- `tests/contracts/event-order.test.mjs`
- `tests/contracts/ipc.test.mjs`
- `tests/contracts/development-url.test.mjs`
- `.agents/qa/evidence/wp-01/cycle-01-implement.md`

Modified:

- `electron/main.ts`
- `electron/preload.cts`
- `electron/tsconfig.json`
- `src/app/StudiApp.tsx`
- `src/types/window.d.ts`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `tests/electron-self-test-runner.mjs`
- `tests/build-shape.test.mjs`
- `tests/clean-room-boundary.test.mjs`

Removed:

- `src/platform/studi-api.ts`

No `.git` entry was visible in the saved project, so `git status` and a repository diff were unavailable. I used the approved ownership list, direct source scans, build-shape tests, and protected hashes to constrain the change.

## Final commands and exits

| Command | Exit | Evidence |
|---|---:|---|
| `npm run test:contracts` | 0 | 31 tests passed. Covered development URL gating, event order, IPC, permission properties, versioned schemas, evidence safety, and every task-state pair. |
| `npm run typecheck` | 0 | Renderer/shared and Electron TypeScript configurations passed. |
| `npm test` | 0 | Typecheck, production build, 31 contract tests, and 12 foundation/protected/clean-room tests passed. |
| `npm run build` | 0 | Created `dist/client/index.html`, `dist/electron/main.js`, `dist/electron/preload.cjs`, `dist/shared/index.js`, `dist/server/index.js`, and `dist/.openai/hosting.json`. |
| `npm run test:sites` | 0 | 4 Sites worker and packaging tests passed. |
| `npm run test:electron` | 0 | Valid runtime plus manifest passed through the real preload. Invalid profile, absent invalid parent, renderer-load failure, malformed IPC result, and cleanup checks passed. |
| `npm ls zod fast-check esbuild --depth=0` | 0 | Confirmed `zod@4.5.4`, `fast-check@4.9.0`, and `esbuild@0.25.12`. |
| Protected SHA-256 scan | 0 | All four protected hashes matched the WP-00 baseline. |

Protected hashes after the final build:

```text
.openai/hosting.json            D532ABB65CF9AE20634B464D954CB4A08A0DE9F3CD3CDF7F9C3EC8948826D947
worker/index.js                 2DD0615A445143933D88D4271F54F5D63EE951421FCD08C5A7617BB09C564389
scripts/prepare-sites-build.mjs B6A6ADAA4FAB3234676116DD1C9CB6611275AB9D92DD26F5BF402393E3744BF6
tests/sites-worker.test.mjs     96AF7B48906C6460C793356D7B6952F7D5026DBF5A502BEC0D9297FF04201C26
```

## Failed attempts and fixes

1. The initial WP-00 baseline `npm test` reached a green typecheck, then Vite/esbuild failed with a sandbox parent-directory access denial. Final Vite and esbuild gates ran outside that sandbox and passed.
2. The first post-edit typecheck failed because a frozen manifest tuple inferred as readonly and `Array.prototype.toSorted` was outside the ES2022 library. I typed the tuple before freezing it and sorted the new filtered array in place. The next typecheck passed.
3. The first preload build used `electron/preload.cts` without a leading `./`, which esbuild treated as a package name. Changing it to `./electron/preload.cts` fixed entry resolution. The sandbox access denial still required the approved outside-sandbox build.
4. `node --test tests/contracts` treated the directory as a module on Windows. The script now uses `node --test "tests/contracts/*.test.mjs"`; all 31 tests pass.
5. The first renderer-load injection proved the failure callback ran, but Electron returned exit 0 because the code called `app.quit()`. The failure path now calls `app.exit(1)`. Renderer-load and malformed-result injections then exited nonzero without waiting for the runner timeout.
6. The first npm registry query inside the restricted sandbox returned no version output. The approved registry query outside the sandbox returned Zod 4.5.4 and fast-check 4.9.0, which are pinned in the lockfile.

## Remaining uncertainty for tester and reviewer

- Pattern rules use a case-insensitive `titleIncludes` substring. The dossier specifies pattern precedence but not regex or glob semantics. This keeps matching deterministic and avoids regular-expression execution, but the tester should flag it if the master plan implies a different pattern language.
- Equal-time permission ties choose the lexically smallest rule ID. The dossier asks for a stable rule-ID tie without choosing ascending or descending order.
- Event ordering requires strict increase but permits gaps. This matches the dossier wording and rejects duplicates/decreases; it does not enforce contiguity.
- Canonical timestamps require UTC `Z` form with millisecond precision. Offset timestamps that identify the same instant are rejected as non-normalized.
- The bundled preload is about 714 KB because it contains the Zod validators. It passed startup and failure tests, but the independent review may decide later build work should reduce that size.
- The WP-00 visible normal-window smoke remains deferred. This package tested the hidden isolated Electron self-test boundary only.
