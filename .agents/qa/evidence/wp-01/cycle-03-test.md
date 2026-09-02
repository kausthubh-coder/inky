# WP-01 cycle 3 independent test report

Role: independent tester  
Date: 2026-08-30  
Verdict: **pass**  
Final read-only review may start: **yes**

The cycle-2 fragment-prefix blocker is closed. I found no production blocker in the cycle-3 boundary. I did not change production code, shared contracts, tests, fixtures, package or TypeScript configuration, plans, the build-loop skill, `AGENTS.md`, the evidence ledger, or prior evidence. WP-01 is not verified; that decision remains with the manager after independent review.

## Security boundary result

### Exact required reproductions

The compiled `SafeSourceTargetSchema` rejected every required form:

```text
#token=secret?view=1
#access-token=secret?view=1
#client_secret=secret?view=1
#view=1?token=secret
```

It also rejected sensitive keys at the start, middle, and end of fragments containing up to three literal `?` separators.

### Independent generated matrix

A deterministic generated matrix exercised 485 targets against `dist/shared/index.js`:

- 399 sensitive targets crossed 57 case and separator key variants with seven layouts. The layouts put keys before and after one or more `?` characters, inside mixed route text, and after `&`, literal `&amp;`, or `;`. All 399 rejected.
- 44 targets percent-encoded every character in a sensitive key and placed the key in four fragment layouts. All 44 rejected after `URLSearchParams` decoded the key.
- 35 unrelated-key controls crossed the same seven layouts. `authorizationNote`, `tokenCount`, `sessionTheme`, `cookiePolicy`, and `authenticationMethod` all remained accepted.
- Three credential-free route or ordinary-fragment controls remained accepted.
- Four percent-encoded delimiter forms remained accepted: `%26`, `%3B`, `%3F`, and `%3D`. Interpreting those bytes as parameter delimiters requires another decode after standard URL parsing. The approved WP-01 contract does not define double-decoding, so these are uncovered cases, not new failures. If a later consumer decodes stored targets again, that consumer must reject or revalidate them.

A smaller 32-case table independently covered the four named reproductions, multi-`?` ordering, route text, `&amp;`, semicolons, case changes, hyphen, underscore, collapsed keys, percent-encoded key characters, required controls, and the four uncovered delimiter forms. It had zero mismatches.

## Package gate

### Required commands

| Command | Exit | Result |
|---|---:|---|
| Independent 32-case fragment table | 0 | 21 required sensitive forms rejected, seven controls accepted, and four double-decode delimiter cases were recorded as uncovered. |
| Independent 485-case generated fragment matrix | 0 | 443 sensitive targets rejected, 38 controls accepted, four double-decode delimiter cases accepted as expected, zero mismatches. |
| `npm test` in the restricted sandbox | 1 | Environmental esbuild parent-directory access denial. TypeScript had passed before esbuild failed to resolve the preload entry. |
| `npm test` outside the restricted sandbox | 0 | Typecheck and production build passed, followed by 42 contract tests and 12 foundation, protected-file, build-shape, and clean-room tests. |
| `npm run test:sites` | 0 | Four Sites worker and packaging tests passed. |
| `npm run test:electron` outside the restricted sandbox | 0 | Production build and hidden Electron boundary passed valid IPC, invalid profile containment, renderer-load failure, malformed manifest, malformed runtime, and owned-directory cleanup. |
| Protected hash, output, top-level directory, and source/output containment scan | 0 | 23 checks passed. |
| Supplemental canonical-event and fixed-channel source/output scan | 0 | Two checks passed. |
| Corrected 39-file fingerprint command | 0 | Produced the aggregate SHA-256 below with no missing files. |

The sandbox failure matches the previously recorded Windows restriction and is not a product failure. The same gate passed without changing source or assertions when run in the approved outside-sandbox context.

