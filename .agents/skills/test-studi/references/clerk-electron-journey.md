# Clerk + Electron user journey

Use this procedure for a real development Clerk handoff into the built Electron app. It deliberately keeps the user's personal browser session outside the automation boundary.

## Two Playwright MCP surfaces

Configure two separate instances of Microsoft's official Playwright MCP:

```toml
[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp@latest", "--headless", "--isolated"]

[mcp_servers.playwright-electron]
command = "npx"
args = ["-y", "@playwright/mcp@latest", "--cdp-endpoint", "http://127.0.0.1:9222"]
```

The generic `playwright` instance owns an isolated Chromium profile and completes Clerk. `playwright-electron` attaches to Studi's renderer. Keep their pages and observations separate. The local Codex configuration may add an explicit Chromium executable or `--caps vision`; those do not change this ownership model.

## Launch and capture

1. Build when needed with `npm run build`.
2. Run `scripts/Start-StudiQa.ps1` from this skill. Its JSON receipt identifies the unique app profile, Electron PID, and CDP endpoint. Do not add `--studi-development-url`; the test target is `dist/client/index.html`.
3. Attach `playwright-electron`, confirm the file URL and signed-out gate, and inspect the renderer semantically.
4. Immediately before activating **Sign in to Studi**, record a UTC baseline and start the capture helper in a long-running terminal session:

   ```powershell
   $captureBaseline = [DateTimeOffset]::UtcNow
   .\.agents\skills\test-studi\scripts\Get-FreshClerkAuthorizeUrl.ps1 -StartedAfterUtc $captureBaseline
   ```

5. Activate sign-in through `playwright-electron`. Electron opens the system browser, but do not focus, inspect, close, or automate that browser. The helper polls only newly created browser-process command lines, validates the configured Clerk host, S256 PKCE fields, and a `127.0.0.1` callback, then emits the ephemeral URL as JSON.
6. Pass the URL directly to the isolated generic Playwright browser. Do not paste it into notes, evidence, or another shell command.

If the capture helper times out, stop. A stale tab, browser history, or the user's active browser profile is not an acceptable substitute.

## Dedicated development identity

The existing reusable Clerk development identity is `studi.wp12+clerk_test@example.com`. Clerk's development email-code flow accepts the documented development code `424242`. These values are test fixtures, not production credentials; do not put them into app code or helper scripts.

In the isolated browser:

1. Navigate to the exact captured authorize URL.
2. Enter the dedicated email, choose email-code verification, and enter the development code.
3. Before consent, verify Clerk says the request is on behalf of that dedicated identity. If it shows the user's personal identity or any other account, stop without consenting or signing it out.
4. Allow access and follow the redirect to the existing `http://127.0.0.1:<ephemeral>/callback` listener. A Clerk redirect alone is not proof of completion; wait for Electron's public auth state to settle.

## Truth checks

Read `window.studi.getAuthState()` through the Electron renderer. For the currently approved fixture, the proven result is `status=approved`, `plan=beta`, `credits=100`, and `secureStorage=true`. Record the live subject returned by Clerk and compare it across auth and telemetry when relevant, but do not encode a fixed subject into source or scripts.

Then exercise only the journey in scope. Restart must use the same isolated QA profile when persistence is the behavior under test. A new clean journey gets a new profile.

Convex approval or credit changes go only through the repository's authenticated development admin mutation. Before any authorized change, look up current state and state the intended delta. Retain a separate unauthenticated call to `account:setBetaAccess` that fails with `Unauthenticated`; never treat renderer state or a direct database edit as approval evidence.

For school/LMS work, use controlled local fixtures or explicitly safe read-only real pages. Stop before any real submit, enrollment change, message, upload, or answer mutation. Leave zero-result and partial scans visibly incomplete.

## Evidence hygiene

Record the launcher receipt, timestamps, semantic UI observations, final public auth projection, and controlled Convex boundary result. Do not record the authorize URL, state, nonce, code challenge, authorization code, tokens, cookies, full browser command line, or Clerk page storage. Delete no browser data and terminate no browser process as part of this flow.
