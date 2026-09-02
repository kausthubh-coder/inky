# WP-01 cycle 4 independent test report

Role: independent tester  
Date: 2026-08-31  
Verdict: **pass**  
Final read-only review may start: **yes**

The request-bearing IPC factory repair passes independent runtime and type-level testing. I found no production blocker in the cycle-4 boundary. I did not change production code, shared contracts, tests, fixtures, configuration, plans, the build-loop skill, `AGENTS.md`, the evidence ledger, or prior evidence. WP-01 remains unverified. The manager may consider verification only after the final read-only review.

## Independent IPC result

I exercised the compiled `createIpcApi` export with a synthetic strict-object request method, a void method, and recording invoke functions. This harness was passed directly to Node and did not create a repository fixture.

The runtime harness passed 29 assertions:

- A request `{ assignmentId: " Assignment-7 " }` reached only `synthetic:lookup-fixed`. Zod parsing forwarded `{ assignmentId: "assignment-7" }`, while the original caller object stayed unchanged.
- Zero, two, and three arguments rejected before invoke for the required request. A malformed object and an object with an extra property also rejected before invoke.
- The void method accepted exactly zero arguments and forwarded `undefined`. Passing even one `undefined` argument rejected before invoke.
- A malformed response rejected after exactly one invoke.
- A synchronous invoke throw and a rejected invoke promise each propagated by identity after exactly one invocation. Neither path retried.
- The returned API object was frozen.
- The production registry contained only `getRuntimeInfo` and `getContractManifest`, both with `z.undefined()` requests.
- The manifest matched a snapshot generated from the production registry's method keys and channels. Source inspection confirmed the production manifest uses `studiIpcMethods.map` and `studiIpcRegistry[method].channel`.
- Neither `shared/ipc.ts` nor `electron/preload.cts` contains an `as StudiApi` cast. Preload delegates to `createIpcApi`, exposes one `window.studi` object, invokes only through `ipcRenderer.invoke`, and contains no channel literal.

An in-memory TypeScript fixture passed separately. It proved the synthetic object method returns `Promise<{ found: boolean }>` and requires exactly one typed request, while the synthetic void method returns `Promise<{ ok: true }>` and accepts no argument. Three `@ts-expect-error` checks were consumed for a missing request, a second request argument, and `ping(undefined)`. The fixture wrote no file.

## Commands and exits

| Command | Exit | Result |
|---|---:|---|
| `npm run test:contracts` in the restricted sandbox | 1 | TypeScript passed. Esbuild then hit the known parent-directory access denial and could not resolve `electron/preload.cts`; tests did not start. |
| `npm run test:contracts` outside the restricted sandbox | 0 | 43 contract, table, property, IPC, permission, event, transition, and development-URL tests passed. |
| Independent 29-assertion IPC runtime harness | 0 | All required request forwarding, normalization, argument-count, response-validation, invoke-failure, freeze, registry, preload, and manifest checks passed. |
| In-memory TypeScript IPC fixture | 0 | Two valid result assignments typechecked and three invalid calls produced the expected compile errors. |
| `npm run typecheck` | 0 | Renderer/shared and Electron TypeScript configurations passed. |
| `npm test` in the restricted sandbox | 1 | Typecheck passed. The build then stopped at the same esbuild parent-directory access denial. |
| `npm test` outside the restricted sandbox | 0 | Typecheck and production build passed, followed by 43 contract tests and 12 foundation, protected-file, build-shape, and clean-room tests. |
| `npm run test:sites` | 0 | Four Sites worker and packaging tests passed. |
| `npm run test:electron` in the restricted sandbox | 1 | The build stopped at the same esbuild parent-directory access denial before Electron started. |
| `npm run test:electron` outside the restricted sandbox | 0 | Production build and the hidden Electron boundary passed valid IPC, invalid-profile containment, renderer-load failure, malformed manifest, malformed runtime, and cleanup checks. |
| Independent 38-check source/output regression harness | 0 | Final permission, evidence URL, canonical event, packaged development URL, registry, manifest, and preload boundaries passed across 16 source and compiled-output files. |
| Protected hash, output, artifact-location, environment, and 39-file fingerprint scan | 0 | Protected hashes matched, six required outputs existed, no top-level `plans/` or `qa/` directory existed, and every fingerprint path was present. |

The three exit-1 results share one environmental cause. The restricted Windows filesystem prevents esbuild from reading a parent directory while resolving the explicitly named preload entrypoint. Each unchanged command passed outside that restriction. No product assertion failed.

## Retained boundary regression

The independent source/output harness confirmed the earlier WP-01 repairs still hold:

