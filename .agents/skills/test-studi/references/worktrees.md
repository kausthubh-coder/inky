# Concurrent worktrees and native boundaries

## Ownership

### Limited-memory Windows machines

Keep testing sequential on the user's PC. Before a build, test suite or Electron launch, inspect available RAM (`Get-CimInstance Win32_OperatingSystem`) and the QA processes owned by this task. Run one heavy build/test job at a time and at most one Studi QA app with its required fixture. Stop your own idle preview/fixture servers and QA app when finished; preserve profiles and worktrees for reuse. Do not close the user's browser, installed Studi, Codex or another task's processes to make room.

When available RAM is already low or the machine is paging heavily, continue lightweight code review/edits and defer the heavy run until there is headroom. Recheck after cleanup and between stages; if a required check remains blocked, report it accurately. A worktree mostly consumes disk while idle: reuse existing worktrees and dependencies, and avoid starting apps or dependency installs in each one. In manager-led work, one owner holds the test slot; the others remain idle until handed that slot explicitly.

Run `Setup-StudiWorktree.ps1` inside the checkout to install with Bun, import an available QA Codex cache, and build. It never copies an Electron profile. Managed worktrees receive `.env.local` and the QA cache through `.worktreeinclude`; manually created worktrees can read the primary checkout's QA cache through the sync helper. Never share the writable `auth.json` file itself between running apps.

The launcher derives paths from its own checkout, uses a stable suggested test email per worktree/profile, and allocates CDP, Clerk relay, and main inspector ports. A profile launch lock prevents concurrent initialization; a running-profile check rejects duplicate use. Different names in the same checkout provide independent journeys.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/skills/test-studi/scripts/Start-StudiQa.ps1 -Persistent -ProfileName chat -ImportCodexAuth
```

Use a distinct dedicated Clerk identity for each simultaneously running profile. Sharing a subject can conflict with the backend device lease even when local ports and files are separate. Reuse one profile for sequential testing.

Unpackaged QA already coexists with the installed app. Do not quit another app, reuse another task's debug port, or change global MCP configuration. The built renderer uses file URLs, so it needs no shared Vite server. UI previews can run independently with `bun run preview:ui -- --port <free-port>`; verify the actual Vite command accepts the override. Preview proof is separate from native proof.

## Attach to the actual receipt

The installed Electron MCP may be pinned to 9222. If that endpoint does not match this receipt, use the official generic Playwright MCP's `browser_run_code_unsafe` and connect dynamically:

```js
async (page) => {
  const browser = await page.context().browser().browserType()
    .connectOverCDP('http://127.0.0.1:<receipt-port>');
  const renderer = browser.contexts().flatMap(c => c.pages())
    .find(p => p.url() === 'file:///C:/<exact-checkout>/dist/client/index.html');
  if (!renderer) throw new Error('This is not the requested checkout');
  return renderer.evaluate(() => window.studi.getAuthState());
}
```

Keep that renderer separate from the generic browser page. Read `renderer.locator('body').ariaSnapshot()` before choosing controls: visible text can differ from the accessible name (the “studi” logo is **Open dashboard**). Use a new isolated generic browser context for Clerk. Do not change a MCP endpoint globally while another task uses it, and do not attach to Pi's guest pane.

CDP readiness is not runtime readiness. The launcher verifies the listening process owns the CDP port. Then check the renderer URL and public runtime state. Read states separately or with settled promises: a workspace call may fail while auth is still denied.

## Native folder chooser

Playwright's file-upload control does not operate Electron's directory picker. Prefer genuine native dialog automation when available. For unattended desktop-flow testing:

```powershell
node .agents/skills/test-studi/scripts/select-qa-folder.mjs chat
```

This checks the receipt/worktree/profile, creates an empty QA homework folder, and uses the loopback main inspector to simulate **only the next directory-choice result**. Then click **Choose an empty folder** through Playwright; the real IPC, empty-folder validation, workspace initialization, and storage still run. The original dialog method is restored on the next call.

Report the native chooser as simulated. This is not proof that the OS dialog works. Do not use the inspector to change auth, entitlement, onboarding, assignments, provider state, or scan outcomes.

## Stop and restart

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/skills/test-studi/scripts/Stop-StudiQa.ps1 -ProfileName chat
```

The stop helper checks the recorded process paths and creation time, asks Electron to quit through its own main inspector (disabling close-to-tray handlers for that exit), waits for it to stop, then stops only its Clerk relay. Profile data remains. It leaves the receipt on failure rather than killing an unrelated/reused PID. Never use blanket `taskkill /IM electron.exe`.

Relaunch with the same profile name, read its new endpoints, and verify persistence. `-DryRun` on start/stop is read-only; the reset option does not override a running profile's ownership check.

A failed launch terminates its own Electron/relay processes. If a port is occupied, choose another port or let the default allocator choose; never stop the port's unknown owner.

The launcher also watches its Electron process. On exit it writes a credential-free `<receipt>.exit-<pid>.json` with the exit code and timestamp and cleans up that run's relay. Inspect it if CDP disappears; an unexpected exit during work is a failed live check even when the profile can reopen.

## Limits

The PowerShell launcher currently targets Windows Electron. Account helpers, the school fixture, and non-native tests are portable. On Linux CI, a live Electron journey additionally needs a display and a platform-appropriate launcher; do not claim that Windows launch verification covers Linux or native macOS.
