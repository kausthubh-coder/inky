# WP-10 independent live test

Date: 2026-09-01  
Role: read-only user-like tester  
Outcome: **PASS for the dedicated Clerk + Convex gate; downstream Codex runtime handoff fails separately**

## Test boundary

I drove the running Electron renderer through Microsoft's Playwright MCP at the loopback CDP endpoint. I used Windows Computer Use only to identify the OS-owned browser handoff. I did not enter credentials, grant consent, solve CAPTCHA, handle MFA, edit cloud beta truth, change production code, or add tests.

The connected Electron process is a development launch, not a production-artifact launch. Its command line includes `--studi-development-url=http://127.0.0.1:5173`, and Playwright reports the page URL as `http://127.0.0.1:5173/`. Production-build runtime behavior therefore remains unproved in this run.

## Dossier conditions

| Condition | Result | Observation |
| --- | --- | --- |
| Visible signed-out gate blocks school setup | PASS | The app showed `Sign in before school setup`, the `Sign in to Studi` button, and no school workflow or embedded school browser. The gate also truthfully reported the prior expired attempt as `Studi could not finish sign-in. Check your connection and try again.` |
| Sign-in opens the real Clerk system-browser flow | PASS | Clicking the renderer button through Playwright changed the app to `Finish in your browser`. Windows reported a Zen Browser window titled `My account \| studi — Zen Browser`. |
| Real Clerk callback completes | NOT RUN | Human handoff required. Zen's selected window handle rendered an unrelated media tab even though the window title named the Clerk tab, so browser automation was not safe. The Electron app remains at `Finish in your browser`. |
| Approved account passes deployed Convex beta access and reaches onboarding | NOT RUN | Depends on the unfinished Clerk callback. No approved state was simulated. |
| Unapproved account is denied by controlled Clerk/Convex truth | NOT RUN | Requires a second real Clerk identity or an authenticated admin-controlled revocation. I did not manufacture denial in the renderer or mutate cloud truth without a completed identity handoff. |
| Renderer auth projection exposes no token | PASS | During the live `signing_in` state, `window.studi.getAuthState()` returned only `{ status: "signing_in" }`. A token-shape scan of the serialized projection was false. |
| Renderer web storage exposes no token | PASS | `localStorage`, `sessionStorage`, and `document.cookie` were empty. No token, Clerk, Convex, OAuth, or authorization-named global was present. The visible document had no JWT or bearer-token shape. |
| Online restart restores approved identity | NOT RUN | No approved identity exists yet. |
| Bounded offline startup works only for the last approved subject/device | NOT RUN | No signed approval cache exists yet. |
| Sign-out returns to the gate and releases the active-device record | NOT RUN | No authenticated session or active-device record was created in this run. |
| Unauthenticated Convex account bootstrap fails closed | PASS | `npx convex run account:bootstrap '{"deviceId":"11111111-1111-4111-8111-111111111111"}'` exited 1 with `Unauthenticated` at `convex/account.ts:30`. |
| Unauthenticated public entitlement/admin mutation fails closed | PASS | `npx convex run account:setBetaAccess '{"subject":"tester-denied-probe","approved":true,"plan":"beta","credits":0}'` exited 1 with `Unauthenticated` at `convex/account.ts:114`. No cloud row was changed. |
| State, nonce, S256 PKCE, one-shot callback, and refresh revocation hold in the real flow | NOT RUN | The live browser callback did not complete. I did not substitute unit-test results for this user-like proof. |
| Packaged output contains no Clerk secret or token | NOT RUN | This run inspected the live renderer only. It did not launch or inspect a packaged production artifact. |
| Existing contract, storage, agent, Electron, build, and Sites gates stay green | NOT RUN | Those are implementer-owned programmatic checks and were not rerun after the tester reached the required human handoff. |

## Smallest continuation

In Zen Browser, select the Clerk `studi` tab and complete the public OAuth sign-in or consent by hand. Return to the Electron app without starting a second sign-in. The next tester should confirm approved or denied cloud truth, inspect the renderer projection again, then run online restart, offline restart, sign-out, and a later re-sign-in. Relaunch the built app without `--studi-development-url` before claiming production runtime proof.

No approved, denied, restart, offline, sign-out, or active-device result is claimed here.

## 2026-09-01 production-build continuation

Role: fresh read-only integrated user tester  
Runtime: built Electron renderer at `dist/client/index.html`, launched with isolated profile `studi-wp12-live-20260901-150355` and loopback-only CDP on `127.0.0.1:9222`  
Outcome: **FAIL — the dedicated Clerk callback returned, but Studi did not finish sign-in**

### New authoritative observations

- Microsoft Playwright MCP attached to the production renderer at `file:///C:/Users/kaust/OneDrive/Documents/dev/studi-2/dist/client/index.html`. The renderer reported zero console errors and one existing Electron warning.
- The signed-out gate still blocked all school setup and showed `Finish in your browser` while a real OAuth transaction was pending.
- The system-browser consent page was bound to the user's cached personal Clerk account. I did not press Allow or Deny, sign out, clear cookies, take over a device, or otherwise mutate that personal session.
- Zen's isolated window still reused the cached Clerk session. To preserve the personal account, I opened the same public PKCE transaction in the already-running isolated Playwright browser profile. That clean context showed Clerk's real sign-in form, accepted the dedicated development user `studi.wp12+clerk_test@example.com`, and then showed the consent page explicitly on behalf of that identity.
- Allowing the dedicated identity redirected to the pending loopback callback at `127.0.0.1:51569`; Playwright observed an HTTP 303 response at `2026-09-01T19:14:38Z`.
- After the callback, the Electron renderer returned to the signed-out gate. The public preload projection was exactly `status=signed_out` with message `Studi could not finish sign-in. Check your connection and try again.`
- The public telemetry projection remained anonymous with analytics and replay disabled. Its 14-envelope inspector gained no dedicated-user `approved` or `denied` auth event, so no Convex entitlement result is claimed.

