---
name: test-studi
description: Test Studi's real Electron app and web account UI, including creating or reusing dedicated development accounts, accepting Clerk invitations, onboarding, local school scans, chat, and assignment work. Isolates profiles, ports, and identities for concurrent worktrees; distinguishes live-provider proof from controlled tests.
---

# Test Studi

Test the checkout the user is changing. Repair routine QA setup yourself; a signed-out or missing test profile is setup work, not a reason to stop. Do not claim a full flow from screenshots, previews, or seeded state.

## Choose the proof

- **Web account UI:** use [references/web-account-pass.md](references/web-account-pass.md) for the Next.js dashboard, settings, billing, and desktop handoff page. Test this checkout's web server in an isolated browser with the dedicated Clerk development identity. Electron and Codex are not required for a web-only UI pass.

- **Feature pass:** reuse an approved, onboarded profile, then follow [feature-pass.md](references/feature-pass.md).
- **Fresh or incomplete profile:** follow [onboarding-pass.md](references/onboarding-pass.md), including the local school fixture and real first scan.
- **Accounts and invitations:** [clerk-electron-journey.md](references/clerk-electron-journey.md) covers lookup, creation, email-code login, acceptance, and admission diagnostics.
- **Worktrees, attachment, cleanup, native folder chooser:** [worktrees.md](references/worktrees.md).
- **Codex unavailable:** [codex-login.md](references/codex-login.md). Reuse the QA cache first. Human help may still be needed for OpenAI device authorization.

## Before the desktop run

For web-only work, follow the web account guide above. The launcher, Codex, and Electron evidence requirements below apply to desktop runs; identity and secret-handling rules apply to both surfaces.

Build source changes with `bun run build`. In a new worktree, run `Setup-StudiWorktree.ps1` from this skill first.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/skills/test-studi/scripts/Start-StudiQa.ps1 -Persistent -ImportCodexAuth
```

The launcher allocates loopback ports and keeps the profile inside this worktree. Read its receipt: `profilePath`, `testEmail`, `cdpEndpoint`, `clerkClaimUrl`, and `mainInspectorEndpoint`. Receipts live in `.agents/studi-qa/runs/`. Use `-ProfileName <name>` for a separate journey in the same checkout. Never assume port 9222. Do not close another task's app or the everyday installation.

Attach Microsoft's Playwright to the receipt endpoint; see the dynamic attachment example in [worktrees.md](references/worktrees.md). Check the renderer's file path matches this checkout. Read public auth, workspace, and school-onboarding state. Reuse an existing dedicated identity if already signed in; `testEmail` is the suggested identity for a fresh profile, not permission to switch an existing profile's account.

If signed out, look up and prepare the dedicated test identity using the account helper. Do not ask the user to log into Clerk. Account setup must check the current state first and verify both the Clerk development instance and exact test email. A user's request to set up or run QA with test accounts authorizes the necessary dedicated test-account creation and invitation flow. Carry that authorization forward; do not ask again for each worktree. This does not authorize personal/production accounts, deletion, admin grants, credit changes, or unrelated invitations.

## Boundaries

- Keep each concurrently running profile on its own dedicated Clerk identity. Separate profiles sharing one subject can conflict with the backend's device lease.
- Automate only Studi chrome through Playwright. Pi drives the school guest. A local fixture may accept drafts/submissions as simulated actions; never submit or modify real schoolwork.
- Do not copy personal browser cookies, Clerk tokens, device IDs, SQLite databases, or everyday Studi profiles into QA.
- Do not reset an onboarded profile to reach a screen; use another profile. `-ResetPersistent` requires a requested wipe. `-DryRun` never changes data.
- Do not grant temporary Convex beta access or alter admin settings to get past admission. Verify the supported invitation path and report a mismatch with current backend behavior.
- Keep tickets, OAuth URLs, codes, cookies, tokens, and auth-file contents out of tool output, evidence, screenshots, and tracked files. The invitation helper exposes only a one-shot loopback claim URL.
- Preview/controlled tests can proceed during a live-service failure, but label those results separately. Do not silently replace a real provider, scan, or authentication result with a fixture.

## Completion evidence

Record build/revision and dirty state, receipt/profile name and `buildTreeSha256`, screens actually exercised, public auth status and provider readiness, real scan coverage and discovered fixture assignment, chat/work outcome, and restart result. The tree hash includes imported Electron modules and renderer assets; entry-point hashes alone cannot prove a fix is loaded. Separate **passed**, **failed**, and **not run**. Keep the smallest reproduction for each failure.

A full live pass requires approved access and provider ready, a real fixture scan, a real chat reply, scoped assignment work, and persistence after restart. A partial/empty scan or accepted invitation with waitlisted Convex access is a failure at that boundary. Stop that dependent journey, diagnose it, and continue independent checks.

Run helper regressions with `node --test tests/auth/qa-tooling.test.mjs`; normal `bun run test:auth` includes them. The controlled native suite is `bun run test:electron`.
