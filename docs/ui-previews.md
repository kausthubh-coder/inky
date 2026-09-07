# Studi UI previews

Run `bun run preview:ui` and open the gallery URL printed in the terminal. It starts at port 4174 and chooses the next free port when another worktree is using it. Node runs the Vite helper because Bun 1.3.14 on Windows can leave Vite’s listen promise pending after a port collision; the user-facing commands still use Bun.

Run `bun run preview:desktop` to open the same screens in an isolated Electron window with the real native title bar. This builds Electron helpers, starts its own local Vite server, and opens a fixture week. Closing the preview window stops that server. Its profile is `.agents/studi-qa/ui-preview`; it never reads the real app profile or connects to Clerk, Convex, or school. The native CDP endpoint is loopback-only and printed at launch.

For the real app, `bun run test:qa` builds and opens the dedicated QA profile. An existing QA profile in the main Git checkout is reused in a fresh worktree. A signed-out profile still requires real sign-in; preview fixtures do not bypass that gate.

The gallery renders the real React screens against an in-memory `window.studi` implementation. It does not start Electron, contact Clerk or Convex, use a school account, or write local product data. Native school-browser areas use an obvious local mock because Electron's `WebContentsView` cannot exist in an ordinary browser.

## What is covered

- Private-beta entry
- Every onboarding step, including connected apps, homework folder, scan, handoff, and completion
- Week dashboard, a separate Without dates view, and assignment details
- Working, needs-student, review, and submitted desk states
- Every Settings section

Each card opens a full-size route such as `/?preview=desk-review`. Query routes are stable, so they can be bookmarked or used by browser automation.

## Add or change a scenario

1. Add the route metadata and initial view to `desktop/src/app/devPreview.ts`.
2. Shape the mock onboarding, lifecycle, task, or connection state in `installDevPreview()`.
3. Use the existing production component. Do not fork a preview-only copy of a screen.
4. Add preview-only native-surface content to `PreviewSchoolPage.tsx` only when the missing surface belongs to Electron rather than React.
5. Check the gallery, the full-size route, `bun run typecheck`, and the relevant Electron pass.

The preview is the fast visual loop. Electron remains the release check for preload contracts, IPC, window layout, native school-browser placement, OAuth handoff, persistence, and notifications.

## Interaction checks

Use Microsoft’s official Playwright MCP. Enable `--caps devtools` for `browser_run_code_unsafe` on current versions; older MCP versions expose `browser_run_code`. `tests/ui/chat-preview.journey.mjs` covers chat, week navigation, drafts, and updates. `tests/ui/workspace-preview.journey.mjs` covers undated work, settings search/save, all settings sections, and the gallery at desktop and minimum window sizes. These are browser journeys, separate from `bun run test:ui` calendar unit tests.

The desktop preview additionally allows checking native overlay geometry, dragging, minimize, maximize/restore, and close. School-browser regions remain explicitly mocked.