### Smallest reproduction

1. Launch the built Electron app on the isolated profile with its loopback-only CDP endpoint.
2. Start sign-in and preserve the personal system-browser session without acting on it.
3. In a cookie-isolated browser context, open the same pending PKCE authorization request.
4. Sign in as the dedicated Clerk development user and allow Studi desktop access.
5. Observe the loopback callback return HTTP 303.
6. Re-read `window.studi.getAuthState()` in the Electron renderer: it is `signed_out` with the generic completion error instead of `approved` or `denied`.

This is the first failing boundary. Approved Convex entry, refresh/restart, offline cache, sign-out/relogin, and active-device lifecycle were not exercised. No production code, automated test, cloud approval, personal account, or personal device was changed.

## 2026-09-01 resumed-state correction

The renderer changed after the preceding observation, so the `signed_out` completion error above is retained only as a transient point-in-time result, not the final auth disposition.

The authoritative public projection on resume was:

```text
status=denied
email=kausthubh2007@gmail.com
subject=user_3AmYxBZSPxA6mdtGVf2PxkgvGgM
reason=device_conflict
message=This beta account already has another active Studi computer.
```

The telemetry projection simultaneously reported `identity=clerk` with the same subject. This proves that the sign-in which ultimately completed belonged to the cached personal Clerk account, not `studi.wp12+clerk_test@example.com`. Convex was reached and denied that personal subject because another device is active.

I did not click `Check access again` or `Use another account`, sign out, release or take over a device, or continue into school workflows. The dedicated test identity's approved entry remains unverified; the personal account and active-device record remain unchanged.

## 2026-09-01 dedicated-flow final correction

The manager subsequently completed a brand-new PKCE transaction for the dedicated development user. The earlier `signed_out` result was an unfinished handoff, and the personal `device_conflict` projection belonged to the superseded cached-account transaction. Neither is the final dedicated-account result.

Microsoft Playwright MCP re-read the same built Electron renderer and returned:

```text
status=approved
email=studi.wp12+clerk_test@example.com
subject=user_3IjsOUQKBdGvScdYnCtbA4MQjuB
plan=beta
credits=100
deviceId=ac0d812c-132a-46d5-9c56-851e4eb6f2b1
secureStorage=true
```

The telemetry projection simultaneously reported `identity=clerk` and the same dedicated subject. The renderer remained at `file:///C:/Users/kaust/OneDrive/Documents/dev/studi-2/dist/client/index.html` with zero console errors. This is authoritative evidence that the dedicated Clerk identity passed deployed Convex beta access and reached first-run onboarding on the isolated QA device.

No personal Clerk session or personal active-device record was changed. Restart/offline cache and later sign-out/relogin remain unverified because the integrated run stopped at the next runtime-auth boundary.

## 2026-09-01 independent final continuation

Role: fresh read-only integrated user tester  
Observed: 2026-09-01 21:20 EDT / 2026-09-02T01:20Z  
Runtime: existing built Electron QA instance, isolated profile `C:\Users\kaust\AppData\Local\Temp\studi-wp12-live-20260901-150355`, loopback CDP `127.0.0.1:9222`

The earlier dedicated-flow `signed_out` / incomplete-handoff classification is superseded. Microsoft's official Playwright Electron MCP (version 0.0.80) attached to the current built renderer at `dist/client/index.html` and independently observed:

```text
status=approved
email=studi.wp12+clerk_test@example.com
subject=user_3IjsOUQKBdGvScdYnCtbA4MQjuB
plan=beta
credits=100
secureStorage=true
telemetry identity=clerk with the same subject
```

The Clerk callback and deployed Convex beta gate are therefore a PASS for the dedicated identity. The current stop is a later provider boundary: onboarding reports `OpenAI Codex needs authentication.` while its only connect control remains disabled as `Waiting for sign-in…`. After an eight-second bounded wait the semantic UI was unchanged, with zero console errors. No school workflow was started.

No OAuth URL or query value was retained. No Computer Use, personal account action, cloud mutation, school action, production-code edit, or automated-test edit occurred.

## 2026-09-02 current-build approved-profile restart

The previously approved dedicated-test profile was relaunched on the repaired current build with a new loopback CDP port, `127.0.0.1:9444`. The official Electron Playwright surface observed:

```text
status=approved
email=studi.wp12+clerk_test@example.com
plan=beta
credits=100
secureStorage=true
telemetry identity=clerk with the same dedicated subject
```

This is new WP-10 evidence that the approved Clerk/Convex envelope and secure credential restore survive a current-build restart on the same dedicated profile. Analytics and replay also remained opted out. The separate brand-new-profile Clerk capture timeout was confined to the system-browser capture harness and is not classified as a Studi auth failure.

No personal Clerk session, device entitlement, cloud row, production code, or automated test was changed. No OAuth value, authorization code, token, or cookie is retained in this evidence.
