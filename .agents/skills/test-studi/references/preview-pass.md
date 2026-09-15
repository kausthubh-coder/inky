# Tier 1: preview pass

The preview renders the production React screens against an in-memory `window.studi` with fixture state. It needs no build, no Electron, no Clerk, no provider and no school. Use it for every renderer change and for visual review of any tier.

## Start

```powershell
bun run preview:ui -- --no-open
```

Read the URL it prints; the port moves when another worktree is previewing. `/?preview=gallery` lists every scenario. Full-size routes are `/?preview=<id>`; the ids live in `desktop/src/preview/scenarios.ts` and the fixtures in `desktop/src/preview/fixtures.ts`. `docs/ui-previews.md` explains how to add a state.

Drive it with the Playwright MCP or the host's browser preview tools. Wait for `[data-studi-app-ready]` before reading the page.

## Journeys

`../journeys/*.journey.mjs` are reusable scripted walks through one surface each. Every file exports one or more `verify*(page, base)` functions that throw on the first failed assertion. Run one through Playwright's code runner:

```js
async (page) => {
  const { verifyChatPreview } = await import("file:///C:/<checkout>/.agents/skills/test-studi/journeys/chat-preview.journey.mjs");
  await verifyChatPreview(page, "http://127.0.0.1:<port>");
}
```

Read the journey before running it; it states which fixture and which controls it expects. Update a journey when the UI it walks changed deliberately. Do not add a journey for a state a screenshot already covers.

## What to check

- Screenshots at a normal desktop size and a narrow supported size, compared before and after at the same viewport. Look at hierarchy, labels, contrast, clipping, focus visibility and reduced motion when affected. A passing locator does not establish visual quality.
- Perform the task through visible controls. Can someone tell where to start, what Inky is doing, whether it needs them, and what to do next without explanation?
- The states this feature can actually reach: empty, loading, success, failed with retry, needs-user, unavailable, busy. Test the likely transition, not every combination. Check no-op clicks, double starts, lost drafts, stuck disabled buttons and contradictory messages.
- Keyboard activation, focus after dialogs open and close, accessible names.
- `bun run test:ui` for renderer logic that has unit tests.

## Limits

The preview proves presentation and interaction. It does not prove Electron IPC, the native school pane, native focus, dialogs, notifications, provider sign-in or persistence. Those need [desktop-pass.md](desktop-pass.md). `bun run preview:desktop` shows the same screens in an isolated Electron window for native title-bar checks only.
