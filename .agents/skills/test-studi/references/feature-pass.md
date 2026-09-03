# Skip-to-app feature pass

Use this after the persistent QA profile already has Studi signed in and onboarding finished. The agent then drives only the Studi React chrome with `playwright-electron`.

Pi owns the school guest pane. Do not attach Playwright to that guest. Do not type school passwords. Do not sign out of the persistent profile.

This pass skips onboarding. It cannot manufacture a completed scan. If the week board is not up, stop and say the profile still needs a first scan; a later local LMS fixture will own that step.

## Launch

1. Quit the everyday Studi window first. One Electron instance can hold the single-instance lock.
2. `npm run build` if source changed.
3. Launch with persistence and the Codex cache when a real agent turn is in scope:

   ```powershell
   .\.agents\skills\test-studi\scripts\Start-StudiQa.ps1 -Persistent -ImportCodexAuth
   ```

4. The receipt path is always `<repo>\.studi-qa\profile`. `profileReused=true` means this is not a first-run folder. Do not pass `-ResetPersistent` unless the user asked to wipe onboarded state.
5. Attach `playwright-electron` to `http://127.0.0.1:9222`.

## Admit the run or stop

Read these through the renderer before clicking around:

- `window.studi.getAuthState()`
- `window.studi.getSchoolOnboardingState()`
- `window.studi.getWorkspaceState()`
- `window.studi.getLifecycleState()`
- `window.studi.getLibraryState()`

Continue only when auth is `approved` or `offline`, onboarding has a completed school profile, and the week board (or desk) is the live screen.

If onboarding is still up, this is the wrong pass. Switch to [onboarding-pass.md](onboarding-pass.md) or stop. Do not seed assignments to skip ahead.

Codex:

- Chrome-only (greeting, board, Settings, Library, desk layout): continue even if `provider.state` is `needs_login`.
- Manager prompt, scan, or desk agent turn: provider must be `ready`. If not, follow [codex-login.md](codex-login.md). Do not open OpenAI in isolated Playwright.

## What the agent should click

Stay in Studi chrome. Use accessibility snapshots.

1. **This week** — greeting, scan pill, five-day board, desk strip. Open one visible task if any exist.
2. **Command bar** — send a read-only manager prompt such as “What is queued? Do not start an assignment.” Confirm a manager reply or an honest failure. Do not click **Start next** on a live school assignment unless the user explicitly asked and stored permission is `do_not_attempt`.
3. **Library** — open one task detail if the library has one; open one artifact if one exists.
4. **Settings** — confirm preferences, schedule, model, and permission rules render. Do not change the school URL, do not sign out, do not toggle telemetry off as part of a default pass.
5. **Scan again** — only when the user asked, or when proving replay. A zero-result or partial scan stays incomplete.
6. **Desk** — only if an execution is already live. Takeover / cancel only if the user asked. Never `browser_submit` and never verify a real submission.

If school login expired mid-pass, stop. Ask the user to sign in on the guest pane, then continue from the same profile.

## Restart

To prove persistence, quit Electron and launch `-Persistent` again. The same `.studi-qa\profile` must still be approved and onboarded. A throwaway temp profile is the wrong tool for this.

## Never

- Use the user's everyday Electron `userData`
- Sign out of the persistent profile
- Submit, enroll, message, upload, or change live schoolwork
- Seed demo assignments when a scan is empty
- Record Clerk or school secrets
