# Studi UI previews

Run `bun run preview:ui`, then open `http://127.0.0.1:4174/?preview=gallery`.

The gallery renders the real React screens against an in-memory `window.studi` implementation. It does not start Electron, contact Clerk or Convex, use a school account, or write local product data. Native school-browser areas use an obvious local mock because Electron's `WebContentsView` cannot exist in an ordinary browser.

## What is covered

- Private-beta entry
- Every onboarding step, including connected apps, homework folder, scan, handoff, and completion
- Week dashboard and assignment details
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
