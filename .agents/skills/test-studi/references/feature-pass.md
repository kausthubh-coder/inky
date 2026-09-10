# Feature pass

Use the current build and a named persistent profile. Follow [worktrees.md](worktrees.md) to attach to its actual endpoint. Read `getAuthState()`, `getWorkspaceState()`, `getSchoolOnboardingState()`, `getLifecycleState()`, and `getLibraryState()` through `window.studi`.

If signed out, restore the dedicated identity via [clerk-electron-journey.md](clerk-electron-journey.md). If onboarding is incomplete, finish [onboarding-pass.md](onboarding-pass.md); do not seed assignments or mark a scan successful.

Online end-to-end proof requires `auth.status=approved`; an offline session proves only cached UI behavior. Agent turns require provider `ready`.

## Relevant feature checks

Use current accessible controls rather than stale screen names. Select relevant checks below; [focused-passes.md](focused-passes.md) covers UI, agents and system changes without forcing the entire journey.

1. Send a short read-only message and wait for a real response. Check error surfaces and draft retention, not just whether the input cleared.
2. Attach a scanned fixture assignment with `@`; verify the selected reference, send it, and confirm the reply uses that assignment.
3. While a reply is pending, type another draft. Stop the current reply and verify the new draft survives. Exercise retry after a real or explicitly controlled failure.
4. Open expanded chat and collapse it. Check history, references, scroll position, and draft. Switch weeks, return to this week, and open the discovered assignment.
5. On the local fixture only, verify the stored permission allows `attempt`, then ask Inky to complete the observation paragraph and save a draft without submitting. If the scan-only profile used `do_not_attempt`, use **Settings → School → Homework rules** to add **Try it, don’t submit** for the fixture's course or assignment. Observe task transitions and browser activity, take over and hand back if relevant, then verify the saved draft and completion state. Do not type the answer into the guest yourself as proof that Pi succeeded.
6. Open Settings, Library, and the relevant work/artifact view. Verify required files actually exist within the dedicated homework folder.
7. For update changes, verify busy/restart rules and error recovery separately. An extracted app smoke test does not prove installed auto-updating.
8. Restart the same profile using the stop/start helpers. Recheck approved access, provider readiness, onboarding, chat history, draft, and assignment state.

For unrelated changes choose the relevant subset. Use [full-app-pass.md](full-app-pass.md) for broad changes and integrated release verification. Include common competing-activity/restart behavior when ownership or scheduling changes. A successful preview or mocked Electron self-test does not prove a live chat, scan, browser handoff, or provider request.
