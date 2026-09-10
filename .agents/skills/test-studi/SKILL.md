---
name: test-studi
description: Verify Studi changes with full app journeys or focused UI, agent harness, storage, and web checks. Review common failure states, usability, code quality, and maintainability; isolate QA profiles and distinguish live proof from controlled tests.
---

# Test Studi

Test the checkout the user is changing. Choose evidence proportional to the change, fix failures within scope, and review the final diff before calling the work ready. Repair routine QA setup yourself; a signed-out or missing test profile is setup work, not a reason to stop. Do not claim a full flow from screenshots, previews, or seeded state.

## Choose the proof before editing

State the user-visible outcome and the few likely ways it could fail. Use the smallest mode that proves that outcome; combine modes when a change crosses boundaries. Read [review-standard.md](references/review-standard.md) for the shared usability, code-quality, and completion review.

| Change or request | Required proof |
| --- | --- |
| Full app test, release readiness, onboarding, or a broad cross-system change | [Full app pass](references/full-app-pass.md): fresh admission → onboarding → scan → chat → homework → restart. Include connected-app work when supported/in scope. |
| An existing desktop feature or bug | [Feature pass](references/feature-pass.md): reproduce the trigger, exercise the fix in the real app, check its result and the adjacent common failure/recovery path. Reuse an onboarded profile. |
| UI, copy, icons, layout, interaction | [Focused UI pass](references/focused-passes.md#ui-and-interaction): actual components, visual inspection, controls and relevant states; native verification for native behavior. |
| Prompts, model/reasoning, memory, tools, agent harness or benchmark | [Focused agent pass](references/focused-passes.md#agent-harness-prompts-and-memory): production-path contracts plus bounded live runs when claiming agent behavior. |
| Storage, identities, permissions, IPC, scheduling or updates | [Focused system pass](references/focused-passes.md#storage-runtime-and-native-systems): observable invariants and the affected app boundary. |
| Documentation or skill-only edit | Validate references, commands and representative decisions. Run changed helpers if any; no unrelated full app run. |

Use a full pass again on the integrated release candidate when separately tested changes interact. A component test passing on another branch is not evidence that the combined build works. Do not repeat full onboarding for a cosmetic edit or run every suite after relevant checks already pass.

## Setup guides

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

Keep a concise receipt under ignored `.agents/studi-qa/`: selected mode, intended result, build/revision and dirty state, checks with expected/observed outcomes, evidence paths, code/UI review findings, and remaining limits. For desktop journeys include receipt/profile name and `buildTreeSha256`, screens actually exercised, public auth/provider readiness, relevant scan/work outcomes, and restart result when required. The tree hash includes imported Electron modules and renderer assets; entry-point hashes alone cannot prove a fix is loaded. Separate **passed**, **failed**, and **not run**, and label live, controlled, preview, and native evidence. Keep the smallest reproduction for each failure.

A full live pass requires approved access and provider ready, a real fixture scan, a real chat reply, scoped assignment work, and persistence after restart. A partial/empty scan or accepted invitation with waitlisted Convex access is a failure at that boundary. Stop that dependent journey, diagnose it, and continue independent checks.

Run helper regressions with `node --test tests/auth/qa-tooling.test.mjs`; normal `bun run test:auth` includes them. The controlled native suite is `bun run test:electron`.

The final report leads with what now works, then relevant verification and material limitations. Never replace evidence with “all tested,” a test count, or a screenshot. If a required live check is blocked, finish independent checks and identify the exact unproven boundary; mark the change implemented with verification pending, not fully verified.
