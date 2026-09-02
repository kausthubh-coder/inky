# WP-01 cycle 5 independent test report

Role: tester  
Date: 2026-08-31  
Verdict: **PASS for cycle-5 testing.** The cycle-4 IPC caller-typing blocker is closed in the tested state. This report does not mark WP-01 verified and does not replace the required read-only review.

## Scope and independence

I read the approved WP-01 dossier, the cycle-4 review finding, the cycle-5 implementer report, `shared/ipc.ts`, `electron/main.ts`, `electron/preload.cts`, the checked-in compile fixture, its TypeScript configuration, and the IPC runtime-test wiring. I treated the implementer's command results as untrusted and reran every requested gate.

I changed one test file, `tests/contracts/ipc.test.mjs`, to add direct invoke-error failure injection. I also added this report. I did not change production code, package or TypeScript configuration, plans, dossiers, the ledger, prior evidence, protected files, or a conclusion. Required builds regenerated `dist/**`.

Git status could not provide a diff because this saved project is not a Git repository. I constrained the test change with initial and final hashes, direct source inspection, protected-file tests, and the final audit below.

## Blocker verification

The checked-in `tests/contracts/ipc-types.fixture.ts` uses a type-changing request schema, `string -> number`, and a type-changing result schema, `string -> number`.

- `api.measure("studi")` compiles, proving the caller accepts `z.input`.
- `api.measure(5)` is guarded by a consumed `@ts-expect-error`, proving the parsed `z.output` is rejected at the caller.
- Missing and extra arguments each have a consumed `@ts-expect-error`, proving exact compile-time arity.
- `Promise<number>` compiles and `Promise<string>` has a consumed `@ts-expect-error`, proving the method returns the result schema output.
- The paired runtime test returns `8` from raw result `"accepted"` and records exactly one call to the fixed `synthetic:measure` channel with request `5`. Getting `5` requires one parse of `"studi"`; a second parse would reject the number. This proves one request parse before one invocation and one result parse after it.
- Runtime input `5` rejects with `ZodError` and does not add an invocation.
- A malformed result in the general IPC factory test rejects with `ZodError` after the expected invocation.
- The added error injection throws a specific `Error` from the invoke function. The API rejects with that same object after exactly one call on `synthetic:measure` with parsed request `5`.
- `shared/ipc.ts` defines caller arguments as `z.input<Definition["requestSchema"]>`. `RequestFor`, used by `StudiIpcHandlers`, remains `z.output<StudiIpcRegistry[Method]["requestSchema"]>`. `electron/main.ts` parses `rawRequest` with the registry request schema before calling the typed handler.

## Commands and results

| Command | Exit | Independent result |
|---|---:|---|
| `node node_modules/typescript/bin/tsc -p tests/contracts/tsconfig.ipc-types.json` | 0 | The checked-in fixture compiled. All four negative assertions were consumed. |
| `node --test --test-name-pattern="IPC factory accepts schema input\|IPC caller types" tests/contracts/ipc.test.mjs` | 0 | Initial focused check passed 2/2 before adding the missing invoke-error assertion. |
| `node --test --test-name-pattern="IPC factory accepts schema input\|IPC factory propagates invoke errors\|IPC caller types" tests/contracts/ipc.test.mjs` | 0 | Final focused check passed 3/3. It covered transformed request/result values, invalid runtime input without invocation, compile-time caller typing, and exact invoke-error propagation. |
| `npm run test:contracts` inside the restricted filesystem boundary | 1 | TypeScript passed, then esbuild could not read the parent directory or resolve `electron/preload.cts`. No product or test assertion ran or failed. |
| `npm run test:contracts` outside the restricted filesystem boundary | 0 | All 46 contract, table, property, IPC, permission, event, transition, schema, and development-URL tests passed. |
| `npm run typecheck` | 0 | Renderer/shared and Electron TypeScript configurations passed. |
| `npm test` outside the restricted filesystem boundary | 0 | Typecheck and production build passed, followed by 46/46 contract tests and 12/12 foundation, protected-file, build-shape, and clean-room tests. |
| `npm run test:sites` | 0 | All 4/4 protected Sites worker and packaging tests passed. |
| `npm run test:electron` outside the restricted filesystem boundary | 0 | The production build passed. The real Electron boundary emitted the valid IPC observation plus invalid-profile containment, renderer-load rejection, malformed-manifest rejection, malformed-runtime rejection, and cleanup confirmation. |
| Final protected-hash, output, Sites-copy, type-direction, and artifact-location audit | 0 | All four protected hashes matched WP-00, six required outputs existed, generated Sites copies matched their sources, caller and handler type directions were present, and no top-level `plans/` or `qa/` directory existed. |

