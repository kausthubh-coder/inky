# Full onboarding pass

Use this when the job is to walk first-run onboarding as a student. LMS sign-in and the first school scan are out of scope until a local LMS fixture exists. This pass owns Clerk (if needed) and Codex.

## Launch

1. Quit the everyday Studi window.
2. `npm run build` if source changed.
3. Prefer the persistent QA profile so Clerk and Codex can stick:

   ```powershell
   .\.agents\skills\test-studi\scripts\Start-StudiQa.ps1 -Persistent -ImportCodexAuth
   ```

   Omit `-ImportCodexAuth` only when proving a fresh Codex handoff. Omit `-Persistent` only when proving a throwaway Clerk journey.

4. Attach `playwright-electron` to `http://127.0.0.1:9222`.

## Admit the run

Read `window.studi.getAuthState()` and `window.studi.getWorkspaceState()`.

- Signed out → Clerk first. Read [clerk-electron-journey.md](clerk-electron-journey.md).
- Approved or offline, and the week board is already up → this is not a first-run. Switch to [feature-pass.md](feature-pass.md) unless the user asked to re-prove onboarding.
- Approved or offline, still on onboarding → continue here.

## Steps the agent drives

Stay in Studi chrome. Use accessibility snapshots.

1. **Hello.** Click through the greeting.
2. **ChatGPT / Codex.** This step auto-starts a device code. Follow [codex-login.md](codex-login.md):
   - Hydrate first (`-ImportCodexAuth` / `STUDI_QA_CODEX_AUTH`). If the UI says **Already connected**, click **Let's go**.
   - If a code appears, send that code to the user and wait. Do not open OpenAI in Playwright. After `provider.state === "ready"`, click **Let's go**, then export (`-Export -CopySecret` on Windows) so the Cursor secret can be refreshed.
3. **Class link.** One paste field. Use a local fixture URL when one exists. If none exists yet, stop after Codex and say the LMS step is waiting on the fixture. Do not paste a live school URL unless the user asked.
4. **Permission and schedule.** Use the product defaults (`Do it, I'll submit` and `Every morning`) unless the user asked otherwise.
5. **Open school / scan.** Stop before a live LMS sign-in or a real scan. A later fixture will own those steps.

Do not finish onboarding by seeding assignments, a workflow revision, or a fake scan.

## After Codex

If the user only needed the ChatGPT step proved, export the cache and stop:

```powershell
node .agents/skills/test-studi/scripts/sync-studi-qa-codex-auth.mjs --export --copy-secret
```

Ask the user to paste the clipboard into the Cursor Runtime Secret `STUDI_QA_CODEX_AUTH` if this is the first seed or the token was refreshed. Do not print the value.

If they also asked to skip ahead to the app, the persistent profile must already have a completed first scan. Codex ready alone does not open the week board.
