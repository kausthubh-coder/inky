# Tier 3: desktop pass

Exercise the changed feature in the real app on an onboarded QA profile. Use this for anything the preview cannot prove: IPC, the school pane, native dialogs, notifications, provider sign-in, updates, competing activity and restart.

## Setup

1. Build once: `bun run build`. Skip `vite build` and use `bun run build:electron` when only `desktop/electron` or `desktop/shared` changed and the renderer bundle is current.
2. Launch the profile:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .agents/skills/test-studi/scripts/Start-StudiQa.ps1 -Persistent -ProfileName <name> -ImportCodexAuth
   ```

   Read the receipt in `.agents/studi-qa/runs/<name>.json`: `profilePath`, `testEmail`, `cdpEndpoint`, `clerkClaimUrl`, `mainInspectorEndpoint`, `buildTreeSha256`. Never assume a port. Attach Playwright to `cdpEndpoint` as shown in [worktrees.md](worktrees.md) and confirm the renderer URL belongs to this checkout.

   Without a Playwright client, `node .agents/skills/test-studi/scripts/studi-eval.mjs <name> "<expression>" [--screenshot <path>]` evaluates an expression in this checkout's renderer over that endpoint and can save a PNG. Expressions may await `window.studi` calls and click buttons; use it for state reads and simple flows, and Playwright when you need real input events.

   The shell that launched this session may set `ELECTRON_RUN_AS_NODE`; unset it before launching Electron or the app exits at once.
3. Read `window.studi.getAuthState()`, `getWorkspaceState()`, `getSchoolOnboardingState()`, `getLifecycleState()` and `getLibraryState()`. Online proof needs `auth.status` approved; an offline session proves only cached UI. Agent turns need the selected provider `ready`.
4. If signed out, restore the dedicated identity with [clerk-electron-journey.md](clerk-electron-journey.md). If the provider is not ready, follow [provider-login.md](provider-login.md). If onboarding is incomplete, finish [onboarding-pass.md](onboarding-pass.md) once and keep the profile; do not seed assignments or mark a scan successful.
5. Start the fake school when the feature reads or writes schoolwork:

   ```powershell
   node .agents/skills/test-studi/scripts/school-fixture.mjs
   ```

   Keep it running across the app restart. Reuse `--port <previous>` when relaunching for an existing profile.

## Checks

Pick the ones the change can affect. Use current accessible controls, not remembered screen names.

1. Send a short read-only message and wait for a real reply. Check error surfaces and draft retention, not just that the input cleared.
2. Attach a scanned assignment with `@`, send, and confirm the reply uses it.
3. While a reply is pending, type another draft, stop the reply, and confirm the new draft survives. Exercise retry after a real or controlled failure.
4. Open and collapse expanded chat; switch weeks and return; open the discovered assignment. Check history, references, scroll position and draft.
5. On the fake school only, with a rule that allows `attempt`, ask Inky to complete the fixture assignment and save a draft without submitting. Observe task transitions and browser activity, take over and hand back, then inspect the saved draft and completion state. Do not type the answer yourself as proof.
6. Open Settings, Library and the work or artifact view. Confirm required files exist inside the dedicated homework folder.
7. For provider changes, connect and disconnect each subscription card, complete a sign-in through the page that opens, and confirm the selected subscription is the one a new chat uses.
8. For update changes, verify busy and restart rules and error recovery separately. A smoke test of an extracted app is not proof of installed auto-update.
9. Restart the same profile with `Stop-StudiQa.ps1 -ProfileName <name>` and a fresh launch. Recheck approval, provider readiness, onboarding, chat history, drafts and assignment state.

Include competing-activity and restart behavior whenever ownership, scheduling or persistence changed. Use [full-app-pass.md](full-app-pass.md) for onboarding, admission or release-candidate changes instead of stretching this tier.
