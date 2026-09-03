---
name: test-studi
description: Run Studi's isolated end-to-end desktop journey through the real Electron, Clerk, and Convex boundaries. Supports a full first-run onboarding pass and a skip-to-app feature pass. Codex login cannot be completed in isolated Playwright; reuse the dedicated QA auth cache or ask the user to finish the device code. Use verify-studi for faster package-scoped proof.
---

# Test Studi

Exercise the built desktop app as a student would, without touching the everyday Studi profile or inventing success. This is the integrated journey layer; use `$verify-studi` for the cheapest focused boundary check during implementation.

There are two jobs. Pick one:

- **Skip to app (default):** reuse `.studi-qa/profile` and drive the week board. Use this when onboarding is already done, or when the job is chrome, Settings, Library, or desk layout. Codex is required only if the job starts a manager, scan, or desk agent turn.
- **Full onboarding:** walk first-run from the signed-out gate through Clerk and Codex. Stop before a live LMS sign-in until a local school fixture exists.

## Before the run

| Job | Read |
| --- | --- |
| Skip to app | [references/feature-pass.md](references/feature-pass.md) |
| Full onboarding | [references/onboarding-pass.md](references/onboarding-pass.md) |
| New Clerk sign-in | [references/clerk-electron-journey.md](references/clerk-electron-journey.md) |
| Codex connect, cache, or device code | [references/codex-login.md](references/codex-login.md) |

Use the current built artifact. If source changed since the last build, run `npm run build` first. Quit the everyday Studi window before launching QA.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\.agents\skills\test-studi\scripts\Start-StudiQa.ps1 -Persistent -ImportCodexAuth
```

If a `.ps1` is blocked, use the Node helper instead of fighting ExecutionPolicy:

```powershell
node .agents/skills/test-studi/scripts/sync-studi-qa-codex-auth.mjs --export --copy-secret
node .agents/skills/test-studi/scripts/sync-studi-qa-codex-auth.mjs --import
```

That binds CDP to `127.0.0.1` only and reuses `<repo>\.studi-qa\profile`. `-ImportCodexAuth` hydrates Codex from `STUDI_QA_CODEX_AUTH` (Cursor Runtime Secret) or `.studi-qa\codex-auth\auth.json`, then copies it into the profile. First time both are empty: the user completes Clerk and Codex by hand, then the agent exports and asks them to store the Cursor secret. After that, do not ask them to log in again unless auth or Codex is actually gone.

Do not pass `-ResetPersistent` unless the user asked to wipe the onboarded QA profile.

## Codex rule

Isolated Playwright cannot finish OpenAI device authorization. A real run got HTTP 403 before a code box existed.

1. If `provider.state` is already `ready`, continue.
2. If the launcher receipt says `codexAuthImported=true`, confirm `ready` in the renderer.
3. If Codex is still needed, the ChatGPT onboarding step already started a device code. Tell the user the code, poll until `ready`, then `node .agents/skills/test-studi/scripts/sync-studi-qa-codex-auth.mjs --export --copy-secret`. Ask them to put the clipboard into the Cursor Runtime Secret `STUDI_QA_CODEX_AUTH`. Never print the token.
4. Never open `auth.openai.com` or ChatGPT login in isolated Playwright. Never copy everyday `%APPDATA%\Studi` unless the user explicitly asked to seed QA from it. Never commit `.studi-qa/`.

Chrome-only skip-to-app tests may continue when Codex is disconnected. Manager, scan, and desk agent turns may not.

## Invariants

- Drive the Electron renderer with Microsoft's official Playwright MCP (`playwright-electron`). The school guest pane is for Pi, not for Playwright. Do not use Computer Use for Studi chrome.
- Never interact with the system-browser page Electron opens for Clerk. If a *new* Clerk login is required, capture its fresh authorize URL with [scripts/Get-FreshClerkAuthorizeUrl.ps1](scripts/Get-FreshClerkAuthorizeUrl.ps1) and complete it in the isolated Playwright browser.
- Treat authorize URLs, device codes, tokens, cookies, `auth.json`, and browser command lines as ephemeral. Do not save them in evidence, screenshots, shell history, or repository files.
- Use only a dedicated identity in Clerk's development instance. Reuse an existing test user when possible. Creating a user or approving beta access requires explicit user authorization, a lookup or dry run first, and the existing controlled development admin boundary.
- Never use or alter the user's personal Clerk session or everyday Studi `userData`. Stop if Clerk shows a different identity than the dedicated test identity.
- After onboarding, a real LMS is allowed for read-only proof. Never submit real schoolwork. A partial or zero-result scan remains incomplete. Do not seed demo assignments to skip into the week board.
- In the persistent profile, do not sign out. That throws away the one-time handoffs.
- Do not hard-code an observed Clerk subject, device ID, OAuth value, or token into production code or helpers.

## Stop conditions

Stop at the first unsafe or unproved boundary: URL capture or validation fails, a personal identity appears, the Clerk instance is not development, the callback is not loopback, cloud mutation lacks authorization, Convex reports a device conflict, the renderer contradicts cloud truth, Codex is missing when the test needs a real agent turn, or a school action could submit or modify real work. Report the smallest reproduction; do not retry by switching identities, releasing devices, seeding success, or bypassing the gate.

## Evidence contract

Retain only what proves the journey:

- build/runtime used, profile path, `persistent` / `profileReused` / `codexAuthImported` from the launcher receipt, loopback CDP endpoint, and timestamps;
- semantic renderer observations and the final public `window.studi` projection;
- dedicated test email plus the observed subject only when identity consistency matters;
- live entitlement result and secure-storage result when auth is in scope;
- provider `ready` or `needs_login`, never the device code;
- one unauthenticated Convex mutation failure when proving the admin boundary;
- which screens the feature pass actually opened, and the smallest reproduction for any failure.

Never retain the authorization URL, device code, or auth-file bytes. One screenshot is enough only when it adds visible evidence.
