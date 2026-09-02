# WP-01 cycle 2 independent test report

Role: independent tester  
Date: 2026-08-30  
Verdict: **fail**  
Final read-only review may start: **no**

The four cycle-1 repairs work for their checked-in reproductions, and every required npm gate is green. A broader fragment probe found one remaining credential-redaction blocker. I did not change production code, shared contracts, configuration, plans, the skill, `AGENTS.md`, the evidence ledger, tests, or fixtures.

## Blocking finding

### Sensitive fragment keys are accepted when they appear before a later question mark

Severity: blocking, credential redaction.

`fragmentParameterKeys` treats every fragment prefix before the first `?` as a route and scans only the suffix. That is safe for `#/route?token=secret`, but it fails open when the prefix itself is a query-like fragment containing a sensitive key.

Smallest reproduction:

```js
SafeSourceTargetSchema.safeParse(
  "https://school.example/a#token=secret?view=1",
).success;
// true
```

The same probe accepted:

```text
https://school.example/a#ACCESS_TOKEN=secret?view=1
https://school.example/a#client-secret=secret?view=1
```

The route-style control `https://school.example/a#/route?view=1&token=secret` rejected correctly. The failure is in `shared/ids.ts:43-51`, where the code discards the prefix whenever the fragment contains `?`. These targets violate the approved rule that normalized token, access-token, and client-secret keys must not survive in evidence fragments.

The existing generated test does not cover this grammar. It generates either `#key=value` or `#/route?key=value`, so both branches pass while a key before a later `?` remains untested.

## Cycle-1 blocker reproductions

### Pattern permission containment

Pass. Pattern authorization now requires both the matching `courseId` and a `patternId` present in the strict assignment context.

- Missing `assignmentId`, `courseId`, or `matchedPatternIds` rejected.
- Duplicate matched pattern IDs rejected.
- A matching pattern in a foreign course did not match.
- A foreign pattern in the correct course did not match.
- A matching course and pattern with `auto_submit` produced `maySubmit: true`.
- A deterministic fast-check run completed 2,500 cases with seed `511013`. It independently checked matching, specificity, timestamp and rule-ID tie breaks, safe default, `mayAttempt`, `maySubmit`, and input immutability.

### Evidence target normalization

Partial pass with the blocker above.

- 243 query, direct-fragment, and route-fragment targets rejected across token, auth, session, session-id, cookie, api-key, access-token, authorization, and client-secret.
- The probes covered lowercase, uppercase, mixed case, hyphen, underscore, and collapsed separator variants.
- 30 unrelated-key controls passed, including `tokenizer`, `authentication`, `sessionDate`, `cookiePolicy`, `apiKeyLabel`, `accessibilityToken`, `authorizationCodeFlow`, and `clientSecretary`.
- The later-question-mark fragment form failed open.

### Canonical event envelope

Pass.

- `EventEnvelopeSchema` and every successful task transition used exactly `schemaVersion,eventId,aggregateType,aggregateId,runId,sequence,occurredAt,type,payload`.
- Removing any of the nine fields rejected.
- An unknown extra field rejected.
- Missing `type` plus legacy `eventType` rejected.
- Adding legacy `eventType` beside `type` rejected.
- `TaskTransitionEventSchema` rejected an unknown task-transition event type.

### Packaged development URL containment

Pass. An independent 112-case matrix crossed packaged and unpackaged contexts, eight mode values, and seven absent, local, remote, credentialed, HTTPS, and malformed URL values.

- All 56 packaged combinations returned no development URL, including exact mode `1` with a valid local URL.
- Unpackaged exact-mode local URLs were the only two allowed URL combinations.
- Eight absent-URL combinations returned no URL.
- The remaining 46 unpackaged combinations failed closed.
- Source inspection confirmed Electron main passes `app.isPackaged` into the resolver.

## Other independent verification

### Versioned schemas and safety fields

- Twelve canonical versioned schemas passed: assignment, evidence, all four permission-rule variants, task, run, event, tool mutation, tool result, and contract manifest.
- All twelve rejected schema version 999 and an unknown top-level key.
- Empty or malformed enum and safety combinations rejected for task state, run state, evidence kind, tool outcome, event aggregate type, and permission resolution.
- Evidence objects rejected eight injected secret or raw-content fields.
- Task transition commands rejected missing `eventId`, `runId`, `sequence`, and `occurredAt`.

### Task transitions and event ordering

- All 121 state pairs were compared with the dossier table.
- Exactly 22 allowed pairs succeeded and 99 rejected.
- Every call preserved both the task and command input objects.
- Every success returned a new task and a canonical transition event.
- Event ordering accepted an initial event and strict increases, including a gap from 2 to 9.
- Duplicate and decreasing sequences rejected.

### IPC and Electron boundary

- The IPC snapshot contained exactly `getRuntimeInfo` and `getContractManifest` with fixed channels `studi:runtime-info` and `studi:contract-manifest`.
- Source scans found both channel literals only in `shared/ipc.ts` outside tests and generated output.
- Source scans found no caller-selected channel API, generic renderer send/listen method, duplicate runtime-info interface, or independent contract source in main, preload, or renderer code.
- Twelve malformed IPC request values rejected at schema level.
- Four malformed runtime results and five malformed manifest results rejected at schema level.
- The standalone Electron runner passed a valid profile and real preload bridge, then failed closed for renderer-load failure, malformed runtime result, and malformed manifest result.
- Direct invalid-leaf and invalid-parent probes each returned child exit 1, emitted the owned-directory rejection, and created neither path.
- The Electron runner confirmed all owned temporary directories were removed.
- Electron uses `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`. Main compilation includes `shared/**/*.ts`; preload bundles imports from the same shared source.

