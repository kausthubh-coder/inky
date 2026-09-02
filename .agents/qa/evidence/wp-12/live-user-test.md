# WP-12 integrated live user test

Date: 2026-09-01 (America/New_York)  
Role: fresh read-only integrated user tester  
Outcome: **FAIL at Codex runtime authentication after successful dedicated Clerk + Convex approval**

## Runtime used

- Existing built Electron process: `electron . --user-data-dir=...\\studi-wp12-live-20260901-150355 --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222`.
- Microsoft Playwright MCP attached to the renderer at `file:///C:/Users/kaust/OneDrive/Documents/dev/studi-2/dist/client/index.html`.
- Renderer observation before the callback: zero console errors, one existing Electron warning, and the real `Finish in your browser` auth gate.
- School/LMS pages, credentials, and schoolwork were never opened or changed.

## Highest-value journey disposition

| Journey boundary | Result | Exact observation |
| --- | --- | --- |
| Signed-out gate | PASS | School setup and workspace remained inaccessible while signed out. The app clearly said Clerk sign-in was open in the browser. |
| Dedicated Clerk sign-in and consent | PASS at Clerk | A cookie-isolated Playwright browser showed the real Clerk form, accepted `studi.wp12+clerk_test@example.com`, and displayed consent on behalf of that same identity. The cached personal Clerk consent was left untouched. |
| Loopback callback | PASS at transport | Allowing access reached `127.0.0.1:51569/callback`; Playwright observed HTTP 303 at `2026-09-01T19:14:38Z`. |
| Approved Convex entry | **FAIL** | After the callback, `window.studi.getAuthState()` returned `status=signed_out` and `Studi could not finish sign-in. Check your connection and try again.` No approved or denied entitlement result appeared. |
| PostHog identify/replay linkage | BLOCKED | Telemetry stayed anonymous with analytics and replay disabled; the inspector gained no dedicated-user approval event. |
| Runtime readiness and onboarding | NOT RUN | The auth gate never opened. |
| Controlled school sign-in and first scan | NOT RUN | The auth gate never opened; no fixture or seeded success replaced the real boundary. |
| Dashboard and manager command | NOT RUN | No verified scan result existed. |
| Desk takeover/resume/cancel/review/receipt/Markdown artifact | NOT RUN | No authenticated task execution existed. |
| Settings, Library, and feedback | NOT RUN | The run stopped at the first blocking failure. |
| Telemetry opt-out, restart/offline cache, signout/relogin, tray lifecycle | NOT RUN | These are downstream of a successful approved session for this integrated journey. |
| Real Pi turn | NOT RUN | No approved runtime session was safely reachable. |

## Smallest reproduction

1. Launch the built app on an isolated user-data directory with loopback-only CDP.
2. Start sign-in.
3. Use a cookie-isolated browser context for the dedicated Clerk development user so the user's cached personal account is not touched.
4. Complete email-code sign-in and allow Studi desktop access.
5. Observe the loopback callback return HTTP 303.
6. In the Electron renderer, call the public `window.studi.getAuthState()` projection.
7. Actual: `signed_out` with the generic completion error. Expected: `approved` or a truthful Convex `denied` reason for the dedicated subject.

## Honest limits

- The system-browser handoff itself was observed, but its consent page was already bound to the user's cached personal Clerk account. I left that account and device unchanged and completed the dedicated identity in a separate cookie-isolated Playwright browser.
- The public renderer projection intentionally does not expose the internal exception, so this user-like test identifies the failing boundary but does not claim the root cause.
- The requested downstream WP-12 journey and WP-11 remote identity-link retest remain unverified because bypassing auth or seeding success would violate the dossier's evidence rule.

No production code or automated tests were edited. No personal credential, personal Clerk account, cloud approval, school system, or schoolwork was changed.

## Resumed-state correction

The earlier post-callback `signed_out` result was transient. The authoritative resumed state was:

| Check | Observation |
| --- | --- |
| Clerk identity | `kausthubh2007@gmail.com`, subject `user_3AmYxBZSPxA6mdtGVf2PxkgvGgM` |
| Auth status | `denied` |
| Convex reason | `device_conflict` |
| Telemetry identity | `clerk`, with the same personal subject |
| Dedicated test identity | Not active in the Electron app |

