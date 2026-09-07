# Codex readiness and cache

Studi uses Pi's `openai-codex` provider. Credentials are in the QA profile's `studi-data/pi/auth.json`. Check `window.studi.getWorkspaceState()` for provider `ready` after auth admission; that call may fail while the protected runtime is unavailable.

Chrome-only checks can continue without Codex if onboarding is complete. First scans, chat replies, and assignment work need a real ready provider. A ready badge proves configuration, not a successful provider request.

## Recovery order

1. If the profile is already ready, reuse it.
2. Launch with `-ImportCodexAuth`. The sync helper preserves a usable existing profile credential so a refreshed token is not overwritten every launch. Otherwise it uses `STUDI_QA_CODEX_AUTH`, the local gitignored cache, or the primary checkout's dedicated QA cache for a linked worktree. Each profile receives its own file.
3. If the app reports `needs_login` after import, do not repeatedly reimport the same stale credential. A deliberate recovery can use `--force` with a known refreshed QA cache, while the profile is stopped.
4. If no usable QA credential remains, ask the user to complete the OpenAI device code shown by Studi. Isolated Chromium previously encountered OpenAI's anti-bot page; do not repeatedly try that login or handle a personal password/MFA.
5. Once the provider is ready, export the QA credential. Do not print it.

```powershell
node .agents/skills/test-studi/scripts/sync-studi-qa-codex-auth.mjs --import --profile <receipt-profile-path>
node .agents/skills/test-studi/scripts/sync-studi-qa-codex-auth.mjs --export --profile <receipt-profile-path>
```

For a deliberately refreshed cache replacing a failed profile credential, stop that profile first, then use `--import --force --profile <path>`. Never export or overwrite another running profile's credentials.

The helper validates Pi's OAuth shape; the live app must prove readiness and a provider request. Concurrent copies can still encounter provider-side refresh/revocation behavior. If one fails, preserve its diagnostic and reconnect that profile; do not overwrite every worktree with the failed copy.

## Remote setup

Remote environments may receive `STUDI_QA_CODEX_AUTH` as a secret (raw JSON or base64 Pi auth). Run:

```bash
bash .agents/skills/test-studi/scripts/setup-studi-cloud.sh
```

On Windows, `--export --copy-secret` copies the encoded secret to the clipboard without printing it. Ask the user to update their remote secret only for a first seed or an actual revoked/stale credential. Do not request a new secret for every worktree or access-token refresh.

Do not copy the host Codex CLI store, everyday Studi profile, system-browser cookies, or arbitrary provider credentials. Do not commit `.agents/studi-qa/` or include auth bytes, device codes, or authorize URLs in evidence. A user-visible device-code handoff may show the code to the user; do not retain it as an artifact.

The account helper, school fixture, and cache importer run on Node/Bun environments. The current native launcher is Windows-specific. Cloud hydration is not proof that a live Electron journey ran.