- `maySubmit` is true only for `auto_submit` in both shared source and compiled output. A cross-course pattern rule resolves to `do_not_attempt` even when its pattern ID is listed.
- The compiled evidence target schema rejects sensitive query keys and fragment keys on either side of a later `?`, while accepting a credential-free route control. Shared source and output retain the normalized sensitive-key set and multi-segment fragment parsing.
- A canonical event with `runId` and `type` parses. Replacing `type` with `eventType` rejects. Neither active event/task source nor compiled shared output contains `eventType`.
- Packaged launches ignore development configuration before reading `VITE_DEV_SERVER_URL`. Source and generated main output pass `app.isPackaged` into the resolver.
- The compiled preload contains exactly the two production channel strings, one `ipcRenderer.invoke`, and one `exposeInMainWorld("studi", studiApi)`. It contains no `send`, `sendSync`, `on`, or `once` IPC call.

The production registry and manifest snapshot remained:

```text
getRuntimeInfo      -> studi:runtime-info       void request
getContractManifest -> studi:contract-manifest void request
```

All six required build outputs exist:

```text
dist/client/index.html
dist/server/index.js
dist/.openai/hosting.json
dist/electron/main.js
dist/electron/preload.cjs
dist/shared/index.js
```

No browser preview ran, as directed. Cycle 4 changed no renderer or UI behavior.

## Hashes and fingerprint

Protected SHA-256 values still match the approved baseline:

```text
.openai/hosting.json            D532ABB65CF9AE20634B464D954CB4A08A0DE9F3CD3CDF7F9C3EC8948826D947
worker/index.js                 2DD0615A445143933D88D4271F54F5D63EE951421FCD08C5A7617BB09C564389
scripts/prepare-sites-build.mjs B6A6ADAA4FAB3234676116DD1C9CB6611275AB9D92DD26F5BF402393E3744BF6
tests/sites-worker.test.mjs     96AF7B48906C6460C793356D7B6952F7D5026DBF5A502BEC0D9297FF04201C26
```

Cycle-4 implementation hashes match the implementer report:

```text
shared/ipc.ts                 4F920885BB6C6269E4F5803C8B522FD35342F90044C1C52AF27E1E7ADA0A84D0
electron/preload.cts          1A8E0E7B094EB3791776F64848EC8DE4AFE7147C349AC20CF105EB4D17297D13
tests/contracts/ipc.test.mjs  B64785B11A7C2002BFD0A0AEC32ECCD615C293357BF86DCFE6F38344DF558E53
shared/task.ts                585485A5EFDC4B89E9BBD97F697767F23E5862C5ABB14DA49FD5F84D8AF79B85
tests/build-shape.test.mjs    6314506420DF87714511AD274A529CDF52E51BBD7FF54C02CF1D91C7B4A68A2E
```

Environment:

```text
OS: Microsoft Windows NT 10.0.26200.0, x64
PowerShell: 7.6.4
Node: 24.19.0
npm: 11.17.0
Electron: 37.10.3
Zod: 4.5.4
fast-check: 4.9.0
esbuild: 0.25.12
TypeScript: 5.9.3
Workspace: C:\Users\kaust\OneDrive\Documents\dev\studi-2
Git: unavailable, the saved project is not a Git repository
Fingerprint scope: 39 package, lock, configuration, protected, shared, Electron, renderer, and test files
Aggregate SHA-256: 5A5B3C0835F9649E6759B31C4FF6A5A59A1474A1B8C600D01CDDB34202EDDB43
```

The aggregate hashes UTF-8 lines of `relative-path<TAB>SHA-256`, sorted by relative path. The evidence file itself is outside that implementation fingerprint.

## Remaining false-negative risk

- The type fixture uses the TypeScript compiler API in memory rather than a checked-in compile-failure fixture. It resolves the real shared source and consumes the intended invalid-call errors, but future regressions would rely on rerunning this evidence procedure unless the suite gains a permanent type fixture.
- Runtime detection treats only a direct `z.undefined()` as a zero-argument method. A wrapper schema that accepts `undefined` remains a one-argument method. The production registry and tested synthetic void method both use direct `z.undefined()` schemas.
- The preload output check is structural and the real Electron self-test exercises only the two current void methods. The synthetic request-bearing method runs through the real shared factory with a recording invoke function, not through an added production Electron channel.
- Packaged development URL containment is verified through the compiled resolver, source/generated wiring, and the Electron build. No installed packaged binary ran.
- The earlier evidence-URL limits remain: vendor-specific credential keys outside the denylist and consumers that decode a stored URL again need their own validation in later packages.

These risks do not block the approved WP-01 contract. They describe future coverage needs and out-of-package consumers.

## Tester-owned change and handoff

- Added `.agents/qa/evidence/wp-01/cycle-04-test.md` only.
- Required builds regenerated `dist/client/**`, `dist/electron/**`, `dist/shared/**`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
- No test or fixture was added or changed.

Final read-only review may start. This test pass does not mark WP-01 verified.
