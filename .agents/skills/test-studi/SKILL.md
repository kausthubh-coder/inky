---
name: test-studi
description: Run Studi's isolated end-to-end desktop journey through the real Electron, Clerk, and Convex boundaries. Use for user-like release testing; use verify-studi for faster package-scoped proof.
---

# Test Studi

Exercise the built desktop app as a student would, without touching the user's browser profile or inventing success. This is the integrated journey layer; use `$verify-studi` for the cheapest focused boundary check during implementation.

## Before the run

Read [references/clerk-electron-journey.md](references/clerk-electron-journey.md) when the journey includes real sign-in, Convex beta access, restart, or the two Playwright MCP surfaces.

Use the current built artifact. If source changed since the last build, run `npm run build` first. Launch with [scripts/Start-StudiQa.ps1](scripts/Start-StudiQa.ps1); it creates a unique app profile and binds CDP to `127.0.0.1` only.

## Invariants

- Drive the Electron renderer and a separate isolated browser with Microsoft's official Playwright MCP. Do not use Computer Use for this flow.
- Never interact with the system-browser page that Electron opens. Capture its fresh Clerk authorize URL from a newly launched browser process with [scripts/Get-FreshClerkAuthorizeUrl.ps1](scripts/Get-FreshClerkAuthorizeUrl.ps1), then navigate the isolated Playwright browser to that exact URL.
- Treat the authorize URL, state, nonce, authorization code, tokens, cookies, and browser command lines as ephemeral. Do not save them in evidence, screenshots, shell history, or repository files.
- Use only a dedicated identity in Clerk's development instance. Reuse an existing test user when possible. Creating a user or approving beta access requires explicit user authorization, a lookup or dry run first, and the existing controlled development admin boundary.
- Never use or alter the user's personal Clerk session or active Studi device. Stop if Clerk shows a different identity than the dedicated test identity.
- Keep school work on controlled local fixtures or safe read-only pages. Never submit real schoolwork during a test. A partial or zero-result scan remains incomplete.
- Do not hard-code an observed Clerk subject, device ID, OAuth value, or token into production code or helpers.

## Stop conditions

Stop at the first unsafe or unproved boundary: URL capture or validation fails, a personal identity appears, the Clerk instance is not development, the callback is not loopback, cloud mutation lacks authorization, Convex reports a device conflict, the renderer contradicts cloud truth, or a school action could submit or modify real work. Report the smallest reproduction; do not retry by switching identities, releasing devices, seeding success, or bypassing the gate.

## Evidence contract

Retain only what proves the journey:

- build/runtime used, isolated profile path, loopback CDP endpoint, and timestamps;
- semantic renderer observations and the final public `window.studi` projection;
- dedicated test email plus the observed subject only when identity consistency matters;
- live entitlement result and secure-storage result;
- one unauthenticated Convex mutation failure proving the admin boundary remains closed;
- controlled fixture/page identity, observed result, and the smallest reproduction for any failure.

Never retain the authorization URL or its query values. One screenshot is enough only when it adds visible evidence.