Two draft fingerprint commands were discarded. The first exited 0 while PowerShell emitted a non-terminating missing-file error for `vite.config.ts`. The second exited 1 after correctly trapping the still-wrong name `vite.config.js`. The corrected command used the checked-in `vite.config.mjs`, verified every scoped path existed, and exited 0.

## Regression containment

The final source and generated-output scan confirmed the cycle-2 boundaries remain present:

- Pattern permission matching still requires both matching `courseId` and a listed `patternId` in source and compiled shared output.
- The canonical event envelope still uses `type` and contains no production `eventType` field in source or compiled shared output.
- Packaged development URL containment still checks `context.isPackaged` first, and Electron main still passes `app.isPackaged`. The generated main output retains that wiring.
- Main IPC handlers still parse requests and results through the shared registry in source and generated output.
- The preload still derives and freezes named methods, invokes only each contract's fixed channel, exposes only `window.studi`, and contains no `send`, `sendSync`, `on`, or `once` primitive.
- The two channel literals occur only in `shared/ipc.ts` outside tests and generated output. No duplicate `RuntimeInfo` interface exists in active source.

All six required build outputs exist:

```text
dist/client/index.html
dist/server/index.js
dist/.openai/hosting.json
dist/electron/main.js
dist/electron/preload.cjs
dist/shared/index.js
```

No top-level `plans/` or `qa/` directory exists.

Protected SHA-256 values match cycles 1 and 2:

```text
.openai/hosting.json            D532ABB65CF9AE20634B464D954CB4A08A0DE9F3CD3CDF7F9C3EC8948826D947
worker/index.js                 2DD0615A445143933D88D4271F54F5D63EE951421FCD08C5A7617BB09C564389
scripts/prepare-sites-build.mjs B6A6ADAA4FAB3234676116DD1C9CB6611275AB9D92DD26F5BF402393E3744BF6
tests/sites-worker.test.mjs     96AF7B48906C6460C793356D7B6952F7D5026DBF5A502BEC0D9297FF04201C26
```

Cycle-3 source and regression-test hashes:

```text
shared/ids.ts                   855EE5B9E7408F055F155C53CB0636EA511B692F7C3D4ED67D03B6EED2810172
tests/contracts/schema.test.mjs 193DF472877B1950F94BDFD604BAE74EBC6FA8761BDE5610C4A842CDF2C2CCF7
```

## False-positive and false-negative risk

- Sensitive-key matching remains an exact normalized denylist. Vendor-specific credential names outside it can pass until the contract adds them.
- Splitting on every literal `?` fails closed for a nested URL-like value containing a denied key. That can reject a safe outer parameter whose value merely contains such text.
- Percent-encoded separators are not reinterpreted after `URLSearchParams` parsing. They become a risk only if a later consumer performs another decode without revalidating the result.
- Literal `&amp;` was tested and rejected when it preceded a sensitive key. Other HTML entity spellings were not tested because HTML entity decoding is not part of the URL contract.
- Source scans are narrow text assertions. The contract and Electron suites provide the behavioral checks, but a heavily aliased future generic IPC API could need a stronger structural scan.
- Packaged URL containment is covered through the pure resolver, source wiring, and generated main output, not an installed packaged binary.
- No browser preview ran in cycle 3, as directed. Renderer and UI code were outside this repair, and cycle 2 already passed the preview.

## Environment and working-state fingerprint

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
Fingerprint scope: 39 package, lock, config, protected, shared, Electron, renderer, and test files
Aggregate SHA-256: 91F4518A7CAF4C6C8FB8F02202B7D7603A8A4BDDDF4A9BACBD5BFA99CBC8BC29
```

## Tester-owned changes

- Added `.agents/qa/evidence/wp-01/cycle-03-test.md` only.
- No tests or fixtures were added or changed.
- Required build commands regenerated `dist/client/**`, `dist/electron/**`, `dist/shared/**`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Handoff

Final read-only review may start. This test pass does not mark WP-01 verified.
