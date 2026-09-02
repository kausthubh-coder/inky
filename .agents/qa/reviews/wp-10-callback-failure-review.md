# WP-10 callback failure review

Date: 2026-09-01 (America/New_York)  
Role: read-only failure reviewer  
Disposition: **the reported callback blocker is not a production defect; it was an incomplete OAuth handoff misclassified as a completed loopback callback**

## 1. Root cause and execution-order trace

The exact cause of the reported blocker is an evidence error. The earlier dedicated test-user sign-in had not actually completed. The tester treated an HTTP 303 from Clerk as proof that Studi's loopback callback had completed, then attributed the later generic `signed_out` projection to the app.

That interpretation is incompatible with the implementation:

- `openLoopbackCallback()` in `electron/auth/loopback.ts` returns 200 for a valid callback, 400 for an invalid callback, 404 for another path, and 410 after consumption. It never returns 303. The observed 303 was therefore Clerk initiating a redirect toward the loopback URL, not Studi accepting the callback.
- `AuthCoordinator.#performSignIn()` in `electron/auth/coordinator.ts` does not begin token exchange until `callback.code` resolves. An upstream 303 alone proves neither callback acceptance nor code exchange.
- The authoritative follow-up states that the dedicated handoff was completed only later. After a later completed transaction, the running app projected a Clerk-backed `denied/device_conflict` result rather than `signed_out`, telemetry had switched from anonymous to Clerk identity, and the isolated profile contained a newly written encrypted `studi-auth/credentials.json` at 3:16:24 PM.

The later result traces the real flow through every boundary in order:

1. **OAuth callback:** the coordinator received an authorization code from the one-shot loopback listener.
2. **Token exchange and validation:** `#requestToken()` returned tokens and `#verifyIdentityToken()` accepted issuer, audience, signature, and nonce; otherwise no user-bearing state could exist.
3. **Refresh persistence:** the denial branch in `#evaluateEntitlement()` writes the refresh token through `AuthVault.save()`; the encrypted credential file's creation time corroborates that branch.
4. **Clerk identity:** the auth projection and telemetry both carried a Clerk identity after the completed transaction.
5. **Convex auth and entitlement:** `CloudAccountClient.evaluate()` authenticated the `account:bootstrap` mutation and received `device_conflict`. That is a cloud-policy result, not a transport or JWT failure.
6. **Renderer state:** `electron/main.ts` returned the coordinator's typed state, and the renderer exposed the truthful `denied/device_conflict` gate.

There is therefore no confirmed failing app boundary in the earlier run. It stopped before proven loopback acceptance. The first confirmed terminal boundary in the later run is Convex entitlement denial, which is expected behavior for an identity with another active device.

### Residual uncertainty about the earlier generic message

The precise internal exception behind the earlier generic message was not retained. The catch in `AuthCoordinator.#performSignIn()` intentionally maps all non-protocol failures to the same user-safe copy and emits no local boundary code.

Ranked explanations for that message are:

1. **OAuth transaction timeout/cancellation after the unfinished handoff.** This best fits the authoritative correction and the five-minute timer in `openLoopbackCallback()`.
2. **A transient token, cloud, or vault failure after an earlier request.** This is less likely and cannot be separated from the first explanation using the preserved public projection.

The one diagnostic needed to choose between them would have been a local, secret-free failure code captured at the `#performSignIn()` catch boundary, such as `callback_timeout`, `token_exchange`, `identity_validation`, `vault_write`, or `convex_entitlement`. No token, response body, URL query, email, or subject should be logged.

## 2. Smallest reproduction

### Reproduce the false-positive observation

1. Launch the built Electron app on an isolated user-data directory.
2. Start sign-in, but do not complete the human consent handoff before the five-minute callback timer expires.
3. Later continue the stale Clerk page and observe Clerk issue an HTTP 303 toward the old loopback URL.
4. Observe Studi's generic `signed_out` result.
5. Do not call the 303 a completed loopback callback: the local listener itself must return 200 to prove acceptance.