### Build and clean-room boundary

- The required outputs exist: `dist/client/index.html`, `dist/server/index.js`, `dist/.openai/hosting.json`, `dist/electron/main.js`, `dist/electron/preload.cjs`, and `dist/shared/index.js`.
- All four protected hashes match WP-00.
- All 12 build-shape, protected-file, and clean-room regression tests passed.
- No top-level `plans/` or `qa/` directory exists.

### Browser preview

I started `vite preview` on `127.0.0.1:4178`, opened the built client in the in-app browser, inspected the DOM, full-page rendering, and warning/error console, then closed the tab and stopped only that server.

- Title: `Studi — your schoolwork agent`.
- Exactly one `data-studi-app-ready="true"` marker was present.
- The foundation copy and browser-only bridge status rendered visibly.
- The warning/error console was empty.
- A final listener probe reported `PORT_4178_CLOSED=true`.

## Required command matrix

| Command | Exit | Result |
|---|---:|---|
| `npm run test:contracts` in the restricted sandbox | 1 | Environmental esbuild parent-directory access denial. |
| `npm run test:contracts` outside the restricted sandbox | 0 | 40 passed. |
| `npm run typecheck` | 0 | Renderer/shared and Electron TypeScript configurations passed. |
| `npm test` | 0 | Typecheck, production build, 40 contract tests, and 12 foundation tests passed. |
| `npm run build` | 0 | Client, Electron, shared, server, and hosting outputs built. |
| `npm run test:sites` | 0 | 4 passed. |
| `npm run test:electron` | 0 | Valid IPC plus invalid profile, renderer failure, malformed manifest, malformed runtime, and cleanup passed. |
| `node tests/electron-self-test-runner.mjs` | 0 | Standalone real-boundary rerun passed all configured cases. |
| Independent 2,500-case permission probe | 0 | Seed `511013`; all properties passed. |
| Independent 121-pair transition and event probe | 0 | 22 accepted, 99 rejected; event and ordering checks passed. |
| Independent evidence and development-URL matrix | 0 | 243 sensitive variants rejected, 30 unrelated controls accepted, 112 development cases matched expectations. |
| Independent schema and IPC probe | 0 | 12 versioned schemas and malformed request/result cases passed. |
| Adversarial fragment probe | 0 | Command completed and exposed the blocking accepted targets above. |
| Direct invalid leaf and parent child-process probe | 0 outer, 1 each child | Both failed closed without creating a path. |

The first sandboxed preview attempt exited 1 because of the same esbuild access denial. The approved outside-sandbox preview started successfully. Its final process exit was 1 because I stopped the long-running server with Ctrl+C after inspection; the closed port confirms cleanup. An earlier PowerShell profile probe did not capture child exit codes reliably, so I discarded it and repeated the cases with synchronous child processes. Those authoritative child exits were both 1.

## Test-suite false-positive and false-negative risk

- The evidence fragment generator misses a sensitive key before a later `?`, which produced the blocker in this report.
- Secret-key matching is an exact normalized denylist. Vendor-specific credential names outside that list can still pass until the contract adds them.
- The base event envelope intentionally accepts any non-empty event `type`; concrete event schemas such as `TaskTransitionEventSchema` must constrain their own types. The current suite covers the one concrete event in WP-01.
- Malformed requests have schema and main-handler source coverage, but the supported preload API cannot send a malformed request because both methods take no request argument. Malformed results have real Electron failure injection.
- Arbitrary-IPC checks use source scans and a synthetic mutation. Computed or heavily aliased generic APIs could evade a simple text scan, though the current production preload exposes only the two derived named methods.
- Packaged URL containment was tested through the pure resolver and main wiring, not an installed packaged binary.
- The browser preview and hidden Electron self-test do not replace a later visible normal-window desktop smoke.

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
Aggregate SHA-256: 3CC4A19BB19BEC90FC7CEFF7E11D8057B6BAE1991A30AA2663CD8B8627084ECB
```

Protected SHA-256 values:

```text
.openai/hosting.json            D532ABB65CF9AE20634B464D954CB4A08A0DE9F3CD3CDF7F9C3EC8948826D947
worker/index.js                 2DD0615A445143933D88D4271F54F5D63EE951421FCD08C5A7617BB09C564389
scripts/prepare-sites-build.mjs B6A6ADAA4FAB3234676116DD1C9CB6611275AB9D92DD26F5BF402393E3744BF6
tests/sites-worker.test.mjs     96AF7B48906C6460C793356D7B6952F7D5026DBF5A502BEC0D9297FF04201C26
```

## Tester-owned changes

- Added `.agents/qa/evidence/wp-01/cycle-02-test.md` only.
- No tests or fixtures were added or changed.
- Required build commands regenerated `dist/client/**`, `dist/electron/**`, `dist/shared/**`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Handoff

Do not start final read-only review. A fresh implementer cycle should close the fragment-prefix bypass and add regression coverage for sensitive keys both before and after a later `?`. The full required matrix and evidence URL adversarial probes must run again before review. WP-01 remains unverified.
