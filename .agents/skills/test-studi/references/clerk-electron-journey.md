# Clerk + Electron user journey

Use this procedure for a real development Clerk handoff into the built Electron app. It deliberately keeps the user's personal browser session outside the automation boundary.

## Two Playwright MCP surfaces

Configure two separate instances of Microsoft's official Playwright MCP:

```toml
[mcp_servers.playwright]
command = "bunx"
args = ["@playwright/mcp@latest", "--headless", "--isolated"]

[mcp_servers.playwright-electron]
command = "bunx"
args = ["@playwright/mcp@latest", "--cdp-endpoint", "http://127.0.0.1:9222"]
```

The generic `playwright` instance owns an isolated Chromium profile and completes Clerk. `playwright-electron` attaches to Studi's renderer. Keep their pages and observations separate. The local Codex configuration may add an explicit Chromium executable or `--caps vision`; those do not change this ownership model.

## Launch and claim

1. Build when needed with `bun run build`.
2. Run `scripts/Start-StudiQa.ps1` from this skill. For a throwaway Clerk proof, omit `-Persistent`. For the onboarded feature profile, pass `-Persistent` so the receipt path is `<repo>\.agents\studi-qa\profile`. Do not add `--studi-development-url`; the test target is `dist/client/index.html`.
3. Attach `playwright-electron`. On a fresh profile, confirm the file URL and signed-out gate. On a reused persistent profile, read `window.studi.getAuthState()` first — if it is already approved, skip this Clerk capture unless the user asked to re-prove sign-in.
4. Activate **Sign in to Studi** through `playwright-electron`. In QA mode Electron publishes the authorize URL to the launcher's short-lived in-memory loopback handoff instead of opening the system browser.
5. Navigate isolated generic Playwright to the receipt's `clerkClaimUrl`. The relay validates Clerk's host, S256 PKCE fields, and the loopback callback before issuing a one-time redirect. It never prints or writes the authorize URL.

If the claim returns `425`, wait briefly for Electron to publish and retry once. If it still fails, stop. A stale tab, browser history, or the user's active browser profile is not an acceptable substitute.

## Dedicated development identity

The existing reusable Clerk development identity is `studi.wp12+clerk_test@example.com`. Clerk's development email-code flow accepts the documented development code `424242`. These values are test fixtures, not production credentials; do not put them into app code or helper scripts. The agent completes this Clerk flow in isolated Playwright. Do not ask the user to sign in to Studi or use their own Clerk identity. Human help is reserved for the separate ChatGPT device-code handoff.

In the isolated browser:

1. Navigate to the launch receipt's `clerkClaimUrl` and follow its redirect.
2. Enter the dedicated email, choose email-code verification, and enter the development code.
3. Before consent, verify Clerk says the request is on behalf of that dedicated identity. If it shows the user's personal identity or any other account, stop without consenting or signing it out.
4. Allow access and follow the redirect to the existing `http://127.0.0.1:<ephemeral>/callback` listener. A Clerk redirect alone is not proof of completion; wait for Electron's public auth state to settle.

## Truth checks

Read `window.studi.getAuthState()` through the Electron renderer. For the currently approved fixture, the proven result is `status=approved`, `plan=beta`, `credits=100`, and `secureStorage=true`. Record the live subject returned by Clerk and compare it across auth and telemetry when relevant, but do not encode a fixed subject into source or scripts.

Then exercise only the journey in scope. Feature tests after onboarding use `-Persistent` and [feature-pass.md](feature-pass.md). Restart of an onboarded profile must use `-Persistent`. A new clean Clerk journey omits `-Persistent`.

Convex approval or credit changes go only through the repository's authenticated development admin mutation. Before any authorized change, look up current state and state the intended delta. Retain a separate unauthenticated call to `account:setBetaAccess` that fails with `Unauthenticated`; never treat renderer state or a direct database edit as approval evidence.

For school/LMS work, use controlled local fixtures or explicitly safe read-only real pages. Stop before any real submit, enrollment change, message, upload, or answer mutation. Leave zero-result and partial scans visibly incomplete.

## Evidence hygiene

Record the launcher receipt, timestamps, semantic UI observations, final public auth projection, and controlled Convex boundary result. Do not record the authorize URL, state, nonce, code challenge, authorization code, tokens, cookies, full browser command line, or Clerk page storage. Delete no browser data and terminate no browser process as part of this flow.
