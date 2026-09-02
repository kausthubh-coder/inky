# WP-01 cycle 4 implementation report

Role: implementer  
Date: 2026-08-30  
Execution speed: normal/default  
Package status: the cycle-3 IPC factory blocker is repaired and the requested implementation gates are green. WP-01 is not verified. Independent testing and read-only review remain with the manager.

## Behavior repaired

The shared IPC module now owns a generic `createIpcApi` factory. For each registry entry, the factory derives the callable signature from that entry's request and result schemas. A `z.undefined()` request creates a zero-argument method. Every other request schema creates a one-argument method.

At runtime, the factory checks the exact argument count before calling the supplied invoke function. It parses the request, invokes the registry's fixed channel with the parsed value, and parses the returned value. Missing, extra, and malformed arguments cannot reach `ipcRenderer.invoke`.

Preload now passes Electron's invoke function to the typed factory. It no longer creates zero-argument wrappers for every method or casts an untyped method table to `StudiApi`. The only completeness cast left in the factory follows an `Object.keys(registry)` loop. Each assigned method already carries the corresponding registry entry's conditional request signature and parsed result signature. A second narrow cast follows result parsing because Zod's generic base schema reports `.parse()` as `unknown` inside the generic function.

The public production registry remains exactly `getRuntimeInfo` and `getContractManifest`. The contract manifest now derives each method/channel pair from that registry and parses the derived list through `ContractManifestSchema` before export.

`transitionTask` now writes `STUDI_SCHEMA_VERSION` into its event instead of repeating the literal `1`.

## Executable synthetic contract

`tests/contracts/ipc.test.mjs` defines a test-only registry with:

- `findAssignment`, a request-bearing strict-object method on `synthetic:find-assignment`
- `getStatus`, a `z.undefined()` method on `synthetic:get-status`

The fake invoke log proves valid parsed requests reach the fixed channel. The test proves missing, extra, and malformed request arguments fail before invoke, malformed responses fail after invoke, and the void method accepts no arguments while forwarding parsed `undefined`. Neither synthetic method appears in the production registry.

## Files changed

- `shared/ipc.ts`
- `electron/preload.cts`
- `tests/contracts/ipc.test.mjs`
- `shared/task.ts`
- `tests/build-shape.test.mjs`
- `.agents/qa/evidence/wp-01/cycle-04-implement.md`

The build-shape assertion changed because the shared factory now freezes the bridge. The assertion checks preload delegates to `createIpcApi(studiIpcRegistry)` and checks the factory freezes its result.

Required builds regenerated `dist/client/**`, `dist/electron/**`, `dist/shared/**`, `dist/server/index.js`, and `dist/.openai/hosting.json`. No package dependency, plan, ledger, prior evidence, product decision, or protected source file changed.

## Commands and exits

| Command | Exit | Result |
|---|---:|---|
| First `npm run build:electron` | 1 | TypeScript rejected the generic method because Zod's base `.parse()` result was `unknown`. The repair added one result cast immediately after parsing, constrained to that definition's result-schema output. |
| Second `npm run build:electron` in the restricted sandbox | 1 | TypeScript passed. Esbuild then hit the known parent-directory access denial and could not resolve `electron/preload.cts` in the restricted context. |
| `node --test --test-name-pattern="IPC factory validates" tests/contracts/ipc.test.mjs` | 0 | The required synthetic request test ran first and passed 1/1 against fresh shared output. |
| First `npm run test:contracts` in the restricted sandbox | 1 | Esbuild hit the same sandbox-only entrypoint resolution denial before tests ran. |
| `npm run test:contracts` outside the restricted sandbox | 0 | 43 contract, table, property, IPC, transition, permission, event, and development URL tests passed. |
| `npm run typecheck` | 0 | Renderer/shared and Electron TypeScript configurations passed. |
| First `npm test` in the restricted sandbox | 1 | Esbuild hit the same sandbox-only entrypoint resolution denial during the build. |
| First `npm test` outside the restricted sandbox | 1 | Typecheck, build, and all 43 contract tests passed. One foundation source-shape assertion still expected `Object.freeze` and `studiIpcMethods.map` inside preload rather than the shared factory. |
| Final `npm test` outside the restricted sandbox | 0 | Typecheck and production build passed, followed by 43 contract tests and 12 foundation, protected-file, build-shape, and clean-room tests. |
| `npm run test:sites` | 0 | 4 Sites worker and packaging tests passed. |
| First `npm run test:electron` in the restricted sandbox | 1 | Esbuild hit the same sandbox-only entrypoint resolution denial before Electron started. |
| `npm run test:electron` outside the restricted sandbox | 0 | Production build and the real Electron boundary passed valid IPC, invalid profile containment, renderer-load failure, malformed manifest, malformed runtime, and cleanup checks. |
| Final scope, hash, and output scan | 0 | The allowlist remained two methods, no `as StudiApi` cast remained, all protected hashes matched prior evidence, all six required outputs existed, and no top-level `plans/` or `qa/` directory existed. |