The active session is therefore the user's cached personal Clerk account, not `studi.wp12+clerk_test@example.com`. I stopped without activating `Check access again` or `Use another account`, without taking over or releasing a device, and without entering onboarding or any school workflow. The dedicated approved WP-10/11/12 journey remains unverified.

## Dedicated-flow final correction and resumed journey

The manager later completed a clean PKCE flow for the dedicated development user. Playwright MCP proved the current built Electron state:

| Boundary | Result | Exact observation |
| --- | --- | --- |
| Dedicated Clerk identity | PASS | `studi.wp12+clerk_test@example.com`, subject `user_3IjsOUQKBdGvScdYnCtbA4MQjuB` |
| Convex beta approval | PASS | `status=approved`, plan `beta`, 100 credits |
| Secure local credential storage | PASS | `secureStorage=true` on isolated device `ac0d812c-132a-46d5-9c56-851e4eb6f2b1` |
| Telemetry identity synchronization | PASS locally | `identity=clerk` with the same dedicated subject; analytics/replay disabled and inspector empty |
| First-run onboarding entry | PASS | UI reached `Let’s meet your school.` and showed the persistent embedded school-browser region. |
| Runtime readiness | **BLOCKED** | UI reported `OpenAI Codex needs authentication.` Selecting `Connect Codex` changed the control to `Waiting for sign-in…`, but the generic Playwright browser retained only `about:blank`; the OAuth page opened outside all permitted Playwright targets. |

### Smallest runtime reproduction

1. Start from the approved dedicated account at first-run onboarding.
2. Activate `Connect Codex` through the Electron Playwright target.
3. Observe the button become disabled with `Waiting for sign-in…`.
4. List the generic Playwright tabs: only `about:blank` exists.
5. Wait five seconds and re-snapshot Electron: it still reports `OpenAI Codex needs authentication.` and `Waiting for sign-in…`.

The renderer contract does not expose the provider authorization URL, and Computer Use was explicitly disallowed for this continuation. Therefore a real Pi session could not be authenticated through the permitted boundary. The run stopped here without entering a school profile, fixture URL, scan, dashboard, manager, desk, Settings, Library, feedback, restart/offline, sign-out/relogin, or tray flow. No seeded data or direct IPC bypass replaced the failed user boundary.

No production code, automated test, personal provider credential, personal Clerk session, or school system was changed.

## 2026-09-01 independent current-instance continuation

Role: fresh read-only user-like tester  
Observed: 2026-09-01 21:20 EDT / 2026-09-02T01:20Z  
Automation: Microsoft's official Playwright Electron MCP only; no Computer Use

The test attached to the already-running built QA instance at loopback CDP `127.0.0.1:9222`, using isolated profile `C:\Users\kaust\AppData\Local\Temp\studi-wp12-live-20260901-150355`. The renderer remained `dist/client/index.html`, with zero console errors and one existing Electron warning.

| Remaining journey boundary | Result | Current observation |
| --- | --- | --- |
| Dedicated Clerk + Convex approval | PASS / CORRECTED | `approved`, beta plan, 100 credits, secure storage, and the dedicated subject; the prior incomplete-handoff classification is obsolete |
| WP-11 local identity linkage | PASS | Telemetry reports `identity=clerk` with the same dedicated subject; analytics and replay start disabled |
| Runtime readiness and one real provider turn | **FAIL — STOP** | Onboarding reports `OpenAI Codex needs authentication.` and the connect control is disabled at `Waiting for sign-in…`; an eight-second bounded wait produced no change |
| Controlled LMS onboarding and evidence-backed scan | NOT RUN | Stopped at the first concrete app failure; no profile or scan exists |
| Dashboard, manager, active desk, takeover/resume/cancel, review receipt, Markdown fallback | NOT RUN | No verified scan or real agent session exists |
| Settings, Library/task artifact, and feedback | NOT RUN | Downstream of the failed runtime boundary |
| Typed event, masked replay, then opt-out | NOT RUN | Telemetry remained disabled and unmutated |
| Same-profile restart, online refresh, offline cache, and tray lifecycle | NOT RUN | Not attempted after the required stop |

### Smallest current reproduction

