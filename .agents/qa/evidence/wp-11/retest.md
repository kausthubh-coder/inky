# WP-11 identity-link live retest

Date: 2026-09-01 (America/New_York)  
Role: fresh read-only integrated user tester  
Outcome: **PARTIAL PASS — dedicated identity synchronization is correct; remote `$identify`/replay linkage remains unverified behind the Codex runtime failure**

## Runtime and boundary

- Microsoft Playwright MCP drove the built Electron renderer through `127.0.0.1:9222` at `dist/client/index.html`.
- A clean Playwright browser context completed real Clerk sign-in and consent for the dedicated development user `studi.wp12+clerk_test@example.com` without touching the cached personal Clerk session.
- The loopback callback returned HTTP 303, but Studi immediately projected `signed_out` with `Studi could not finish sign-in. Check your connection and try again.`

## Result

| Condition | Result | Observation |
| --- | --- | --- |
| Clerk approval changes main and renderer telemetry to one Clerk identity | FAIL / BLOCKING | After the dedicated callback, the telemetry projection remained `identity=anonymous`; no approved auth envelope appeared. |
| `$identify` reaches the connected PostHog project after approval | NOT RUN | There was no approved transition to trigger or attribute the repaired `$identify` path. |
| The same Clerk identity owns typed events and replay | NOT RUN | The authentication boundary failed before either post-identification stream existed. |
| Telemetry opt-out, replay masking, and school-browser isolation remain correct | NOT RETESTED | These passed in the prior independent live test. This run stopped at the required first failure rather than repeating downstream cases. |

## Smallest reproduction

Complete the dedicated Clerk development user's real PKCE consent against the built Electron app. After the loopback returns HTTP 303, read `window.studi.getAuthState()` and `window.studi.getTelemetryState()`. The app is signed out and telemetry remains anonymous, so the repaired remote `$identify` and replay-link path cannot run.

No production code, automated test, PostHog state, personal account, or cloud entitlement was changed.

## Resumed-state correction

The earlier `signed_out` result was transient. On resume, `window.studi.getAuthState()` reported the cached personal account with `status=denied`, `reason=device_conflict`, and subject `user_3AmYxBZSPxA6mdtGVf2PxkgvGgM`. `window.studi.getTelemetryState()` reported `identity=clerk` and the same subject.

This is not evidence for the repair: the current Clerk identity is `kausthubh2007@gmail.com`, not the dedicated development user. I did not emit more events, enable replay, retry access, or sign out because doing so would exercise or mutate the personal session. The remote `$identify` and replay-link retest therefore remains NOT RUN for the dedicated identity.

## Dedicated-flow final correction

The manager completed a new isolated PKCE transaction after the cached-personal observation above. The current authoritative Electron projections are:

| Condition | Result | Observation |
| --- | --- | --- |
| Dedicated Clerk identity reaches the renderer | PASS | `getAuthState()` reports `studi.wp12+clerk_test@example.com`, subject `user_3IjsOUQKBdGvScdYnCtbA4MQjuB`, and `status=approved`. |
| Main telemetry rotates to the dedicated subject | PASS | `getTelemetryState()` reports `identity=clerk` with the same subject. |
| Remote `$identify` merges the anonymous person | NOT RUN | Analytics and replay are currently disabled, so no new eligible upload was produced. |
| Replay belongs to the dedicated Clerk identity | NOT RUN | The integrated journey stopped at provider runtime authentication before Settings could safely exercise replay. |
| Opt-out starting state | PASS | Analytics and replay both remain disabled after the successful Clerk transition; the inspector is empty. |

The earlier cached-personal section remains as chronological evidence only; it is not the final identity disposition. No PostHog state or personal account was changed in this continuation.

## 2026-09-01 independent final continuation

Microsoft's official Playwright Electron MCP reattached to the current built renderer and independently confirmed that the dedicated Clerk approval is complete, not an incomplete handoff:

| Condition | Result | Observation |
| --- | --- | --- |
| Dedicated auth identity | PASS | Approved `studi.wp12+clerk_test@example.com`, subject `user_3IjsOUQKBdGvScdYnCtbA4MQjuB` |
| Main-to-renderer telemetry identity | PASS | `identity=clerk` with the same subject |
| Starting telemetry consent | PASS | Analytics and replay are both disabled; the inspector is empty |
| Typed event, remote `$identify`, and replay ownership | NOT RUN | The integrated run stopped at the first later app failure: Codex runtime authentication remained stuck at disabled `Waiting for sign-in…` |
| Masked replay and opt-out | NOT RUN | No telemetry preference was changed after the required stop |

This corrects only the obsolete incomplete-Clerk-handoff classification. It does not manufacture remote PostHog proof from the local projection. No telemetry event or replay was emitted in this continuation.

## 2026-09-02 current-build provider-retest identity check

The previously approved dedicated-test profile was relaunched on the current build at new loopback CDP port `127.0.0.1:9444`. `window.studi.getAuthState()` restored approved beta access with 100 credits and secure storage for `studi.wp12+clerk_test@example.com`. `window.studi.getTelemetryState()` simultaneously reported `identity=clerk` with the same dedicated subject; analytics and replay both remained disabled and the inspector was empty.

| WP-11 condition | Result | Observation |
| --- | --- | --- |
| Same dedicated identity after current-build restart | PASS | Auth and telemetry restored the same Clerk subject on the approved dedicated profile. |
| Opt-out persistence | PASS | Analytics and replay remained disabled after restart. |
| Typed event, remote `$identify`, and replay ownership | NOT RUN | The integrated journey stopped when the isolated OpenAI authorization surface returned HTTP 403 before provider readiness. |
| Masked replay and later opt-out transition | NOT RUN | No telemetry preference was changed in this provider-focused retest. |

The earlier fresh-profile Clerk capture timeout was a test-harness continuation block, not contradictory identity evidence. No personal Clerk session, PostHog preference, production code, or automated test was changed.
