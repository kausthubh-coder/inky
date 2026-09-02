# WP-01 cycle-6 independent test

Role: tester only

Verdict: **pass**. The cycle-5 composition blocker is closed. I found no production failure. WP-01 is ready for the manager to send to a fresh read-only reviewer, but this report does not mark the package verified.

## Independent composition result

I tested the compiled shared exports through the same two helpers used by production: `createIpcApi` on the caller side and `createIpcHandlerRegistrations` at the main boundary.

The type-changing valid call used raw request input `"studi"` on fixed channel `synthetic:measure`. The transport ran once. Main parsed the request once and produced `5`. The typed handler ran once and observed `5`, then returned result-schema input `"accepted"`. Main parsed that result once and returned output `8`. The caller observed `8` without parsing either value again.

The same harness proved:

- invalid raw request `5` crossed the transport once, failed before the request transform and typed handler, and surfaced a `ZodError`;
- malformed handler result `17` failed before the result transform completed or a response returned;
- a handler exception propagated by object identity after one request parse;
- an invoke exception propagated by object identity with zero caller-side request or result transforms;
- missing and extra arguments failed before transport;
- every attempted well-formed-arity call used its registry-owned channel once;
- the generated API was frozen and exposed only its named registry method.

The no-emit TypeScript fixture proves the four type directions directly. Callers supply request-schema input and receive result-schema output. Handlers receive request-schema output and return result-schema input. `@ts-expect-error` assertions reject parsed request output at the caller, raw request input as the handler request, parsed result output as the handler return, missing arguments, extra arguments, and result-schema input as the caller result.

## Production wiring

Source inspection found runtime request and result parsing only in the shared main-side handler wrapper at `shared/ipc.ts:142` and `shared/ipc.ts:146`. The unrelated manifest constant is parsed at module construction at line 170.

`electron/preload.cts` creates the named API with `createIpcApi` and forwards `(channel, request)` through `ipcRenderer.invoke` once. `electron/main.ts` creates registrations with `createIpcHandlerRegistrations(studiIpcRegistry, ipcHandlers)` and gives each registration to `ipcMain.handle`. Neither production file performs a second request or result parse.

## Test-only additions

- `tests/contracts/ipc.test.mjs` now injects an invoke failure and checks identity propagation with no caller-side transforms. It also checks the generated named API is frozen.
- `tests/contracts/ipc-types.fixture.ts` now has explicit positive and negative assertions for handler request and result directions.

I did not modify production code, plans, the dossier, ledger, protected Sites files, or conclusions.

## Commands and exits

All final gates ran after the test-only edits.

| Command | Exit | Result |
|---|---:|---|
| `node --test tests/contracts/ipc.test.mjs` | 0 | 10 passed, 0 failed. This includes the composed type-changing flow, invalid request, malformed handler result, handler error, invoke error, exact arity, frozen named API, source wiring, and no-emit fixture. |
| `npm run test:contracts` under the managed filesystem | 1 | No test ran. Esbuild could not read an ancestor directory and could not resolve `./electron/preload.cts`. This was a filesystem restriction, not an assertion failure. |
| `npm run test:contracts` outside that restriction | 0 | 48 passed, 0 failed. |
| `npm run typecheck` | 0 | Renderer/shared and Electron no-emit TypeScript checks passed. |
| `npm test` outside the filesystem restriction | 0 | Build passed, then 48 contract tests and 12 foundation tests passed. |
| `npm run test:sites` | 0 | 4 passed, 0 failed. |
| `npm run test:electron` outside the filesystem and GUI restrictions | 0 | Build and real Electron self-test passed. Valid runtime and manifest were observed. Invalid profile, renderer-load failure, malformed manifest, and malformed runtime were rejected. Cleanup reported `removed=true`. |

The Electron boundary emitted:

```text
STUDI_SELF_TEST {"marker":true,"runtime":{"app":"0.0.0","electron":"37.10.3","chrome":"138.0.7204.251","node":"22.21.1"},"manifest":{"schemaVersion":1,"contractVersion":"1","ipcMethods":[{"method":"getRuntimeInfo","channel":"studi:runtime-info"},{"method":"getContractManifest","channel":"studi:contract-manifest"}]}}
STUDI_SELF_TEST_REJECTION invalid-profile=true parent-created=false
STUDI_SELF_TEST_REJECTION renderer-load=true timed-out=false
STUDI_SELF_TEST_REJECTION malformed-manifest=true
STUDI_SELF_TEST_REJECTION malformed-runtime=true
STUDI_SELF_TEST_CLEANUP removed=true
```

## Hash and handoff checks

Production and owned-file hashes:

| File | SHA-256 |
|---|---|
| `shared/ipc.ts` | `253D50D8110C476847712C1ED9BC5E926A4004FFDBB90EE1AB2292552F8FC7FA` |
| `electron/main.ts` | `5D5D4C6033B895CF60D3B9FE3FE575372993BD4A3670A9C7448C89E77BE0B94C` |
| `electron/preload.cts` | `1A8E0E7B094EB3791776F64848EC8DE4AFE7147C349AC20CF105EB4D17297D13` |
| `tests/contracts/ipc.test.mjs` | `809808A17336EBCAA7627801EFF22BFCC0A3861951B95C718783D1BD222ABAD0` |
| `tests/contracts/ipc-types.fixture.ts` | `594C5713C084668DEFA8AB4AA2693EC7C9CF710211DA3BE8D69193858F682F2A` |

Protected files match their recorded baseline hashes:

| File | SHA-256 |
|---|---|
| `.openai/hosting.json` | `D532ABB65CF9AE20634B464D954CB4A08A0DE9F3CD3CDF7F9C3EC8948826D947` |
| `worker/index.js` | `2DD0615A445143933D88D4271F54F5D63EE951421FCD08C5A7617BB09C564389` |
| `scripts/prepare-sites-build.mjs` | `B6A6ADAA4FAB3234676116DD1C9CB6611275AB9D92DD26F5BF402393E3744BF6` |
| `tests/sites-worker.test.mjs` | `96AF7B48906C6460C793356D7B6952F7D5026DBF5A502BEC0D9297FF04201C26` |

Required output sizes are `dist/client/index.html` 418 bytes, `dist/server/index.js` 483 bytes, and `dist/.openai/hosting.json` 31 bytes. The server copy hash equals `worker/index.js`, and the built hosting copy hash equals `.openai/hosting.json`. Top-level `plans/` and `qa/` are absent.

## Scope note

The workspace still has no usable `.git` entry, so `git status` and `git diff` cannot distinguish pre-existing changes. I limited my writes to the two package test files named above and this report. The protected-hash suite and direct hash checks provide the available evidence that excluded files stayed intact.