## Failed attempts

The first compile exposed a real generic typing problem. The implementation now confines the necessary result cast to the value returned by `resultSchema.parse`; it does not cast an unvalidated response or the preload API.

The first full regression run outside the sandbox exposed a stale test assertion after ownership of bridge freezing moved from preload to the shared factory. I updated only that build-shape assertion and reran the complete gate successfully.

Three restricted-sandbox commands failed at the same esbuild resolution step. Their approved outside-sandbox reruns passed. These were environment failures, not alternative implementation attempts.

Git metadata is unavailable because the saved project is not a Git repository. I constrained the edit with `apply_patch`, the exact owned-file list above, focused source scans, executable gates, protected-file tests, and final hashes.

## Final hashes and outputs

Changed source and test SHA-256 values:

```text
shared/ipc.ts                 4F920885BB6C6269E4F5803C8B522FD35342F90044C1C52AF27E1E7ADA0A84D0
electron/preload.cts          1A8E0E7B094EB3791776F64848EC8DE4AFE7147C349AC20CF105EB4D17297D13
tests/contracts/ipc.test.mjs  B64785B11A7C2002BFD0A0AEC32ECCD615C293357BF86DCFE6F38344DF558E53
shared/task.ts                585485A5EFDC4B89E9BBD97F697767F23E5862C5ABB14DA49FD5F84D8AF79B85
tests/build-shape.test.mjs    6314506420DF87714511AD274A529CDF52E51BBD7FF54C02CF1D91C7B4A68A2E
```

Protected SHA-256 values:

```text
.openai/hosting.json            D532ABB65CF9AE20634B464D954CB4A08A0DE9F3CD3CDF7F9C3EC8948826D947
worker/index.js                 2DD0615A445143933D88D4271F54F5D63EE951421FCD08C5A7617BB09C564389
scripts/prepare-sites-build.mjs B6A6ADAA4FAB3234676116DD1C9CB6611275AB9D92DD26F5BF402393E3744BF6
tests/sites-worker.test.mjs     96AF7B48906C6460C793356D7B6952F7D5026DBF5A502BEC0D9297FF04201C26
```

Required outputs present after the final gate:

```text
dist/client/index.html
dist/server/index.js
dist/.openai/hosting.json
dist/electron/main.js
dist/electron/preload.cjs
dist/shared/index.js
```

## Remaining uncertainty and excluded work

- Runtime zero-argument detection intentionally recognizes only an actual `z.undefined()` schema. A wrapper schema that also accepts `undefined` remains a one-argument method, matching the stated contract but not yet covered by a separate synthetic case.
- The executable synthetic registry proves runtime behavior in plain JavaScript. The project typecheck proves the production `StudiApi` mapping and current zero-argument calls, but this cycle did not add a separate compile-failure fixture for invalid synthetic calls.
- Evidence redaction, pattern provenance ownership, preload bundle size, source-map policy, packaging, and new public IPC methods remain outside this cycle.
- Independent cycle-4 testing and read-only review have not run. This implementer report does not claim WP-01 verification.
