# WP-12 runtime authentication failure review

Date: 2026-09-01 (America/New_York)  
Role: read-only failure reviewer  
Disposition: **one focused repair is blocking WP-12 integrated acceptance**

## Judgment and exact root cause

The renderer is showing a **real OpenAI Codex provider login that is still in progress**. It is not stale persisted state, a completed callback that failed to reset, or a false UI projection.

The evidence is conclusive:

- The live Electron process for the isolated WP-12 profile (PID 20932, launched with `--user-data-dir=C:\Users\kaust\AppData\Local\Temp\studi-wp12-live-20260901-150355`) still owns a listening socket on `127.0.0.1:1455`. That is Pi's OpenAI Codex OAuth callback server. The same process owns the loopback-only Electron CDP listener on port 9222.
- The isolated profile's `studi-data\pi\auth.json` is still two bytes, while the normal Studi profile's credential file is populated. No Codex credential has been committed in the isolated profile.
- `StudiApp.action()` sets `busy="login"`, awaits `window.studi.loginOpenAiCodex()`, and clears `busy` in `finally`. Therefore the visible `Waiting for sign-in…` label can remain only while the IPC promise is unresolved; it cannot survive a renderer reload or process restart as persisted state.
- `electron/preload.cts` is a direct typed `ipcRenderer.invoke` bridge. The `loginOpenAiCodex` handler in `electron/main.ts` awaits `runtime.loginOpenAiCodex()` and calls `readWorkspaceState()` only after that promise settles. The workspace is consequently not expected to refresh while OAuth is waiting.
- `PiAgentRuntime.loginOpenAiCodex()` in `electron/agent/runtime.ts` selects Pi's browser method, forwards the `auth_url` to `shell.openExternal`, and supplies a `manual_code` prompt that waits until Pi aborts it. Pi's installed OpenAI flow starts port 1455 and waits for a matching `/auth/callback`; no top-level abort signal or deadline is supplied by Studi.
- The live test explicitly observed the authorization page open outside the permitted Playwright targets and did not complete that external flow. No callback occurred, so there is no callback-reset defect to diagnose. The eight-second bounded wait is also not an OAuth timeout.

The current failure is therefore the lifecycle around that legitimate pending operation: if the external browser is inaccessible, closed, or abandoned, Studi leaves its only runtime control disabled indefinitely. The UI text is truthful, but the handoff is not recoverable from the app and is not reachable through the required Electron Playwright boundary.

This reconciles with the earlier green packages. WP-04/05 completed a real system-browser Codex sign-in, and WP-06/WP-07 then ran against the normal Studi profile's populated Pi credential store. WP-12 intentionally launched an isolated profile; its separate app-owned Pi directory begins unauthenticated and cannot inherit the normal profile's cached provider credential.

## Smallest reproduction

1. Launch the built app with a fresh isolated `--user-data-dir` and loopback-only Electron CDP.
2. Complete Clerk and Convex approval and enter first-run onboarding.
3. Activate `Connect Codex` once through the Electron Playwright target.
4. Do not complete the system-browser authorization that opens outside the Electron target.
5. Observe that the button becomes disabled at `Waiting for sign-in…` and remains there.
6. Read-only confirmation: the Electron main process is listening on `127.0.0.1:1455`, the isolated `studi-data\pi\auth.json` remains empty, and the provider projection remains `needs_login`.

No school flow, direct IPC bypass, credential mutation, or seeded state is needed.

## Focused repair brief

Make the provider-auth handoff a single transient main-process state machine with an explicit cancellation path, using Pi's existing device-code flow so the real handoff is visible and operable inside the Electron renderer.

1. In `electron/agent/runtime.ts`, change `PiAgentRuntime.loginOpenAiCodex()` / `answerCodexPrompt()` to accept a caller-owned `AbortSignal` and an explicit login method. For the desktop flow, select Pi's existing `device_code` method and forward its `device_code` notification; do not reimplement OAuth or token storage.
2. In `electron/main.ts`, let one `runtimeLoginAttempt` own the controller, pending promise, and transient handoff. `loginOpenAiCodex` should start or return that one attempt rather than hold the renderer request open until authorization completes. On success, failure, expiry, or cancellation, clear the attempt and have `readWorkspaceState()` project the fresh provider state. Do not allow a second concurrent provider login.
3. In `shared/product.ts` and `shared/ipc.ts`, add only the narrow transient login projection and one cancel command. The projection may contain Pi's device verification URI, user code, and phase; it must never contain tokens and must not be persisted.
4. In `src/app/StudiApp.tsx` and `src/app/OnboardingScreen.tsx`, render the device-code handoff, keep workspace status refreshed while it is active, and expose `Cancel`/`Try again`. Do not use renderer-local `busy` as the source of truth for the lifetime of provider authentication.

Acceptance checks:

- On a fresh isolated profile, `Connect Codex` produces a visible real device-code handoff in the Electron target instead of an indefinitely disabled spinner-only state.
- Completing that real provider handoff makes the existing workspace projection report `ready`, persists the credential only through Pi's app-owned store, and permits one real Pi turn.
- Cancelling, closing, or allowing the handoff to expire clears the main-process attempt, stops provider waiting, re-enables `Connect Codex`, and permits exactly one clean retry without restarting Studi.
- Relaunching during or after an abandoned attempt never restores `Waiting for sign-in…`; only a valid stored credential restores `ready`.
- A profile with the already valid cached credential still opens as ready without starting a login attempt.
- The focused runtime/IPC checks, typecheck, production build, and the no-Computer-Use Electron Playwright path remain green with zero renderer console errors.

This is deliberately one auth-attempt owner and one typed projection, not a second provider framework.

## Quality score and blocking status

**7.5/10.** The existing path is commendably direct: React calls one typed IPC method, Electron delegates to Pi, Pi owns OAuth and credentials, and the workspace reads provider status from the runtime. The present lifecycle gap is nevertheless concrete and costly: an abandoned real handoff creates an app-local dead end, and `busy` temporarily becomes a second, renderer-owned approximation of main-process work. The repair above restores one owner without broadening provider policy.

**Blocking:** yes, for WP-12's integrated acceptance. The approved journey requires a fresh user to authenticate the real provider and complete a real Pi turn through the closest real user boundary. Cached normal-profile evidence proves the downstream runtime but does not prove the fresh-profile WP-12 handoff, and bypassing it would violate the evidence rule.

## Explicit non-goals

- Do not copy, import, migrate, or inspect the normal profile's Pi credential in the isolated profile.
- Do not parse, log, expose, or persist access tokens, refresh tokens, authorization query strings, or callback payloads.
- Do not replace Pi's OAuth implementation or add a Studi-owned token exchange/callback server.
- Do not add generic provider abstractions, multiple simultaneous login attempts, automatic retries, or speculative recovery states.
- Do not change Clerk/Convex authentication, account approval, device binding, telemetry identity, school-browser credentials, LMS behavior, or school data.
- Do not use seeded readiness, direct IPC invocation, Computer Use, or a fake provider as integrated acceptance evidence.
