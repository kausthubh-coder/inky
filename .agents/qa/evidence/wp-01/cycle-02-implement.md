# WP-01 cycle 2 implementation report

Role: implementer  
Date: 2026-08-30  
Execution speed: normal/default  
Package status: the requested repairs are implemented and local gates are green. WP-01 is not verified. Independent testing and read-only review remain with the manager.

## Behavior repaired

- Pattern permission rules now carry both `courseId` and `patternId`. The resolver accepts a strict assignment permission context with `assignmentId`, `courseId`, and unique `matchedPatternIds`. A pattern rule matches only when its course and deterministic pattern ID both match. Title substrings no longer authorize pattern-scoped rules. Specificity remains `assignment > pattern > course > global`, with the existing time and rule-ID tie breaks.
- Evidence URL screening normalizes parameter keys with Unicode NFKC, locale-stable lowercase, and removal of separators before exact comparison. Query and fragment keys now reject `token`, `auth`, `session`, `sessionid`, `cookie`, `api_key`, `api-key`, `apikey`, `access_token`, `authorization`, `client_secret`, and case or separator variants. The existing `password` and `secret` rejection remains. Exact normalized matching permits unrelated names such as `tokenizer`, `sessionDate`, `cookiePolicy`, and `clientSecretary`.
- The event envelope now has exactly `schemaVersion`, `eventId`, `aggregateType`, `aggregateId`, `runId`, `sequence`, `occurredAt`, `type`, and `payload`. `eventType` is gone from production contracts. Task transitions now accept caller-owned `eventId`, `runId`, and `sequence` metadata and return a canonical `task_state_changed` envelope with a typed payload.
- The development URL resolver now receives an explicit context containing `isPackaged` and the development environment. It returns no URL for packaged launches before inspecting any development variables. Electron main passes `app.isPackaged`. Unpackaged launches still require exact mode `1` and a credential-free `http://localhost` or `http://127.0.0.1` target.
- The real Electron self-test now injects malformed runtime and malformed manifest results separately. Both fail through the sandboxed preload and validated IPC boundary. Valid runtime and manifest output, renderer-load failure, invalid-profile parent and leaf containment, and cleanup remain covered.

## Focused blocker reproduction

Before editing, I built the cycle-1 output and ran a direct compiled-contract probe. It reproduced all four blockers:

```text
crossCoursePermission.mode auto_submit
crossCoursePermission.maySubmit true
secretUrlsAccepted token, auth, sessionid, cookie, api_key
canonicalEventAccepted false
packagedDevelopmentUrl http://localhost:5173/
```

After the repair, the same probe returned:

```text
crossCoursePermission.mode do_not_attempt
crossCoursePermission.maySubmit false
crossCoursePermission.matchedRuleId course-b-safe
secretUrlsAccepted []
canonicalEventAccepted true
transitionEventKeys schemaVersion,eventId,aggregateType,aggregateId,runId,sequence,occurredAt,type,payload
packagedDevelopmentUrl null
```

The focused contract run passed 34 tests. The later full contract gate passed 40 tests after the final context and main-wiring assertions were added. A direct real Electron run also passed valid IPC, malformed manifest, malformed runtime, renderer failure, invalid profile, and cleanup checks.

## Production files changed

- `shared/ids.ts`
- `shared/permission.ts`
- `shared/event.ts`
- `shared/task.ts`
- `electron/development-url.ts`
- `electron/main.ts`

## Tests and fixtures changed

- `tests/contracts/fixtures.mjs`
- `tests/contracts/permission.test.mjs`
- `tests/contracts/task-transition.test.mjs`
- `tests/contracts/schema.test.mjs`
- `tests/contracts/event-order.test.mjs`
- `tests/contracts/development-url.test.mjs`
- `tests/electron-self-test-runner.mjs`

This report is the only cycle-2 change under `.agents/qa/`. No package or dependency configuration changed. Required builds regenerated `dist/client/**`, `dist/electron/**`, `dist/shared/**`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Commands and exits

