---
name: test-studi
description: Verify Studi changes at the cheapest tier that proves them - static checks, the UI preview, the fake school without the product UI, a desktop pass on an onboarded QA profile, or the full onboarding-to-restart journey. Review usability and maintainability, keep QA profiles isolated, and label live versus controlled evidence.
---

# Test Studi

Pick the smallest tier that can prove the change, run it, and report what passed, what failed, and what was not run. Build once per code change and reuse profiles and servers. Do not run the whole app for a change that never crosses its boundary, and do not call a change verified from a lower tier when it also changes a higher one. Read [review-standard.md](references/review-standard.md) for the usability and code review that applies at every tier.

## Tiers

| Tier | Cost | Proves | Guide |
| --- | --- | --- | --- |
| 0 Check | seconds, no app build | formatting, types, and the storage, agent, contract, telemetry and backend logic under `tests/` and `convex/` | `bun run check`, then `bun run build:electron` and `node --test tests/<area>/*.test.mjs` for the touched area, or `bun run test:backend` |
| 1 Preview | Vite dev server, no build | the real React screens against fixture state, every visual state, copy, keyboard and layout | [preview-pass.md](references/preview-pass.md) |
| 2 Fake school | `build:electron` and `build:lms`, no product UI | the production scan, files, manager and storage path against a school with known ground truth, with or without a real provider | [fake-school-pass.md](references/fake-school-pass.md) |
| 3 Desktop | one `bun run build`, an onboarded QA profile | the changed feature inside the real app: IPC, school pane, native dialogs, notifications, provider sign-in, restart | [desktop-pass.md](references/desktop-pass.md) |
| 4 Full app | one `bun run build`, a fresh QA profile | admission, onboarding, first scan, chat, homework, competing activity and restart as one connected journey | [full-app-pass.md](references/full-app-pass.md) |

Web account changes use [web-account-pass.md](references/web-account-pass.md) instead; they need neither Electron nor a provider.

## Which tiers a change needs

| Changed | Run |
| --- | --- |
| `desktop/shared`, `desktop/electron/storage`, `desktop/agent-system`, `convex` | 0 |
| `desktop/src` | 0 and 1. Add 3 when the change drives IPC, the school pane, native dialogs or notifications. |
| `desktop/electron/scan`, `agent`, `files`, `manager`, `assignment`, or an agent pack | 0 and 2. Add 3 when the result is visible in the UI. |
| `desktop/electron/main.ts`, `auth`, `browser`, `lifecycle`, `updates`, `preload.cts` | 0 and 3 |
| Onboarding, admission, provider sign-in, a release candidate, or several rows at once | 0 and 4 |
| `landing` | web account pass |
| Docs, skills, scripts | run the changed helper; nothing else |

Combine tiers when a change crosses rows. A tier passing on another branch is not evidence for the combined build; rerun the affected tiers after merging.

## Build once, reuse everything

- `bun run build:electron` takes seconds and refreshes `dist/electron` for node tests, the fake school runner, and the QA launcher's main process. `bun run build` adds the Vite renderer build and is needed only before launching the real app after a renderer change.
- The preview reads source directly through Vite; it never needs a build.
- Reuse the onboarded QA profile in this worktree for tier 3. Create a fresh named profile only for tier 4, then keep it for the restart check.
- Keep the fake school and preview servers running across edits in the same session. Restart the QA app only after `dist` changed.
- In a new worktree run `Setup-StudiWorktree.ps1` from `scripts/` once; it installs, imports the QA provider cache, and builds.

## Boundaries

- Each running QA profile owns one dedicated Clerk identity. Sharing a subject between profiles conflicts with the backend device lease.
- Automate only Studi chrome through Playwright. Inky drives the school pane. The fake school accepts drafts and submissions as simulated actions; never submit or modify real schoolwork.
- Do not copy personal browser cookies, Clerk tokens, device IDs, SQLite databases or the everyday Studi profile into QA.
- Do not reset an onboarded profile to reach a screen; use another profile or the preview. `-ResetPersistent` requires a requested wipe. `-DryRun` never changes data.
- Do not grant beta access, change credits or alter admin settings to get past admission. Report a mismatch with current backend behavior instead.
- Keep tickets, OAuth URLs, device codes, cookies, tokens and auth-file contents out of tool output, evidence, screenshots and tracked files.
- Controlled tiers may proceed during a live-service outage, but label their results separately. Never present a fixture, preview or mocked result as a live provider, scan or authentication result.
- Keep one heavy job at a time on a limited-memory machine; see [worktrees.md](references/worktrees.md).

## Report

Keep a short receipt under ignored `.agents/studi-qa/`: tiers run, build revision and dirty state, each check with expected and observed outcome, evidence paths, review findings, and untested limits. For desktop tiers add the profile name, `buildTreeSha256` from the receipt, screens exercised, auth and provider state, and the restart result.

Separate **passed**, **failed** and **not run**. Label each item live, controlled, preview or native. Keep the smallest reproduction for each failure. The final message leads with what now works, then the evidence, then the material limits. A test count, "all tested", or a screenshot is not evidence. If a required live check is blocked, finish every independent tier and name the exact unproven boundary.
