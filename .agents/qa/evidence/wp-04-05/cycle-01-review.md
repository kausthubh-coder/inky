# WP-04 + WP-05 cycle 01 quality review

Status: **approved**

## Judgment

The live path before restart is strong evidence that the package's central design works. One Pi `AgentSession` used the real `openai-codex` provider and the eight Studi tools to inspect an authenticated Moodle page in the same visible `WebContentsView`. The controller owns refs and revisions, the tool layer maps directly onto controller operations, and submission has a separate confirmed path. That control flow is small and easy to trace.

The package cannot pass yet because the approved restart behavior failed.

## Likely cause

The failure points to the renderer selection branch in `electron/main.ts`, through `electron/development-url.ts`, rather than the school browser profile.

The built `dist/client/index.html` and its current bundle contain the WP-04 + WP-05 sidebar. `createSchoolBrowser` also gives the child view fixed bounds starting at `x: 396`, so that view cannot normally hide the whole sidebar. By contrast, `loadRenderer` replaces the BrowserWindow document with `VITE_DEV_SERVER_URL` whenever the process inherits both `STUDI_DEVELOPMENT_MODE=1` and that URL. The helper proves only that the target is credential-free localhost. It does not prove that the server belongs to this Studi run. A stale or unrelated process on that port therefore explains the observed older Studi page filling the window after a direct `electron .` relaunch.

This is also consistent with the title remaining Studi-branded while the new sidebar disappeared. The failure is not evidence that the `persist:studi-school` cookies or Pi's file-backed Codex auth were lost. The tester could not reach the controls needed to verify either one.

`createSchoolBrowser` intentionally loads `about:blank` on startup, so this package does not restore the last Moodle URL. The approved dossier requires the login and provider to remain usable, not automatic return to the last page. Do not add URL persistence as part of this repair.

## Smallest repair brief

Make development renderer selection explicit per launch instead of ambient.

1. Let the development command pass one dedicated Electron command-line switch for the local renderer URL.
2. Have `getDevelopmentUrl` accept that switch only for an unpackaged app, retain the current localhost and credential checks, and return no URL when the switch is absent.
3. Remove the two inherited environment variables as authority for renderer selection. A direct `electron .` relaunch must always load `dist/client/index.html`.
4. Repeat the exact live restart path. Confirm the sidebar returns, Codex reports ready, then reopen the Moodle URL and verify the persistent school profile enters the authenticated course without another sign-in.

This keeps one renderer source decision and does not add a recovery layer, URL store, or second browser state owner.

## Quality rating

- Elegance: **8.5/10**. The browser controller and Pi tool mapping are direct and restrained. Renderer selection is now explicit per launch.
- Traceability: **8.5/10**. Browser state enters through one controller, tool calls map one-to-one, and evidence is returned after actions. Startup now chooses its renderer deterministically.
- Maintainability: **8.5/10**. The current modules have clear ownership and little abstraction overhead. The focused startup repair closed the restart ambiguity without broadening the design.

Overall: **8.5/10**. Good implementation, approved after the focused startup repair.

I did not rerun tests or inspect unrelated packages.

## Final disposition after startup repair

The direct relaunch repair passed. Studi returned and Codex remained connected.

The remaining Shibboleth redirect after a full Electron quit is not a WP-04 + WP-05 blocker. `persist:studi-school` gives Chromium a durable profile, but a session-scoped Moodle or Shibboleth cookie still ends with the browser process by design. Manually adding an expiry would turn an identity-provider session cookie into a longer-lived local credential, override the provider's lifetime policy, and still fail when the server-side session expires. Do not add that behavior.

WP-08 owns the normal lifecycle. Closing the window must keep the Electron process and school session alive in the tray until the user explicitly quits. Verify the authenticated course survives that window-close and reopen path there. Record full explicit quit and relaunch as a supported reauthentication boundary unless a later approved requirement calls for a provider-respecting recovery flow.
