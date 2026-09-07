# Onboarding through a real first scan

Use a new named persistent profile for a fresh journey. Preserve it for restart checks. Build and launch as described in the skill, then attach using the receipt.

1. **Studi login.** Look up/create the dedicated development test account and accept its linked invitation using [clerk-electron-journey.md](clerk-electron-journey.md). Click the current greeting/sign-in control, claim the OAuth handoff in isolated Chromium, and use the email-code flow. Check live `getAuthState()` for approved access.
2. **ChatGPT.** Import the QA Codex cache before launch. Read `getWorkspaceState()`; when provider is ready, continue the connected step. Otherwise follow [codex-login.md](codex-login.md). Never report a provider turn as tested while disconnected.
3. **Connected apps.** Optional integrations may be skipped for the local school journey. Do not authorize personal third-party accounts as routine QA setup.
4. **Homework folder.** Create an empty directory under this worktree's `.agents/studi-qa/`, separate from the Electron profile. Use the real chooser; if native dialog automation is unavailable, [worktrees.md](worktrees.md) documents a one-shot chooser simulation through the QA main inspector. Record that simulation; do not seed the database or overwrite app state.
5. **School URL.** Start the fixture in a retained terminal session:

   ```powershell
   node .agents/skills/test-studi/scripts/school-fixture.mjs
   ```

   Use its returned `schoolUrl`. The server binds a free loopback port; each server owns its own draft state. Keep it running across the app restart. To restart the server for an existing profile, use `--port <previous-port>`. Fixture draft state resets when its server stops.
6. **Preferences.** Explicitly choose manual scanning and **Do it, I'll submit** (`attempt`) when proving assignment work. For a scan-only run, **Don't try it** (`do_not_attempt`) is sufficient. Verify the selected value; a “default” label is not proof of selection. Save the school profile through the UI.
7. **First scan.** Let Pi inspect the fixture's dashboard, course, and assignment. Wait for a completed scan with coverage and the actual **Observation paragraph** assignment. Compare title, course, due date, and instructions against the fixture: a green scan status alone can hide missing fields. An empty or partial scan is a failure; capture its error instead of inserting tasks.
8. **Work.** Follow [feature-pass.md](feature-pass.md) to prove a real reply, assignment reference, browser handoff, and saved draft. The fixture's `/health` reports `answerSaved` and `submitted` without returning answer content.
9. **Restart.** Stop and relaunch the same profile. Verify approved admission, provider readiness, and the scanned assignment are retained.

The fixture is deliberately small, with one course and one assignment. It enables the minimum real browser/scan/work journey; it is not the broad LMS benchmark, third-party LMS compatibility proof, or a replacement for multi-page/multi-course tests.
