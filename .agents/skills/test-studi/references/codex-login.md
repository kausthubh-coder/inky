# Codex login for Test Studi

Studi's agent is Pi's `openai-codex` provider. Credentials live in the Electron profile at `studi-data/pi/auth.json`. Onboarding step 1 starts a `device_code` login, shows a one-time code, and opens `https://auth.openai.com/codex/device` in the **system** browser.

Isolated official Playwright cannot finish that page. A real QA run reached the OpenAI surface and got HTTP 403 (`Just a moment...`) before a code box existed. Do not retry that path.

## Which job needs Codex

| Job | Codex required? |
| --- | --- |
| Skip-to-app chrome (week board, Settings, Library, desk layout) | No. Continue if the week board is up. |
| Full onboarding through the ChatGPT step | Yes. Provider must become `ready`. |
| Manager prompt, school scan, or desk agent turn | Yes. Stop if provider is not `ready`. |

## Allowed completions (in order)

1. **Already ready.** `window.studi.getWorkspaceState()` shows `provider.state === "ready"`. Do nothing.
2. **Hydrate the QA cache.** Launch with `-ImportCodexAuth` (or `node .../sync-studi-qa-codex-auth.mjs --import`). The helper fills `.agents/studi-qa/codex-auth/auth.json` from, in order: `STUDI_QA_CODEX_AUTH`, then the gitignored cache file. Then confirm `ready`.
3. **Human device code.** Start Connect Codex in Studi, read the code from the renderer, ask the user to finish it in a real browser, poll until `ready`. Then export the cache and, on Windows, copy the secret for Cursor.
4. Stop. Report that Codex is not ready. Do not invent a connected provider.

## Never

- Navigate isolated Playwright to `auth.openai.com`, `chatgpt.com/auth/device`, or any OpenAI login.
- Use Computer Use to type a ChatGPT password or MFA.
- Copy the everyday Studi `userData` (usually `%APPDATA%\Studi`).
- Print, screenshot, or save the one-time code, verification URL query, tokens, or `auth.json` bytes.
- `echo`, `cat`, or log `STUDI_QA_CODEX_AUTH`.
- Seed a fake `ready` provider or call login IPC as proof of success.
- Commit `.agents/studi-qa/` or put the token in GitHub.

## Persistence without GitHub

The cache file stays gitignored. Local Codex-managed worktrees receive it through `.worktreeinclude`. Remote environments use a secret named `STUDI_QA_CODEX_AUTH` during setup to hydrate the same gitignored cache.

| Place | What lives there | Who sees it |
| --- | --- | --- |
| `.agents/studi-qa/codex-auth/auth.json` | Local Pi `auth.json` copy | This machine only |
| Remote secret `STUDI_QA_CODEX_AUTH` | Same bytes, base64 or raw JSON | Setup phase only; hydrate the gitignored cache before the agent phase |
| GitHub | Nothing | — |

Do not use a plain Environment Variable secret. That type is visible to the agent in chat.

### First-time seed (human, on the Windows QA machine)

1. Finish one real Codex login in the persistent QA window, or copy an existing Studi Pi `auth.json` only when the user asked.
2. Export and copy the secret to the clipboard (value is not printed). Prefer Node so Windows ExecutionPolicy cannot block it:

   ```powershell
   node .agents/skills/test-studi/scripts/sync-studi-qa-codex-auth.mjs --export --copy-secret
   ```

3. In the remote environment settings, add `STUDI_QA_CODEX_AUTH` as a secret and make its setup script run `node .agents/skills/test-studi/scripts/sync-studi-qa-codex-auth.mjs --import`. Paste from the clipboard. Do not paste it into chat or a tracked file.
4. Reset the environment cache after rotating the secret.

If Studi later says Codex needs login again, repeat the human device code, re-export, and replace the same secret. Cloud agents cannot update Cursor Secrets themselves.

Pi refreshes short-lived access tokens by itself from the refresh token inside `auth.json`. You do **not** re-export or update the Cursor secret on every access-token expiry. Re-seed only when `provider.state` is `needs_login` after a hydrate, or when ChatGPT was revoked.

### What every agent does

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\.agents\skills\test-studi\scripts\Start-StudiQa.ps1 -Persistent -ImportCodexAuth
```

```bash
node .agents/skills/test-studi/scripts/sync-studi-qa-codex-auth.mjs --import
```

For a new local Codex-managed worktree, select the Studi local environment whose Windows setup action is:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\.agents\skills\test-studi\scripts\Setup-StudiWorktree.ps1
```

`.worktreeinclude` supplies `.env.local` and the gitignored Codex auth cache to that managed worktree. Use a distinct CDP port when two QA apps run at once.

For Codex Cloud, add `STUDI_QA_CODEX_AUTH` as a **secret** and use this setup command:

```bash
bash .agents/skills/test-studi/scripts/setup-studi-cloud.sh
```

The receipt may say `source=env` or `source=file`. It reports byte length only. If import ran and the app still says `needs_login`, the secret is stale. Do not import a second time in the same run. Fall back to a human device code.

## What happens at the onboarding Codex step

Entering the ChatGPT step starts device-code login by itself. The student copy is a code plus “If the page didn't open, click this link.”

**If hydrate worked**

The bubble says **Already connected**. Click **Let's go**. Do not start another login.

**If Codex is still needed**

1. Wait until `providerLogin.phase === "waiting"`, `verificationUri` is `https://auth.openai.com/codex/device` with no query, and `userCode` is non-empty.
2. Tell the user the code in chat. Ask them to finish ChatGPT in their own browser. A cloud agent cannot open that page for them.
3. Poll `getWorkspaceState()` until `provider.state === "ready"` or the handoff is `failed` / `expired`.
4. On `ready`, export the local cache. On Windows, also `-CopySecret` and ask the user to refresh the Cursor secret. Do not put the value in evidence.
5. On expiry or failure, click **Try again** once. If it fails again, stop.

A dedicated ChatGPT account is better than the user's everyday ChatGPT. The skill does not create that account.

## Codex Cloud limit

Codex Cloud containers are Linux. This helper can hydrate the token there, but the current Studi QA launcher starts Windows `electron.exe`, so a live desktop pass still runs on Windows Local or a Windows worktree. A cloud agent may build and run non-Electron checks; it must not claim a renderer pass it could not open.

## Options that are not the current path

- **Headed real Chrome + dedicated ChatGPT cookies.** Isolated bundled Chromium already failed the bot check.
- **Host Codex CLI auth.** Different store than Pi. Do not copy `~/.codex` unless a later package proves the formats match.
- **API key.** Only if Pi's `openai-codex` provider actually accepts a key.
- **Faux provider.** Fine for Electron self-test. Never claim a real manager or scan turn from it.
- **1Password Environments.** Useful later on macOS/Linux. The 1Password MCP does not mount `.env` on Windows, and Cloud VMs do not have the 1Password app.
- **Everyday profile copy.** Forbidden. It mixes the personal ChatGPT subscription into QA.
