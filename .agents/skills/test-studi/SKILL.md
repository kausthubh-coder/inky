---
name: test-studi
description: Run Studi's isolated end-to-end desktop journey through the real Electron, Clerk, and Convex boundaries. After one human onboarding in the persistent QA profile, reuse that profile so the agent can drive later feature tests itself. Use verify-studi for faster package-scoped proof.
---

# Test Studi

Exercise the built desktop app as a student would, without touching the user's everyday Studi profile or inventing success. This is the integrated journey layer; use `$verify-studi` for the cheapest focused boundary check during implementation.

There are two launches. Pick one:

- **Feature test (default after onboarding exists):** reuse `.studi-qa/profile`. The user already finished Clerk, Codex, and school sign-in once. The agent launches `-Persistent` and drives Studi with Playwright.
- **Clean auth journey:** omit `-Persistent` so the helper creates a throwaway profile. Use this only to prove a fresh Clerk handoff.

## Before the run

Read [references/clerk-electron-journey.md](references/clerk-electron-journey.md) when the journey includes a *new* Clerk sign-in, Convex beta access, or the isolated Playwright browser.

Read [references/feature-pass.md](references/feature-pass.md) when the persistent profile is already onboarded and the job is to exercise product features.

Use the current built artifact. If source changed since the last build, run `npm run build` first. Quit the everyday Studi window before launching QA.

```powershell
.\.agents\skills\test-studi\scripts\Start-StudiQa.ps1 -Persistent
```

That binds CDP to `127.0.0.1` only and reuses `<repo>\.studi-qa\profile` (Clerk tokens, Codex/Pi state, school cookies, SQLite). First time that folder is empty: the user completes onboarding by hand in that window. After that, the agent should not ask them to log in again unless auth, Codex, or the school session is actually gone.

Do not pass `-ResetPersistent` unless the user asked to wipe the onboarded QA profile.

## Invariants

- Drive the Electron renderer with Microsoft's official Playwright MCP (`playwright-electron`). The school guest pane is for Pi, not for Playwright. Do not use Computer Use for Studi chrome.
- Never interact with the system-browser page Electron opens for Clerk. If a *new* Clerk login is required, capture its fresh authorize URL with [scripts/Get-FreshClerkAuthorizeUrl.ps1](scripts/Get-FreshClerkAuthorizeUrl.ps1) and complete it in the isolated Playwright browser.
- Treat the authorize URL, state, nonce, authorization code, tokens, cookies, and browser command lines as ephemeral. Do not save them in evidence, screenshots, shell history, or repository files.
- Use only a dedicated identity in Clerk's development instance. Reuse an existing test user when possible. Creating a user or approving beta access requires explicit user authorization, a lookup or dry run first, and the existing controlled development admin boundary.
- Never use or alter the user's personal Clerk session or everyday Studi `userData`. Stop if Clerk shows a different identity than the dedicated test identity.
- After onboarding, a real LMS is allowed for read-only proof. Never submit real schoolwork. A partial or zero-result scan remains incomplete.
- In the persistent profile, do not sign out. That throws away the one-time handoffs.
- Do not hard-code an observed Clerk subject, device ID, OAuth value, or token into production code or helpers.

## Stop conditions

Stop at the first unsafe or unproved boundary: URL capture or validation fails, a personal identity appears, the Clerk instance is not development, the callback is not loopback, cloud mutation lacks authorization, Convex reports a device conflict, the renderer contradicts cloud truth, Codex or school login is missing when the test needs it, or a school action could submit or modify real work. Report the smallest reproduction; do not retry by switching identities, releasing devices, seeding success, or bypassing the gate.

## Evidence contract

Retain only what proves the journey:

- build/runtime used, profile path, `persistent` / `profileReused` from the launcher receipt, loopback CDP endpoint, and timestamps;
- semantic renderer observations and the final public `window.studi` projection;
- dedicated test email plus the observed subject only when identity consistency matters;
- live entitlement result and secure-storage result when auth is in scope;
- one unauthenticated Convex mutation failure when proving the admin boundary;
- which screens the feature pass actually opened, and the smallest reproduction for any failure.

Never retain the authorization URL or its query values. One screenshot is enough only when it adds visible evidence.
