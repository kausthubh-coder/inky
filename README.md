# Studi

Studi is a local-first Electron agent that helps students manage and complete browser-based schoolwork while keeping school credentials inside a persistent embedded browser profile.

This is a Bun workspace:

- Desktop app: `desktop/` (`electron/`, `src/`, and `shared/`)
- Public site: `landing/` (Next.js, Vercel project `inky`)
- Shared backend: `convex/` (same Clerk + Convex deployment)

## Current prototype

- Electron desktop shell with a visible `WebContentsView` school browser
- React and Vite product UI using the Studi/Inky visual language
- Pi `AgentSession` runtime with OpenAI Codex device authorization
- General browser tools for inspecting and operating supported school sites
- Local SQLite task state, Markdown artifacts, queues, permissions, and scheduling
- Clerk authentication, Convex beta entitlement, landing waitlist emails, and privacy-controlled PostHog telemetry
- Close-to-tray lifecycle and Windows/macOS packaging through Electron Forge
- A dedicated homework workspace with one class folder per course, one durable folder per assignment, and an app-owned `.studi-sandbox`

## Develop

Requirements: [Bun](https://bun.sh) 1.3+ and Node.js 22.

```bash
bun install
bun run dev:electron
```

Landing site:

```bash
bun run dev:landing
```

Copy `landing/.env.example` to `landing/.env.local` and fill in the keys for the dedicated **Inky** Clerk application. Its development instance uses Waitlist access mode, the `convex` JWT template, and the public **Inky Desktop** OAuth client with PKCE. Convex needs `CLERK_JWT_ISSUER_DOMAIN` plus that desktop client's `CLERK_OAUTH_CLIENT_ID`; its auth config accepts both the web `convex` token and the Electron OAuth ID token.

Private-beta access is free. The billing page is an account-facing beta-plan receipt and never asks for a card. Clerk sends the waitlist confirmation and invitation emails from the source-controlled templates in `clerk/email-templates`.

The landing site can send anonymous, cookieless traffic and conversion events to a dedicated Inky PostHog project. The event contract and dashboard recipe are in [`landing/ANALYTICS.md`](landing/ANALYTICS.md).

The website's **Open Studi** button sends only `studi://connect`. Electron owns the PKCE verifier, state, nonce, loopback callback, code exchange, and token storage.

Create a production desktop build and run the focused smoke test:

```bash
bun run build
node tests/electron-self-test-runner.mjs --positive-only
```

Build the Windows package:

```bash
bun run make:win
```

Build the universal macOS package on a Mac:

```bash
bun run make:mac
```

Studi asks for a new empty folder during onboarding. It places class and assignment folders there, runs assignment file/shell tools from the active assignment only, and limits browser uploads to files produced in that folder. Do not select Documents, Desktop, a source repository, or any folder that already contains personal files.

Pushing a `v*` tag runs [the desktop release workflow](.github/workflows/release-desktop.yml), tests on Windows and macOS, and publishes `Studi-Setup.exe`, `Studi-macOS.zip`, and checksums to GitHub Releases. The stable download URLs used by the account portal and beta invitation are:

- `https://github.com/kausthubh-coder/inky/releases/latest/download/Studi-Setup.exe`
- `https://github.com/kausthubh-coder/inky/releases/latest/download/Studi-macOS.zip`

Cloud and remote agents should use the same commands. Do not expect `.agents/studi-qa/` on a fresh machine. Hydrate Codex with:

```bash
node .agents/skills/test-studi/scripts/sync-studi-qa-codex-auth.mjs --import
```

That reads the Cursor Runtime Secret `STUDI_QA_CODEX_AUTH`. Never echo it or commit the written file.

Runtime secrets belong in `.env.local` and `landing/.env.local`, which are excluded from Git. School passwords, cookies, browser state, agent sessions, queues, and memories remain in the app's local user-data directory and must not be committed.

The public site deploys from `landing/` to the Vercel project `inky`. Do not deploy this repo to the Vercel project `studi-2`.

## Project documentation

- Architecture and work packages: [`.agents/plans/studi-master-plan.html`](.agents/plans/studi-master-plan.html)
- Product decisions: [`STUDI_PRODUCT_DECISIONS.md`](STUDI_PRODUCT_DECISIONS.md)
- Build conclusions: [`.agents/qa/conclusions/`](.agents/qa/conclusions/)

This repository is an early private-beta prototype and is not licensed for redistribution.