The restricted `npm run test:contracts` failure reproduces the known managed-filesystem limitation. The identical command passed outside that boundary with no source change.

## Failure injection and assertions

The final contract suite contains 46 tests. The cycle-5-specific checks cover these cases:

1. Valid pre-parse string input reaches the fixed channel once as parsed number output.
2. Parsed number output is not accepted as caller input at compile time or runtime.
3. Missing and extra arguments fail compile-time checks. Existing runtime assertions also reject zero or two arguments before invocation.
4. The result schema transforms a raw string into the promised number.
5. A malformed result rejects with `ZodError`.
6. An invoke failure propagates the original error object after one parsed request and one invocation.

The Electron gate retained its broader failure cases: unsafe profile containment, renderer-load failure, malformed contract manifest, malformed runtime result, and owned temporary-directory cleanup.

## Final hashes and layout audit

Cycle-5 production and test hashes:

```text
shared/ipc.ts                                  F530255ECF24667FC886E76381A244FD8B5FBA7DEDF916006FB9E8854641312A
tests/contracts/ipc.test.mjs                   6573ACCDB597084819E84ADC67918DF38C31CE3A975962F567148ADF7A1F0676
tests/contracts/ipc-types.fixture.ts           1EA2C43E8CBC31C55F748E7BABADED9A93FC08438BC5F7A552A55873D6207BBF
tests/contracts/tsconfig.ipc-types.json        6EAB1585674973BC5A19E4D7FBEF4D94768CB2FBBB3695A58B282E2EF441271D
electron/main.ts                               DDE9EE34E33C9FC2F166DF66A588F3A2C4474D8E957316EAF652FAD7FFFE8326
electron/preload.cts                           1A8E0E7B094EB3791776F64848EC8DE4AFE7147C349AC20CF105EB4D17297D13
```

`shared/ipc.ts`, the compile fixture, its TypeScript configuration, and `electron/preload.cts` match the implementer-reported or retained hashes. The IPC test hash changed only because this tester added invoke-error failure injection.

Protected SHA-256 values:

```text
.openai/hosting.json                           D532ABB65CF9AE20634B464D954CB4A08A0DE9F3CD3CDF7F9C3EC8948826D947
worker/index.js                                2DD0615A445143933D88D4271F54F5D63EE951421FCD08C5A7617BB09C564389
scripts/prepare-sites-build.mjs                B6A6ADAA4FAB3234676116DD1C9CB6611275AB9D92DD26F5BF402393E3744BF6
tests/sites-worker.test.mjs                    96AF7B48906C6460C793356D7B6952F7D5026DBF5A502BEC0D9297FF04201C26
```

Required outputs exist:

```text
dist/client/index.html
dist/server/index.js
dist/.openai/hosting.json
dist/electron/main.js
dist/electron/preload.cjs
dist/shared/index.js
```

`dist/server/index.js` matches `worker/index.js`, and `dist/.openai/hosting.json` matches `.openai/hosting.json`. No top-level `plans/` or `qa/` directory exists.

## Verdict

**PASS.** The cycle-4 blocker is closed. The caller uses pre-parse schema input, main handlers retain parsed schema output, exact arity and transformed result typing compile correctly, and runtime request parsing, fixed-channel invocation, result validation, invalid-input containment, and error propagation all have passing evidence. WP-01 remains unverified pending the manager's required independent read-only review.
