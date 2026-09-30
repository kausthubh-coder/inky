# Checkpoint 7 — Screen polish from the audit

Status: **PASS.** Every item in build-plan section 10 is fixed or confirmed already fixed. The dead CSS is gone, and no preview scenario logs a console error.

## Gate

| Criterion | Result | Evidence |
|---|---|---|
| Every audit item fixed, with a before/after pair | **Pass**, table below | `.agents/audit/cp07-pairs/` |
| `redesign.css` smaller | **Pass**: 50,069 → 44,154 bytes. All CSS: 195,805 → 156,392 bytes, 739 lines removed | `wc -c desktop/src/app/*.css` |
| No console errors in any preview scenario | **Pass**: 67 scenarios, 0 errors, logged by a Playwright console listener | `.agents/audit/cp07-pruned/console-errors.json` |

## Audit items

| Screen | Problem | Result |
|---|---|---|
| assignment (not started, restricted) | Inky shown twice, with two headlines | **Fixed.** The summary's own Inky and "Ready when you are." are removed; the view header keeps one Inky |
| assignment-stopped | "I got stuck." after the student cancelled | Already fixed before this checkpoint ("You stopped this. Your saved work is kept.") |
| desk-submitted | "Handed in." repeated; a second back button | **Fixed.** The side panel's "Back to Today" is removed (the header has "Back to your week"). The receipt reads "The school page says “Submitted” · Sep 3, 12:00 PM" instead of a raw timestamp |
| assignment-saved | "Open saved work ↗" glyph link | Already fixed (quiet button) |
| desk-review | Confusing disabled check button | Not present any more. **New bug fixed:** with doubts it promised "Submits automatically at…", but doubts block the rule. It now says "I won’t hand this in on my own until you’ve looked at these." |
| chat-handoff | Focus box around the composer icon | No change needed. It is the `:focus-visible` keyboard ring, shown in the preview because focus moves before any pointer input. It doesn't appear on mouse use |
| Today | "0 more specific" and "Later 0" | **Fixed.** Zero counts are hidden |
| Week | Today's date in a yellow oval | **Fixed.** Bold date with a small dot |
| School check | Mockup B; underlined buttons | Layout already matched mockup B. **Fixed:** the underlined `quiet-button` style is gone app-wide (6 uses moved to `rd-quiet`). The browser-busy panel now has one lead action, "Open assignment", with the others quiet |
| Settings | Mockup G | Done in the Settings checkpoint |
| Tutor | Native blue slider in the population model | **Fixed.** It uses the shared `rd-slider` pencil style |
| Updates modal | Underlined "Later" | **Fixed.** Quiet button |
| Onboarding | Keep as is | Unchanged |

## Dead CSS

`.agents/audit/prune-css.mjs` parses each stylesheet with postcss. It drops a selector only when it names a class that nothing in `desktop/` or `landing/lib` mentions; runtime prefixes such as `progress-` + tone are kept. `homework-rules.css` was unused and is deleted. `chat-markdown.css` is kept whole because the Markdown library adds its classes at runtime.

Verification: all 67 scenarios were captured before and after pruning and compared pixel by pixel (`.agents/audit/diff.mjs`).
- The first attempt changed Inky: its SVG class names live in `landing/lib/inky.ts`, outside the scanned folder. That attempt was reverted and the scan widened.
- The final run differs only by Inky's animation phase and the chat previews' live clock. Restoring every original stylesheet reproduces the same chat difference, which confirms it isn't from CSS.

## Commands

```text
$ bun run typecheck && bun run build     ok
$ bun run test:ui                        ℹ pass 23 ℹ fail 0   (twice; one earlier run had a timing flake in connected-app-polling, which passes alone)
$ node --test "tests/contracts/*.test.mjs"   ℹ pass 76 ℹ fail 0
$ node --test --test-concurrency=1 tests/e2e/*.test.mjs   ℹ pass 8 ℹ fail 0
$ node .agents/audit/capture.mjs .agents/audit/cp07-pruned   67 screens, 0 with console errors
```

## Not done

- The stacked "audit fix" override blocks in `redesign.css` were not folded into their base rules by hand. Only unused rules were removed.
- Today can say "Nothing needs you." while items are overdue and not started. This is left for a product decision, since the preview data is dated in the past.
