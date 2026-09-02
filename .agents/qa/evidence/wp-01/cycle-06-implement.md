# WP-01 cycle-6 implementation

Role: implementer only

Disposition: implementation complete and required implementer gates green. This report does not mark WP-01 verified.

## Blocker closed

The renderer API and the main handler wrapper no longer parse the same request and result.

The composed flow is now:

1. `createIpcApi` derives the frozen named-method API from the registry, enforces exact arity, and sends the caller's `z.input<RequestSchema>` to the registry-owned channel once.
2. `createIpcHandlerRegistrations` derives main registrations from the same registry and handler map.
3. Its shared handler wrapper parses the raw request once. The typed handler receives `z.output<RequestSchema>`.
4. The handler returns `z.input<ResultSchema>`. The wrapper parses that value once and returns `z.output<ResultSchema>` to the renderer.

This leaves runtime validation at the main trust boundary. Invalid renderer data fails before the typed handler. Invalid handler output fails before the IPC response returns. Invoke and handler errors still propagate.

## Code and test changes

- `shared/ipc.ts`
  - Changed the preload/API factory from a request/result parser into an exact-arity transport client.
  - Added generic `IpcHandlers<Registry>` typing. Handlers receive parsed request output and return result-schema input.
  - Added `createIpcHandlerRegistrations`, which owns request parsing, typed handler invocation, and result parsing.
  - Kept registry-derived method signatures, fixed channels, and frozen API objects.
- `electron/main.ts`
  - Replaced the local parse/handler/parse closure with registrations from `createIpcHandlerRegistrations(studiIpcRegistry, ipcHandlers)`.
- `tests/contracts/ipc.test.mjs`
  - Added a composed transport harness that uses `createIpcApi` and the same registration helper used by Electron main.
  - Added a type-changing request/result test with counters. One valid call produced one request transform, one handler call with request output `5`, one result transform, typed result output `8`, and one invocation of `synthetic:measure` with raw request input `"studi"`.
  - The same test proves invalid request rejection before the handler, malformed handler-result rejection, and one transport invocation per attempted API call.
  - Retained exact-arity, error propagation, manifest, allowlist, fixed-channel, and source-boundary checks.
- `tests/contracts/ipc-types.fixture.ts`
  - Retained caller input, caller output, and exact-arity checks.
  - Added the shared handler map and registration helper to prove the handler request is the parsed `number` output while its result is schema input.

`electron/preload.cts` and `tests/electron-self-test-runner.mjs` did not need edits. Their existing real-boundary flow now consumes the corrected shared composition.

## Red-green evidence

- Baseline `npm run test:contracts`: exit 1 before tests. The managed filesystem denied esbuild access while it resolved an ancestor directory. Retrying the build with approved execution outside that restriction succeeded. This was an environment failure, not a contract assertion failure.
- Intermediate `node node_modules/typescript/bin/tsc -p tests/contracts/tsconfig.ipc-types.json; node node_modules/typescript/bin/tsc -p electron/tsconfig.json --noEmit; node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`: exit 1. It exposed that a transforming result handler must return `z.input<ResultSchema>`, not `z.output<ResultSchema>`, and one indexed registry value needed an explicit presence check.
- The same three compiler commands after that repair: exit 0.
- `npm run build:electron`: exit 0 outside the restricted filesystem.
- Final focused `node --test tests/contracts/ipc.test.mjs`: exit 0, 9 passed, 0 failed.

## Final required gates

All commands below ran after the final source and fixture edits.

| Command | Exit | Evidence |
|---|---:|---|
| `node --test tests/contracts/ipc.test.mjs` | 0 | 9 passed, including composed transform counts and the no-emit type fixture |
| `npm run test:contracts` | 0 | 47 passed, 0 failed |
| `npm run typecheck` | 0 | renderer/shared and Electron TypeScript checks passed |
| `npm test` | 0 | build, 47 contract tests, and 12 foundation tests passed |
| `npm run test:sites` | 0 | 4 passed, 0 failed |
| `npm run test:electron` | 0 | valid runtime and manifest observed; invalid profile and renderer-load failures rejected; malformed manifest and runtime results rejected; cleanup reported `removed=true` |

