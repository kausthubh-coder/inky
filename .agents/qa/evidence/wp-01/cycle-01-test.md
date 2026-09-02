# WP-01 cycle 1 independent test report

Role: independent tester  
Date: 2026-08-30  
Verdict: **fail**  
Final read-only review may start: **no**

The required npm gates are green, but adversarial checks found four production contract blockers. WP-01 must return to a fresh implementer cycle. I did not change production code, shared contracts, configuration, plans, the skill, `AGENTS.md`, or the evidence ledger.

## Blocking findings

### 1. A pattern rule can grant auto-submit to an unrelated course

Severity: blocking, permission safety.

`PatternPermissionRuleSchema` contains only `titleIncludes`. It has no `patternId`, `courseId`, or other assignment-pattern identity. `ruleMatches` therefore applies a pattern to every assignment with the same title substring, regardless of course. This conflicts with the approved local model, where `assignment_patterns` owns `course_id` and permission rules target a `scope_id`.

Smallest reproduction:

```js
const assignment = {
  assignmentId: "course-b-weekly",
  courseId: "course-b",
  title: "Weekly quiz",
};
const rules = [
  {
    schemaVersion: 1,
    ruleId: "course-b-safe",
    scope: "course",
    courseId: "course-b",
    mode: "do_not_attempt",
    updatedAt: "2026-08-30T12:34:56.000Z",
  },
  {
    schemaVersion: 1,
    ruleId: "course-a-pattern",
    scope: "pattern",
    titleIncludes: "weekly",
    mode: "auto_submit",
    updatedAt: "2026-08-30T12:34:56.000Z",
  },
];

resolvePermission(assignment, rules);
// mode: "auto_submit", maySubmit: true, matchedRuleId: "course-a-pattern"
```

Adding `courseId` to the pattern rule does not contain the match because the strict schema rejects that key. The contract needs a deterministic, course-bound pattern identity before the stated precedence can safely authorize submission.

Relevant paths:

- `shared/permission.ts:26`
- `shared/permission.ts:128`
- `.agents/plans/studi-master-plan.html:291`
- `.agents/plans/studi-master-plan.html:292`

### 2. Safe evidence URLs accept common credential-shaped query and fragment keys

Severity: blocking, credential redaction.

The source-target filter rejects the small set in the checked-in test, but it accepts these direct probes:

```text
https://school.example/a?token=secret
https://school.example/a?auth=secret
https://school.example/a?sessionid=secret
https://school.example/a#cookie=secret
https://school.example/a#session=secret
https://school.example/a#api_key=secret
https://school.example/a#token=secret
```

Controls such as `?client_secret=` and `?api-key=` were rejected. Strict evidence-object parsing also rejected unknown keys such as `rawHtml`, `password`, `cookie`, `authorizationHeader`, and `pageHtml`. The failure is limited to incomplete URL key handling, but it violates the safe-evidence boundary and can persist session or token material in an evidence record.

Relevant path: `shared/ids.ts:20`.

### 3. The event envelope does not implement the approved canonical event contract

Severity: blocking, shared architecture contract.

The master plan's event envelope includes `runId` and `type`. The implementation omits `runId` and names the type field `eventType`. Because the schema is strict, a canonical event carrying `runId` and `type` is rejected. This also removes the approved run correlation needed by later event-sourced task and agent packages.

Direct probe:

```js
EventEnvelopeSchema.safeParse({
  schemaVersion: 1,
  eventId: "event-1",
  aggregateType: "task",
  aggregateId: "task-1",
  runId: "run-1",
  sequence: 0,
  occurredAt: "2026-08-30T12:34:56.000Z",
  type: "task_discovered",
  payload: {},
}).success;
// false
```

Relevant paths:

- `shared/event.ts:8`
- `.agents/plans/studi-master-plan.html:326`

### 4. Packaged launches have no development-URL gate

Severity: blocking, retained WP-00 boundary.

`getDevelopmentUrl` checks only `STUDI_DEVELOPMENT_MODE` and the URL. Neither it nor the main process checks `app.isPackaged`. A packaged launch that receives `STUDI_DEVELOPMENT_MODE=1` and `VITE_DEV_SERVER_URL=http://localhost:...` will load the development server. The approved master plan explicitly retained packaged development-URL restrictions for WP-01.

The development URL function has no packaging input, `electron/main.ts` contains no `app.isPackaged` check, and the current test cannot express a packaged case.

Relevant paths:

- `electron/development-url.ts:6`
- `electron/main.ts`
- `.agents/plans/studi-master-plan.html:406`

## Checks that passed

### Schemas

- 11 canonical examples passed across assignment, evidence, all four permission-rule variants, task, run, event, tool mutation, and tool result.
- All 11 rejected schema version 999 and unknown top-level keys.
- Six malformed or non-normalized timestamp forms rejected.
- Empty and whitespace-only IDs rejected. IDs with meaningful text plus surrounding whitespace remain valid opaque strings.
- Four inconsistent permission-result combinations rejected.
- Credential-bearing authority URLs, non-HTTP URLs, full-page evidence keys, and the existing secret-key samples rejected.

### Task transitions

- Independently compared all 121 state and command pairs with the approved table.
- Exactly 22 allowed pairs succeeded and 99 pairs rejected.
- Every call preserved the input object.
- Success alone created a new task, incremented revision from 41 to 42, changed `updatedAt`, and produced matching event data.
- All five terminal states rejected all commands.

### Permission mechanics

- Two deterministic fast-check runs, seeds `101013` and `202013`, executed 2,000 generated cases.
- Specificity, newest `updatedAt`, lexical rule-ID tie, no-match `do_not_attempt`, and `maySubmit` if and only if `auto_submit` passed.
- Mismatched course, assignment, and title-pattern targets did not match.
- The separate cross-course pattern reproduction above failed because the contract has no course-bound pattern context.