### Prove the real boundary

1. Start a fresh sign-in transaction and complete the dedicated test-user consent within the same live transaction.
2. Confirm the final response from `127.0.0.1:<ephemeral>/callback` is Studi's 200 page.
3. Confirm `window.studi.getAuthState()` becomes a user-bearing `approved` or truthful `denied` state.
4. Confirm telemetry uses Clerk identity and that an encrypted credential file is created or updated, without reading its payload.

The later run already demonstrated steps 3 and 4 and reached a truthful Convex denial. It did not prove the dossier's separate approved-account pass condition.

## 3. Focused repair brief

**Production repair: none.** Do not change `electron/auth/loopback.ts::openLoopbackCallback`, `electron/auth/coordinator.ts::#performSignIn`, `electron/auth/cloud.ts::CloudAccountClient.evaluate`, `electron/auth/vault.ts::AuthVault.save`, or `electron/main.ts::observeAuthState` for this report. The current control flow is direct and the later completed transaction exercised it successfully.

The focused repair is to correct the live-test classification and rerun the intended approved-account proof:

- Amend the WP-10/WP-11/WP-12 live evidence so the earlier 303 is described as Clerk's redirect, not Studi's accepted callback.
- Run one fresh dedicated-user transaction to completion within five minutes and record the loopback listener's terminal status separately from the upstream Clerk redirect.
- Use cloud truth to obtain either the intended approved result or an explicit denial; do not bypass auth or seed renderer state.
- Preserve the user's personal Clerk session and device exactly as-is.

Acceptance checks:

- The local loopback response is 200 and only one code is consumed.
- The renderer transitions from `signing_in` to a user-bearing `approved` or truthful `denied` state, never a claimed success based only on an upstream 303.
- A denial reason matches Convex truth; an approved account reaches onboarding.
- The encrypted credential is updated without exposing token material.
- Telemetry identity becomes Clerk only after a user-bearing auth state.
- A restart refreshes the same completed identity, and the personal Clerk account/device remains untouched.

Optional, non-blocking maintainability follow-up: add one scrubbed local failure code at the existing `#performSignIn()` catch boundary. This is diagnostic evidence, not a callback retry system or a reason to reopen WP-10 by itself.

## 4. Quality and elegance assessment

The affected production design is **good enough and proportionate**.

- One coordinator owns the OAuth transaction, in-memory tokens, persistence decision, entitlement evaluation, and typed renderer projection.
- The loopback listener is narrow, one-shot, loopback-only, and closes after completion or timeout.
- Token verification and Convex authentication are explicit and adjacent to their trust boundaries.
- The renderer never receives credentials, and the later denial proves cloud policy remains authoritative.

The only concrete reader-cost exposed by this incident is diagnostic collapse: timeout, network, token-shape, vault, and Convex failures share one generic message with no retained boundary code. That made a mistaken live-test interpretation harder to disprove. It is a small, non-blocking observability gap, not a costly architectural issue and not evidence that the callback design should be replaced.

Static Clerk/Convex configuration is not implicated. A wrong issuer, OAuth client ID, redirect behavior, JWT audience, or Convex auth configuration would not later produce a verified Clerk identity, persisted refresh credential, and authenticated `device_conflict` result through the same build.

## 5. Explicit non-goals

- No production-code, test, Clerk, Convex, PostHog, or account/device mutation in this review.
- No callback retry loop, longer timeout, embedded auth browser, custom OAuth UI, provider abstraction, or generic logging framework.
- No reading or logging refresh/access/ID tokens, encrypted credential contents, callback query strings, email addresses, or Clerk subjects.
- No change to waitlist, beta approval, or active-device policy.
- No claim that approved entry, offline restart, sign-out/relogin, or the downstream WP-11/WP-12 journeys now pass; those still require their own live evidence.
- No use of the user's personal Clerk account or active device to manufacture a green result.
