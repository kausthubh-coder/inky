# Studi

Studi is a local-first Electron agent that helps students manage and complete browser-based schoolwork while keeping school credentials inside a persistent embedded browser profile.

## Current prototype

- Electron desktop shell with a visible `WebContentsView` school browser
- React and Vite product UI using the Studi/Inky visual language
- Pi `AgentSession` runtime with OpenAI Codex device authorization
- General browser tools for inspecting and operating supported school sites
- Local SQLite task state, Markdown artifacts, queues, permissions, and scheduling
- Clerk authentication, Convex beta entitlement, and privacy-controlled PostHog telemetry
- Close-to-tray lifecycle and Windows packaging through Electron Forge

## Develop

Requirements: Node.js 22 and npm.

```bash
npm install
npm run dev:electron
```

Create a production build and run the focused desktop smoke test:

```bash
npm run build
node tests/electron-self-test-runner.mjs --positive-only
```

Build the Windows package:

```bash
npm run make:win
```

Runtime secrets belong in `.env.local`, which is intentionally excluded from Git. School passwords, cookies, browser state, agent sessions, queues, and memories remain in the app's local user-data directory and must not be committed.

## Project documentation

- Architecture and work packages: [`.agents/plans/studi-master-plan.html`](.agents/plans/studi-master-plan.html)
- Product decisions: [`STUDI_PRODUCT_DECISIONS.md`](STUDI_PRODUCT_DECISIONS.md)
- Build conclusions: [`.agents/qa/conclusions/`](.agents/qa/conclusions/)

This repository is an early private-beta prototype and is not licensed for redistribution.
