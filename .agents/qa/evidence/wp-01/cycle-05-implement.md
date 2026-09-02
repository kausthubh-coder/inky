# WP-01 cycle 5 implementation report

Role: implementer  
Date: 2026-08-31  
Execution speed: normal/default  
Package status: the cycle-4 IPC caller typing blocker is repaired and the requested implementation gates are green. WP-01 is not verified. Independent testing and read-only review remain with the manager.

## Behavior repaired

`RequestArguments` in `shared/ipc.ts` now types request-bearing caller arguments as `z.input<Definition["requestSchema"]>`. This matches the value accepted by `requestSchema.parse()`. `RequestFor`, which types main-process handlers, remains `z.output<StudiIpcRegistry[Method]["requestSchema"]>`, so handlers continue to receive parsed request values.

The runtime factory did not change. It still enforces exact arity, parses and normalizes the request before invoke, invokes the registry-owned channel once, validates the result, returns the parsed result output, freezes the generated API, and propagates invoke errors. The production registry and derived manifest remain unchanged.

## Stable transform-schema regression

`tests/contracts/ipc-types.fixture.ts` defines a synthetic `measure` method with a request schema that transforms a string into its length and a result schema that transforms a string into its length. The checked-in fixture proves:

- `api.measure("studi")` compiles.
- `api.measure(5)` is rejected, even though `5` is the parsed request type.
- missing and extra request arguments are rejected.
- the return type is `Promise<number>`, not `Promise<string>`.

`tests/contracts/tsconfig.ipc-types.json` compiles that fixture under the project's strict TypeScript settings. `tests/contracts/ipc.test.mjs` runs this compiler check during every contract-suite run.

The paired runtime test calls `measure("studi")`, receives the parsed result value `8`, and records one invoke on `synthetic:measure` with normalized request `5`. Calling `measure(5)` at runtime rejects with `ZodError` and leaves the invoke log at one call.

## Files changed

- `shared/ipc.ts`
- `tests/contracts/ipc.test.mjs`
- `tests/contracts/ipc-types.fixture.ts`
- `tests/contracts/tsconfig.ipc-types.json`
- `.agents/qa/evidence/wp-01/cycle-05-implement.md`

Required builds regenerated `dist/client/**`, `dist/electron/**`, `dist/shared/**`, `dist/server/index.js`, and `dist/.openai/hosting.json`. I did not edit any other production source, package configuration, plan, dossier, ledger, prior evidence, product decision, or protected source file. Git metadata is unavailable because this saved project is not a Git repository, so I constrained edits with `apply_patch`, exact owned paths, hashes, source scans, and executable gates.

## Commands and exits

| Command | Exit | Result |
|---|---:|---|
| `node node_modules/typescript/bin/tsc -p tests/contracts/tsconfig.ipc-types.json` | 0 | The checked-in transform-schema caller fixture compiled. All four `@ts-expect-error` assertions were consumed. |
| `npm run typecheck` | 0 | Renderer/shared and Electron TypeScript configurations passed. `npm test` later reran the same typecheck successfully. |
| First `npm run build:electron` in the restricted sandbox | 1 | TypeScript passed. Esbuild then hit the known parent-directory access denial and could not resolve `electron/preload.cts`. |
| `npm run build:electron` outside the restricted sandbox | 0 | TypeScript and the preload bundle passed without source changes. |
| `node --test --test-name-pattern="IPC factory accepts schema input|IPC caller types" tests/contracts/ipc.test.mjs` | 0 | Both focused transform-schema runtime and compile-time regressions passed. |
| `npm run test:contracts` outside the restricted sandbox | 0 | All 45 contract, table, property, IPC, permission, event, transition, schema, and development-URL tests passed. |
| `npm test` outside the restricted sandbox | 0 | Typecheck and production build passed, followed by all 45 contract tests and all 12 foundation, protected-file, build-shape, and clean-room tests. |
| `npm run test:sites` | 0 | All 4 Sites worker and packaging tests passed. |
| `npm run test:electron` outside the restricted sandbox | 0 | Production build and the real Electron boundary passed valid IPC, invalid-profile containment, renderer-load failure, malformed manifest, malformed runtime, and cleanup checks. |
| Final hash, output, source, and artifact-location scan | 0 | Protected hashes matched prior evidence, all six required outputs existed, caller and handler type directions were present, and no top-level `plans/` or `qa/` directory existed. |

The one exit-1 result was the same restricted-filesystem esbuild failure documented in cycle 4. The identical command passed outside that restriction. No type or product assertion failed.

## Final hashes and locations

Scoped source and test SHA-256 values:

```text
shared/ipc.ts                                  F530255ECF24667FC886E76381A244FD8B5FBA7DEDF916006FB9E8854641312A
tests/contracts/ipc.test.mjs                   F22421096992C70CFA2A88FC53ACA01E78F343FFE5756B8E21D6DE63C91346F6
tests/contracts/ipc-types.fixture.ts           1EA2C43E8CBC31C55F748E7BABADED9A93FC08438BC5F7A552A55873D6207BBF
tests/contracts/tsconfig.ipc-types.json        6EAB1585674973BC5A19E4D7FBEF4D94768CB2FBBB3695A58B282E2EF441271D
```

Protected SHA-256 values match the cycle-4 evidence:

```text
.openai/hosting.json                           D532ABB65CF9AE20634B464D954CB4A08A0DE9F3CD3CDF7F9C3EC8948826D947
worker/index.js                                2DD0615A445143933D88D4271F54F5D63EE951421FCD08C5A7617BB09C564389
scripts/prepare-sites-build.mjs                B6A6ADAA4FAB3234676116DD1C9CB6611275AB9D92DD26F5BF402393E3744BF6
tests/sites-worker.test.mjs                    96AF7B48906C6460C793356D7B6952F7D5026DBF5A502BEC0D9297FF04201C26
```

Previously changed cycle-4 files outside this cycle's ownership also retain their recorded hashes:

```text
electron/preload.cts                           1A8E0E7B094EB3791776F64848EC8DE4AFE7147C349AC20CF105EB4D17297D13
shared/task.ts                                 585485A5EFDC4B89E9BBD97F697767F23E5862C5ABB14DA49FD5F84D8AF79B85
tests/build-shape.test.mjs                     6314506420DF87714511AD274A529CDF52E51BBD7FF54C02CF1D91C7B4A68A2E
```

Required outputs were present after the final gate:

```text
dist/client/index.html
dist/server/index.js
dist/.openai/hosting.json
dist/electron/main.js
dist/electron/preload.cjs
dist/shared/index.js
```

No top-level `plans/` or `qa/` directory exists. The dossier, ledger, prior evidence, `AGENTS.md`, and protected Sites source files were not edited.

## Remaining uncertainty and excluded work

- Zero-argument detection still recognizes only a direct `z.undefined()` request schema. A wrapper schema that accepts `undefined` remains a one-argument method. This behavior is unchanged and outside the cycle-5 blocker.
- The real Electron registry still contains only the two approved void methods. The transform-schema method exercises the same compiled shared factory with a recording invoke function, not a new production Electron channel.
- The compile-time test invokes the project's installed TypeScript CLI through its local `node_modules` path. Contract tests already require installed development dependencies, and TypeScript remains pinned in `package-lock.json`.
- Evidence redaction, pattern provenance, preload bundle size, source-map policy, packaging, and new public IPC methods remain outside this cycle.
- Independent cycle-5 testing and read-only review have not run. This report does not claim WP-01 verification.