1. Attach the official Electron MCP to the already-approved built QA instance at `127.0.0.1:9222`.
2. Observe first-run onboarding at `Let’s meet your school.`
3. Read the runtime card: `OpenAI Codex needs authentication.`
4. Observe that the only connect control is disabled as `Waiting for sign-in…`.
5. Wait eight seconds and re-read the semantic UI; the same unavailable state remains.

Because the provider authorization opened outside the permitted Playwright targets and the current UI exposes no retry or recoverable handoff, a real agent turn is not safely reachable. The user-requested downstream journey was intentionally not bypassed with seeded state or direct IPC calls.

No OAuth URL or query value was retained. No production code, automated test, personal provider account, personal Clerk session, cloud entitlement, school system, or schoolwork was changed.

## 2026-09-02 repaired provider-auth retest

Role: fresh read-only integrated user tester  
Observed: 2026-09-02 01:41-01:54 UTC  
Outcome: **PARTIAL PASS — repaired device-code UI works; isolated OpenAI authorization is blocked externally before code entry**

### Runtime and identity

- The current build was newer than the latest `src/` or `electron/` change.
- A brand-new launcher-owned profile on CDP `127.0.0.1:9333` passed the signed-out gate. Its fresh Clerk authorize capture timed out because the default browser did not create a capturable new process. This is classified as a harness/auth-continuation block, not a Studi product failure; no stale request was reused.
- Per manager direction, the current build was then relaunched on the previously approved dedicated-test profile `C:\Users\kaust\AppData\Local\Temp\studi-wp12-live-20260901-150355`, using new loopback CDP port `127.0.0.1:9444`.
- The restored public projection was `approved` for `studi.wp12+clerk_test@example.com`, beta plan, 100 credits, `secureStorage=true`, and the previously proven dedicated subject/device. Telemetry reported `identity=clerk` with that same subject and remained opted out for analytics and replay.

| Journey boundary | Result | Exact observation |
| --- | --- | --- |
| Signed-out gate on a fresh profile | PASS | `Sign in before school setup`; no onboarding or school state was exposed. |
| Approved dedicated profile restore | PASS | Current build restored approved beta/100 credits/secure storage and Clerk-linked telemetry for the dedicated test identity. |
| First repaired Codex login attempt | PASS | Electron displayed an HTTPS OpenAI verification destination at host/path `auth.openai.com/codex/device`, a one-time uppercase-alphanumeric code, an absolute local expiry time, and `Cancel sign-in`. |
| Cancel | PASS | Cancel immediately restored `Connect Codex` and removed the verification destination, one-time code, and expiry from the renderer. |
| Clean retry | PASS | A second attempt produced a fresh complete device-code projection with the same verified OpenAI host/path, a code, expiry, and cancel control. |
| Isolated Playwright authorization | **BLOCKED — STOP** | The generic official Playwright browser reached the OpenAI authorization surface but received HTTP 403 (`Just a moment...`) before a device-code textbox existed. No code was entered and no credential/MFA action was attempted. |
| Provider ready and one real Pi turn | NOT RUN | The external authorization surface did not permit completion. |
| Remaining WP-12 journey | NOT RUN | Controlled LMS scan, truthful dashboard, manager, desk/takeover/resume/cancel/review/artifact, Settings, Library, feedback, telemetry event/replay/opt-out, restart/offline cache, and tray lifecycle remain downstream of provider readiness. |

### Hygiene checks

- The pending retry was cancelled after the external block; Electron again cleared all displayed verification material.
- An exact in-memory check scanned 373 relevant files across the dedicated profile, QA evidence, and Playwright output; the one-time code had zero file hits. No provider token could have been issued before the HTTP 403.
- The one transient Playwright console artifact containing an authorization URL was removed, and a follow-up scan found zero retained authorization-URL files in Playwright output or QA evidence.

Exact next action: complete the OpenAI device authorization through a permitted human-controlled browser session (or make the isolated official Playwright surface acceptable to the OpenAI anti-bot boundary), then resume the same provider-readiness check and run one real Pi turn. Do not enter personal credentials or MFA through automation.

No one-time code, OAuth query value, authorization code, token, cookie, or personal credential is retained in repository evidence. No production code, automated test, cloud entitlement, personal account, school system, or schoolwork was changed.