### Event ordering

- First and strictly increasing sequences passed.
- Duplicate and decreasing sequences rejected.
- Gaps are allowed by the approved contract and were accepted, for example sequence 2 followed by 9.

### IPC and Electron boundary

- The registry snapshot contained only `getRuntimeInfo` and `getContractManifest` with the two fixed channels.
- Source scans found channel literals only in `shared/ipc.ts` outside tests and generated output.
- Main registration, handler removal, and preload method creation derive from the registry.
- Six malformed request shapes per method rejected. Four malformed runtime results and six malformed manifest results rejected at schema level.
- Renderer and preload expose no caller-selected channel and no generic send, listener, or invoke method.
- The real Electron self-test returned valid runtime and manifest data through the sandboxed preload.
- Real-boundary malformed manifest output failed promptly.
- Renderer-load rejection, `did-fail-load`, invalid profile, absent parent and leaf, and cleanup all passed.

### Development URLs

- Two credential-free `localhost` or `127.0.0.1` HTTP URLs passed.
- Fourteen remote, HTTPS, credentialed, malformed, non-HTTP, IPv6, and deceptive-host variants rejected.
- Missing or non-exact development mode rejected.
- Packaged-mode containment failed as described above.

### Build and clean-room boundaries

- Electron TypeScript emits one `dist/shared` module tree for main. Preload bundles the same registry and validators and ran under `sandbox: true` in Electron.
- Renderer imports `RuntimeInfo` and `StudiApi` from shared types. The duplicate renderer-only runtime interface is absent.
- Required build outputs exist: `dist/client/index.html`, `dist/server/index.js`, `dist/electron/main.js`, `dist/electron/preload.cjs`, `dist/shared/index.js`, and `dist/.openai/hosting.json`.
- No top-level `plans/` or `qa/` directory exists.
- All four protected hashes match WP-00.
- The 12 build-shape, protected-file, and clean-room regression tests passed.

### Browser preview

I started `vite preview` on `127.0.0.1:4177`, inspected it in the in-app browser, then closed the tab and stopped only that server. The page had one `data-studi-app-ready="true"` marker, the expected foundation copy, the browser-only bridge status, and no warning or error logs. A final TCP probe confirmed port 4177 was closed.

## Required command matrix

| Command | Exit | Result |
|---|---:|---|
| `npm run test:contracts` | 0 | 31 passed. The first sandboxed attempt exited 1 because esbuild could not read its parent directory; the approved outside-sandbox rerun is the authoritative result. |
| `npm run typecheck` | 0 | Renderer/shared and Electron configurations passed. |
| `npm test` | 0 | Typecheck, build, 31 contract tests, and 12 foundation tests passed. |
| `npm run build` | 0 | Production client, Electron, shared, server, and hosting outputs built. |
| `npm run test:sites` | 0 | 4 passed. |
| `npm run test:electron` | 0 | Valid self-test and all configured failure injections passed. |

Preview startup inside the restricted sandbox exited 1 for the same esbuild access denial. The approved outside-sandbox preview started successfully. Its final exit was 1 because I stopped the long-running server with Ctrl+C after inspection; this is not a preview failure.

## Test-suite false-positive and false-negative risk

- The evidence test samples only `access_token` and `authorization` URL forms, so several common secret keys pass unnoticed.
- The permission fixture defines a pattern as a global title substring. It cannot catch cross-course grants because the schema itself omits pattern identity and course context.
- The event fixture mirrors the implementation instead of the approved master event, so it does not detect missing `runId` or the `type` versus `eventType` mismatch.
- Development URL tests do not model `app.isPackaged` and therefore cannot enforce the retained packaged restriction.
- The real Electron malformed-result injection covers the contract manifest only. A malformed runtime response has schema-level coverage but no real-boundary injection.
- The arbitrary-IPC mutation test checks a synthetic string for obvious tokens. It does not execute the same detector against a mutated preload, so computed or aliased generic APIs could evade that mutation test. Current production source scans clean.
- A visible normal-window Electron smoke remains deferred. The browser preview and hidden isolated Electron self-test both passed, but they do not replace that later desktop gate.

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
Workspace: C:\Users\kaust\OneDrive\Documents\dev\studi-2
Git: unavailable, the saved project is not a Git repository
Fingerprint scope: 38 package/config, protected, shared, Electron, renderer, and test files
Aggregate SHA-256: 5AC454E9B19F7C15A68D53713B39713B566D5B376E576891D102ABB54D37FB83
```

Protected SHA-256 values:

```text
.openai/hosting.json            D532ABB65CF9AE20634B464D954CB4A08A0DE9F3CD3CDF7F9C3EC8948826D947
worker/index.js                 2DD0615A445143933D88D4271F54F5D63EE951421FCD08C5A7617BB09C564389
scripts/prepare-sites-build.mjs B6A6ADAA4FAB3234676116DD1C9CB6611275AB9D92DD26F5BF402393E3744BF6
tests/sites-worker.test.mjs     96AF7B48906C6460C793356D7B6952F7D5026DBF5A502BEC0D9297FF04201C26
```

## Tester-owned changes

- Added `.agents/qa/evidence/wp-01/cycle-01-test.md`.
- Required build commands regenerated `dist/client/**`, `dist/electron/**`, `dist/shared/**`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
- No tests or fixtures were changed.

## Handoff

Do not start the final read-only review. A fresh implementer cycle should fix the four blocking contract failures, add regression coverage for each reproduction, and add real-boundary malformed runtime-response coverage. The full required matrix and proportionate Electron checks must then run again before review.
