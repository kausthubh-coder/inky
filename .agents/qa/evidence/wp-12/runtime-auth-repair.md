# WP-12 runtime authentication repair evidence

Date: 2026-09-01 (America/New_York)  
Role: focused repair implementer  
Scope: blocking OpenAI Codex runtime-auth handoff only; this is not a package conclusion.

## Delivered behavior

- Electron owns one transient OpenAI Codex login attempt and one `AbortController`. Repeated starts reuse the active attempt; cancel, success, failure, Pi expiry, protected-runtime disposal, and process relaunch cannot retain an active controller.
- `PiAgentRuntime` explicitly selects Pi 0.84.4's existing `device_code` method, passes the caller-owned abort signal, forwards the typed device-code notification, and leaves OAuth exchange and credential persistence in Pi's app-owned store.
- The typed workspace projection exposes only `phase`, the HTTPS verification URI, one-time user code, and ISO expiry. Terminal failure/expiry contains no upstream error or credential material. The cancel IPC is the only new command.
- Onboarding starts login with a short IPC request, renders the real code and expiry, and offers Cancel or Try again. It polls the Electron projection with one non-overlapping read only while the attempt is active. The removed renderer `busy="login"` state no longer approximates provider-auth lifetime.
- Existing ready-provider behavior is unchanged. Successful Pi login clears the transient handoff, the next workspace read observes provider readiness, and no Studi-owned token path was added.

## Production files

- `electron/agent/provider-login.ts` — single transient attempt owner, Pi-expiry timer, cancel/dispose, and retry-safe terminal projection.
- `electron/agent/runtime.ts` — explicit Pi login method and abort signal; safe device-code notification/opening.
- `electron/main.ts` — process-owned attempt lifecycle, start/cancel IPC handlers, workspace projection, and shutdown/sign-out cleanup.
- `shared/browser-agent.ts` — strict device-code handoff union on the workspace state.
- `shared/ipc.ts` — one cancel command and contract version 8.
- `src/app/StudiApp.tsx`, `src/app/OnboardingScreen.tsx`, `src/app/app.css` — main-owned polling and visible device-code/cancel/retry UI.

## Focused checks

| Command | Exit | Evidence |
| --- | ---: | --- |
| `npm run test:agent` | 0 | 15/15 pass. Covers native Pi `device_code` selection and notification forwarding; one attempt owner; strict projection; cancel/retry; success/clear; generic failure; Pi-derived expiry. An injected `accessToken` field is rejected. |
| `npm run test:contracts` | 0 | 48/48 pass. Contract v8 contains the fixed `cancelOpenAiCodexLogin` channel and preserves typed request/result validation. |
| `npm test` | 0 | Typecheck, production build, 48 contract tests, and 12 foundation/clean-room/protected-file tests pass. Required Sites outputs were produced. |
| `npm run test:electron` | 0 | Real Electron/SQLite/Pi/browser/tray self-test passes with contract v8, one main landmark, successful focus movement, zero password fields, malformed-result rejection, and cleanup receipt. |
| `npm run test:sites` | 0 | 4/4 pass; `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json` exist. |
| touched-production secret-field scan | 0 | `NO_AUTH_SECRET_FIELDS_IN_TOUCHED_PRODUCTION_FILES`; no access-token, refresh-token, authorization-code, query, or callback-payload field entered the repair path. |

The production build retains the pre-existing Vite advisory for the approximately 663 kB Pi runtime chunk. It is unrelated to this repair.

## Failed attempt retained

The first focused run was 14/15 because the expiry/retry test expected the intermediate `starting` phase. Its fake Pi callback emitted a replacement device code synchronously, so the owner correctly returned the already-advanced `waiting` phase. The assertion was corrected to the observable contract; no production change was made for that failure. The rerun passed 15/15.

## Subtraction and deliberate omissions

- Removed the renderer's obsolete login-busy variant.
- Kept one concrete OpenAI Codex attempt owner instead of a provider framework or generic auth state machine.
- Kept only the Pi-expiry timer and changed renderer polling to serial reads so slow provider checks cannot overlap.
- Added no OAuth exchange, callback server, token parser/store, automatic retry, alternate provider, fake readiness, credential migration, school-flow change, or conclusion artifact.
- A real provider login and real Pi turn were deliberately not completed; the fresh read-only tester owns that acceptance boundary.

## Working-tree fingerprint

This saved project checkout has no `.git` metadata, so the touched-file SHA-256 set is the reproducible fingerprint:

```text
c83dd2df0aa095469ef35e91d0849a7abe5fa203d978e175528c2977c85bbb31  shared/browser-agent.ts
e1a0c99c5f54185a3997d849510c66581b1d1508815f993ef797155a02711bfa  shared/ipc.ts
cb73d95e76e34d925baa5388b382398113303e091adbc5b250a543580f5ea457  electron/agent/provider-login.ts
404a402b98a16e9d83ae75d64b9bff157dd1723a6b1a317c22c4f7838f32ffd9  electron/agent/runtime.ts
c38db5442a7ef415cce531acbc6e6a33079d67db493ed19e96318bd43990b3c4  electron/main.ts
b6021da3098138347526af044aad23764eff0138e23f7cca561cf735b05c353c  src/app/StudiApp.tsx
cafc6230153b2a04e8205f0e8c6405a00937ce88aa69a71c6996c974ee631511  src/app/OnboardingScreen.tsx
96e9fab6d259c79e752bf9fd7a7239848b4eb8d8dcccb134b8cd397450f86ec5  src/app/app.css
b7e96c386e149cb12d7e3ac7cf51a1b4e0368731a77379b6656d8eda805716b2  tests/agent/provider-login.test.mjs
5198d56e0b8bf21ff567fd79fb94218e1e56a7ff16949fe2bc5f963d0c7a7fcf  tests/agent/agent-runtime.test.mjs
b8bbf87621da3ceffa2a7ae6920932399ca3bc85b2d3e631045a0a7f6c92261c  tests/contracts/ipc.test.mjs
b21101c10a0dc93ded8af5da2b5accc93f112388a6ca820b9694ff2d2819971f  tests/electron-self-test-runner.mjs
```
