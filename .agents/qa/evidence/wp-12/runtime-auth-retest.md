# WP-12 runtime authentication retest

Date: 2026-09-02 (UTC)  
Role: fresh read-only integrated user tester  
Outcome: **PARTIAL PASS — repaired Electron device-code flow passes; external OpenAI authorization blocks completion**

## Boundary

The current build was relaunched on the previously approved dedicated-test profile `C:\Users\kaust\AppData\Local\Temp\studi-wp12-live-20260901-150355` with a new loopback CDP endpoint at `127.0.0.1:9444`. Microsoft's official Playwright Electron MCP drove the renderer; the generic official Playwright MCP owned the isolated OpenAI web surface. Computer Use was not used.

Before provider testing, the public app projection restored:

```text
approved dedicated Clerk identity
beta plan, 100 credits
secureStorage=true
telemetry identity=clerk with the same dedicated subject
analytics=false, replay=false
```

## Results

| Required check | Result | Observation |
| --- | --- | --- |
| Start Codex device login | PASS | `Connect Codex` started a real device authorization attempt without leaving Electron stuck at `Waiting for sign-in…`. |
| Verification destination | PASS | Electron displayed an HTTPS OpenAI destination at host/path `auth.openai.com/codex/device`; no query string was required. |
| One-time code and expiry | PASS | Electron displayed a shaped one-time uppercase-alphanumeric code and an absolute local expiry time. The code value is intentionally omitted. |
| Cancel clears attempt | PASS | `Cancel sign-in` restored `Connect Codex` and removed the destination, code, and expiry. |
| One clean retry | PASS | A second attempt rendered the complete destination/code/expiry/cancel projection again. |
| Isolated-browser navigation | PASS | The retry destination was transferred through a loopback-only in-memory broker and opened by the isolated generic Playwright browser. |
| Enter displayed code | **BLOCKED — STOP** | OpenAI redirected to its authorization surface and returned HTTP 403 (`Just a moment...`) before a device-code textbox existed. No code, credential, or MFA value was entered. |
| Provider ready | NOT RUN | External authorization did not complete. |
| One real Pi turn | NOT RUN | No provider-ready session existed. |

## Secret hygiene

- The second attempt was cancelled after the external block, clearing all verification material from Electron.
- The in-memory broker was stopped after one-time transfer and never wrote its payload to disk.
- An exact scan of 373 files across the dedicated app profile, QA evidence, and Playwright output found zero one-time-code file hits.
- No provider token could have been issued before the HTTP 403.
- A transient Playwright console artifact containing an authorization URL was removed; a follow-up scan found zero retained authorization-URL files in Playwright output or QA evidence.

## Exact next action

Use a permitted human-controlled browser session to complete the OpenAI device authorization, or resolve the OpenAI anti-bot rejection for the isolated official Playwright surface. Then resume the current-build provider readiness check and run one real Pi turn before proceeding to LMS, desk, telemetry, restart/offline, or tray coverage.

No one-time code, OAuth query value, authorization code, token, cookie, personal credential, or MFA value is retained in this evidence. No production code, automated test, cloud entitlement, personal account, school system, or schoolwork was changed.