| Command | Exit | Result |
|---|---:|---|
| `npm run build:electron` in the restricted sandbox, before edits | 1 | TypeScript completed, then esbuild hit the known parent-directory access denial. |
| `npm run build:electron` outside the restricted sandbox, before edits | 0 | Produced the compiled cycle-1 contracts used by the blocker probe. |
| Direct pre-fix compiled-contract probe | 0 | Reproduced all four cycle-1 blockers listed above. |
| `npm run typecheck` after the first repair | 0 | Renderer/shared and Electron configurations passed. |
| `npm run build:electron` after the first repair | 0 | Shared and preload outputs built. |
| `node --test tests/contracts/permission.test.mjs tests/contracts/schema.test.mjs tests/contracts/event-order.test.mjs tests/contracts/task-transition.test.mjs tests/contracts/development-url.test.mjs` | 0 | 34 focused tests passed. |
| `node tests/electron-self-test-runner.mjs` | 0 | Valid IPC and all configured real Electron failure cases passed, including malformed runtime and manifest responses. |
| `npm run build:electron` before the post-fix probe | 0 | Final focused compiled output built. |
| Direct post-fix compiled-contract probe | 0 | All four reproductions returned the safe result listed above. |
| `npm run test:contracts` | 0 | 40 contract, property, table, boundary, and failure tests passed. |
| `npm run typecheck` | 0 | Renderer/shared and Electron TypeScript configurations passed. |
| `npm test` | 0 | Typecheck, production build, 40 contract tests, and 12 foundation/protected/clean-room tests passed. |
| `npm run build` | 0 | Produced the client, Electron, shared, server, and Sites hosting outputs. |
| `npm run test:sites` | 0 | 4 Sites worker and packaging tests passed. |
| `npm run test:electron` | 0 | Production build plus valid IPC, invalid profile, renderer failure, malformed manifest, malformed runtime, and cleanup checks passed. |
| Protected hash, output existence, and owned-source fingerprint scan | 0 | Protected hashes matched, all required outputs existed, and no top-level `plans/` or `qa/` directory existed. |

## Failed attempts

The first pre-edit `npm run build:electron` failed because the restricted Windows sandbox denied esbuild access to a parent directory. This was the same environmental failure recorded in cycle 1. I reran the unchanged command with the required outside-sandbox approval, and it exited 0. No implementation or test assertion needed weakening, and no post-edit test failed.

Git metadata is not available in this saved project. `git status --short` reported that the directory is not a Git repository. I constrained scope with `apply_patch`, explicit changed-file tracking, production source scans, protected hashes, build-shape tests, and the fingerprint below.

## Fingerprint and protected hashes

Cycle-2 owned source fingerprint for the 13 production, test, fixture, and runner files listed above:

```text
9895209E800AC55153373E0F8F73AC22EFA083AB13158AD0459A3000FF669FFE
```

Protected SHA-256 values after the final Electron gate:

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

## Remaining uncertainty and intentionally excluded work

- The pure resolver and main-source wiring prove packaged URL containment, but this cycle did not build or launch an installed packaged binary. That belongs to a later packaging gate.
- Pattern title matching is no longer an authorization path. A later discovery package must produce course-bound pattern identities and matched-pattern context before the permission resolver can apply a pattern rule.
- Later repository or coordinator work must allocate event IDs and per-aggregate sequences, then pass them with the run ID to `transitionTask`. WP-01 defines and validates that boundary but does not own persistence or allocation.
- Evidence key screening covers the approved normalized keys and retained `password` and `secret` keys. It does not guess that every vendor-specific parameter name contains a credential. New known credential keys should be added to the exact normalized set with positive and unrelated-word controls.
- The preload bundle remains about 715.5 KB because it includes the shared Zod validators.
- A visible normal-window Electron smoke and packaged installer run remain deferred. This cycle exercised the hidden isolated Electron self-test boundary.
- Independent cycle-2 testing and read-only maintainability review have not run. This implementer report does not claim WP-01 verification.
