# WP-03 cycle 1 implementation report

Package: WP-03 Pi runtime  
Cycle: 1  
Role: implementer  
Date: 2026-09-01

This is implementation evidence. It does not mark WP-03 verified. The manager still owns independent review and package closeout.

## Working state

The saved project has no `.git` directory, so there is no commit, branch, or Git diff. I used the existing gates and final SHA-256 hashes as the reproducible working-state record.

- `package.json`: `FBB8D54E023AA3BA94F91DE0C30D642267C64B757A3DCA2BB5ED2AB6E5DEBBD7`
- `package-lock.json`: `7783B57FDDB8CD14E3FE300480AB53F5A836974F83C0CAC8A66DE59493CBD790`
- `shared/agent-runtime.ts`: `C1572FDC55618C4C56A7D45D2C0EB3B7EBD825711836168B42ADC6A021453EE1`
- `electron/agent/runtime.ts`: `67DCC551161E5E782957293FE6718D175487A1327D9568916B1774CF898258CD`
- `tests/agent/agent-runtime.test.mjs`: `77EAE978858265C3275FB5B919604E6E8CE976F0424A18BA3CAC6EFD1745D30C`

The four protected Sites source files retain their approved hashes. Top-level `plans/` and `qa/` remain absent.

## Behavior changed

