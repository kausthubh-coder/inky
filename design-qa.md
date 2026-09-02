# Fable UI design QA

- Source visual truth: `C:\Users\kaust\OneDrive\Documents\dev\studi-2\.agents\qa\evidence\fable-source\`
- Implementation captures: `C:\Users\kaust\OneDrive\Documents\dev\studi-2\.agents\qa\evidence\fable-implementation\`
- Viewport: 1440 × 1000 CSS px at Windows device scale 1.25.
- Source pixels: 1440 × 1000. Implementation pixels: 1800 × 1250, normalized to 1440 × 1000 before comparison.
- Compared states: reference week board vs truthful partial week board; reference Settings A vs live settings projection; reference onboarding welcome vs the rebuilt onboarding welcome.
- Full-view comparison evidence: `week-board-comparison.png`, `settings-comparison.png`, `onboarding-comparison.png`.
- Focused regions: not needed for this pass; typography, controls, cards, and mascot remain readable in the full-size captures.

## Findings

- The week board now matches the reference composition, typography, paper texture, compact card language, course colors, and command bar. The implementation adds a visible partial-scan banner because the captured live state is intentionally partial; this is expected truthful product behavior.
- Settings keeps Studi's real policy controls and therefore does not copy the static mock's exact control grouping. Its two-column hierarchy, sketchbook shell, typography, borders, and interaction density are consistent with the source. This deviation is accepted because removing the production controls would reduce current functionality.
- Inky uses the source geometry and nine-state animation rig. Product state selects the expression; there is no parallel mascot state machine.
- The onboarding welcome now matches the source composition directly: inset sketchbook window, compact titlebar, centered 200px Inky, one speech bubble, and one reply. Later decisions reuse the source chips and pick cards; the real school browser appears only at the sign-in handoff.

## Comparison history

1. Initial comparison found the previous renderer had no shared Inky rig and showed the browser throughout onboarding.
2. Implemented the source Inky asset once, mapped it to real auth/scan/execution states, and hid the embedded browser until a school profile exists.
3. The first rebuild still showed the old multi-card onboarding structure. Replaced it with the source's nine-step conversation and captured the exact welcome state at the same logical viewport.
4. Side-by-side comparison shows matching layout, hierarchy, typography, paper texture, mascot, bubble anatomy, and reply placement. Dynamic account names are the expected content difference.

## Primary interactions checked

- Electron preload contract and the source-shaped browser handoff were observed by the real self-test.
- Focus moved to an interactive control.
- No school password field exists in the renderer.
- Week and Settings navigation rendered through the production IPC projection.
- Build, protected Sites output, clean-room boundary, and Electron lifecycle smoke passed.

## Console/runtime errors

No renderer or Electron self-test failure was reported. The only runtime notice is Node's existing experimental SQLite warning.

## Follow-up polish

- The source includes a prototype-only bottom design switcher; the production app intentionally omits it.

final result: passed