The Electron self-test output included:

```text
STUDI_SELF_TEST {"marker":true,"runtime":{"app":"0.0.0","electron":"37.10.3","chrome":"138.0.7204.251","node":"22.21.1"},"manifest":{"schemaVersion":1,"contractVersion":"1","ipcMethods":[{"method":"getRuntimeInfo","channel":"studi:runtime-info"},{"method":"getContractManifest","channel":"studi:contract-manifest"}]}}
STUDI_SELF_TEST_REJECTION invalid-profile=true parent-created=false
STUDI_SELF_TEST_REJECTION renderer-load=true timed-out=false
STUDI_SELF_TEST_REJECTION malformed-manifest=true
STUDI_SELF_TEST_REJECTION malformed-runtime=true
STUDI_SELF_TEST_CLEANUP removed=true
```

## Final hashes and location checks

Changed source and package test files:

| File | SHA-256 |
|---|---|
| `shared/ipc.ts` | `253D50D8110C476847712C1ED9BC5E926A4004FFDBB90EE1AB2292552F8FC7FA` |
| `electron/main.ts` | `5D5D4C6033B895CF60D3B9FE3FE575372993BD4A3670A9C7448C89E77BE0B94C` |
| `tests/contracts/ipc.test.mjs` | `9382D9B225102158B6303515CFC66DF5723087246BF0AFFCB9DB5BB873A6FFC5` |
| `tests/contracts/ipc-types.fixture.ts` | `7299D1ACB5CFBC6803F82DEF323F3062325B73CA734D0DDD9D3232233787766F` |

Owned files checked and left unchanged:

| File | SHA-256 |
|---|---|
| `electron/preload.cts` | `1A8E0E7B094EB3791776F64848EC8DE4AFE7147C349AC20CF105EB4D17297D13` |
| `tests/electron-self-test-runner.mjs` | `9EC9A84EA889C43198C1C607A9E33CFC06B14D45DD3937DB6168C91204F48E9C` |

Protected files remained byte-identical to the captured baseline and passed `tests/protected-files.test.mjs`:

| File | SHA-256 |
|---|---|
| `.openai/hosting.json` | `D532ABB65CF9AE20634B464D954CB4A08A0DE9F3CD3CDF7F9C3EC8948826D947` |
| `worker/index.js` | `2DD0615A445143933D88D4271F54F5D63EE951421FCD08C5A7617BB09C564389` |
| `scripts/prepare-sites-build.mjs` | `B6A6ADAA4FAB3234676116DD1C9CB6611275AB9D92DD26F5BF402393E3744BF6` |
| `tests/sites-worker.test.mjs` | `96AF7B48906C6460C793356D7B6952F7D5026DBF5A502BEC0D9297FF04201C26` |

Required build artifacts exist at:

- `dist/client/index.html`, 418 bytes
- `dist/server/index.js`, 483 bytes
- `dist/.openai/hosting.json`, 31 bytes

A source scan found request and result `.parse` calls only in the shared main-side handler wrapper at `shared/ipc.ts:142` and `shared/ipc.ts:146`. Preload contains only `createIpcApi` plus `ipcRenderer.invoke(channel, request)`. Electron main contains only registration through the shared helper plus `ipcMain.handle`.

## Scope and remaining uncertainty

- The workspace presented no `.git` entry, so `git status` could not enumerate pre-existing user changes. I limited edits to the four files listed above plus this required report and did not touch the dossier, ledger, master plan, `AGENTS.md`, conclusion files, or protected Sites files.
- The two production methods are void-request methods with non-transforming result schemas. The real Electron test covers their complete preload/main boundary and malformed-result containment. The type-changing guarantee comes from the stable in-memory composition test that uses the exact production API factory and exact production main registration helper.
- `createIpcApi` relies on the main registration wrapper as its runtime-validation peer. A future caller that wires the factory to a different transport must preserve that trust-boundary contract.
- Independent tester and reviewer work remain for the manager. WP-01 is not verified by this report.