- Pinned `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `typebox` at `0.84.4`, `0.84.4`, and `1.3.7` respectively. `npm view` confirmed `0.84.4` is the current SDK release.
- Added a narrow `AgentRuntime` and `AgentSession` contract. A session can prompt, compact, abort, replace its underlying Pi session, subscribe to events, and dispose.
- Added `PiAgentRuntime`. It creates or opens Pi's persistent JSONL session through `SessionManager`, uses `ModelRuntime` for auth status, and creates an actual Pi `AgentSession`.
- The Pi resource loader disables extensions, skills, prompt templates, themes, and context files. Session construction uses `noTools: "all"`, an explicit `studi_probe` allowlist, and a post-create assertion that the configured and active tool lists contain only `studi_probe`.
- Added the harmless zero-argument `studi_probe` tool. It returns only a readiness message and `{ ready: true }` details.
- Added versioned shared schemas for text, tool start/end, retry, compaction, abort, and terminal events. Pi error text is replaced with fixed Studi messages before it can cross the boundary.
- Added provider states `ready`, `needs_login`, and `unavailable`, plus supported login methods. Status reads use `ModelRuntime.checkAuth`. They omit auth sources, credential data, paths, and upstream error text. Unknown provider input is not echoed.
- The Studi session wrapper owns one Pi subscription. `replace()` creates the next real Pi session, moves the internal subscription to it, retains Studi listeners, then disposes the prior session.
- Added `FakeAgentRuntime`. Its default probe turn is byte-for-byte equal to the normalized real Pi faux-provider turn, and callers may inject validated scripted turns.
- Extended the Electron self-test. It runs a deterministic faux model through a real Pi session, invokes `studi_probe`, persists the transcript, resumes the same session ID, confirms the one-tool boundary, and emits a redacted provider receipt.
- Added `npm run test:agent` and recorded it in the project `verify-studi` skill as the reusable focused check.

## Files changed

- Dependencies and scripts: `package.json`, `package-lock.json`.
- Shared contract: `shared/agent-runtime.ts`, `shared/index.ts`.
- Electron runtime: `electron/agent/runtime.ts`, `electron/main.ts`, `electron/tsconfig.json`.
- Checks: `tests/agent/agent-runtime.test.mjs`, `tests/build-shape.test.mjs`, `tests/clean-room-boundary.test.mjs`, `tests/electron-self-test-runner.mjs`.
- Verification instructions: `.agents/skills/verify-studi/SKILL.md`.
- Evidence: `.agents/qa/evidence/wp-03/cycle-01-implement.md`.

Generated files under `dist/` changed only through the build commands.

## Commands and exit codes

Baseline before edits:

- `npm run typecheck`: exit 0.
- `npm run test:contracts`: exit 0, 49 passed.
- `npm run test:foundation`: exit 0, 12 passed.
- `npm run test:storage`: exit 0, 27 passed.
- `npm run test:electron`: exit 0. The existing positive path and four rejection paths passed.

Dependency checks and installation:

- `npm view @earendil-works/pi-coding-agent version dist-tags --json`: exit 0, latest `0.84.4`.
- `npm view @earendil-works/pi-ai version dist-tags --json`: exit 0, latest `0.84.4`.
- `npm install --save-exact @earendil-works/pi-coding-agent@0.84.4`: exit 0.
- `npm install --save-exact typebox@1.3.7`: exit 0.
- `npm install --save-prod --save-exact @earendil-works/pi-ai@0.84.4`: exit 0.
- `npm ls @earendil-works/pi-coding-agent @earendil-works/pi-ai typebox --depth=0`: exit 0. All three exact versions are installed at the project root.

Focused development checks:

- `npm run build:electron`: exit 0.
- `npm run test:agent`: exit 0, 3 passed.
- `npm run test:foundation`: exit 0, 12 passed.
- `npm run typecheck`: exit 0.
- `npm run build && node tests/electron-self-test-runner.mjs --positive-only`: exit 0 after the empty-session correction described below.
- `npm run test:electron`: exit 0 after the correction. The full positive and rejection suite passed.

Final gate run after subtraction:

- `npm run typecheck`: exit 0.
- `npm run test:agent`: exit 0, 3 passed.
- `npm run test:contracts`: exit 0, 49 passed.
- `npm run test:foundation`: exit 0, 12 passed.
- `npm run test:storage`: exit 0, 27 passed.
- `npm run test:electron`: exit 0.

The final Electron receipt was:

```json
{"runtime":"pi-agent-session","sdkVersion":"0.84.4","sessionPersisted":true,"sessionResumed":true,"probeCompleted":true,"activeTools":["studi_probe"],"providerStatus":{"schemaVersion":1,"providerId":"unknown","providerName":"Unknown provider","state":"unavailable","loginMethods":[],"reason":"This provider is not registered in the Pi runtime."}}
```

## Failed attempts and corrections

1. The first full Electron run failed its new agent observation because the self-test tried to reopen an untouched empty Pi session. Pi returns a session path before it writes a JSONL header, so that path did not yet identify a resumable session. The self-test now completes a deterministic `studi_probe` turn first, then reopens the written session and confirms the same ID. The next positive-only run and both later full Electron runs passed.
2. A manual compaction attempt on the short two-turn probe session returned Pi's `Nothing to compact (session too small)` error. The runtime still emitted a real `compaction_start` followed by `compaction_end` with `failed`, which the focused test retains. A direct normalizer check covers the completed compaction shape without making a model call or inflating the transcript fixture.
3. Early SDK inspection looked for hoisted Pi subpackages before confirming the package's nested dependency layout. Those read-only path lookups failed. Installing the required direct public packages fixed module resolution; no source change depended on the failed lookups.

## Subtraction performed

- Kept Pi and the deterministic fake behind one domain contract. No generic provider adapter or provider registry was added.
- Kept settings in memory and disabled all resource discovery for this runtime. There is no second configuration owner.
- Removed duplicate event parsing from listener fan-out. Pi events validate in the normalizer, fake scripts validate when they enter the fake, and provider status validates when it leaves `ModelRuntime`.
- Removed an early abort `reason: "user"` field because Pi can also abort during session replacement. The event now reports only the fact that the run aborted.
- Kept one focused test file with three cases. It covers the real tool turn and resume, the real abort path, compaction and retry mapping, fake parity, provider states, redaction, and temp cleanup.

## Deliberate omissions

- No provider abstraction framework, manager, worker, browser tool, LMS logic, queue, memory, auth UI, renderer control, IPC method, or cloud call.
- No shell or file tool is registered. Pi global or project extensions, skills, prompts, themes, and context files cannot enter the Studi session.
- No paid model request and no live provider login. The faux provider drives the real Pi session in tests and Electron self-test.
- No Pi transcript is copied into SQLite. Pi keeps its own JSONL session.
- No retry policy, migration layer, compatibility adapter, or speculative recovery state was added.
- No master plan, approved dossier, conclusion, protected Sites source file, or `src/` product UI file was edited.

## Remaining blocker

No implementation blocker remains. WP-03 is ready for the manager's independent read-only review. This report does not claim verification or package completion.

`npm` reports unapproved install scripts for transitive `@google/genai` and `protobufjs` packages. The package manager did not run those scripts, and every Node and Electron gate passed with that state. I did not approve unrelated dependency scripts.
