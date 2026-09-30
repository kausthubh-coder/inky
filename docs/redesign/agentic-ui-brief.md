# Agentic UI brief

Research checked September 29, 2026. Measurements below distinguish observed reference values from Studi's chosen values. Preserve the paper palette, Dot, grouped tools, floating dock, and native school browser.

## Thread

T3's [MessagesTimeline](https://github.com/pingdotgg/t3code/blob/2a23c30ea60854cb17bec1a9d248032207c5d6b2/apps/web/src/components/chat/MessagesTimeline.tsx) uses a shared chat measure, 80% maximum student bubbles with 12px padding and 16px corners, compact 24px tool rows, 6px icon gaps, 150ms hover transitions, and keyboard-only inset focus rings. Expanded tool history scrolls within `min(288px, 50dvh)`, with 24px estimated rows. Its [CSS](https://github.com/pingdotgg/t3code/blob/2a23c30ea60854cb17bec1a9d248032207c5d6b2/apps/web/src/index.css) offers 48rem, 72rem, and full-width measures.

For Studi, use 68ch text, 1.6 line height, 12px paragraph rhythm, 24px between turns and 12px within a turn. Keep tools collapsed initially, show the current step during work, and indent expanded steps behind a 1px guide. Use red text for failed steps. These are Studi choices informed by T3 and [AI Elements Tool](https://elements.ai-sdk.dev/components/tool), which distinguishes pending, running, approval, completed, and error states. [Reasoning](https://elements.ai-sdk.dev/components/reasoning) consolidates streaming activity; [Task](https://elements.ai-sdk.dev/components/task) separates a summary trigger from optional details. Keep explicit student control over expansion.

## Composer

T3's [ChatComposer](https://github.com/pingdotgg/t3code/blob/2a23c30ea60854cb17bec1a9d248032207c5d6b2/apps/web/src/components/chat/ChatComposer.tsx) places text above a toolbar with 8px gaps, 12px horizontal/bottom padding, increasing to 16px on desktop. [ComposerSurface](https://github.com/pingdotgg/t3code/blob/2a23c30ea60854cb17bec1a9d248032207c5d6b2/apps/web/src/components/chat/ComposerSurface.tsx) uses 24px corners and one continuous backdrop. Pending approvals attach above the main composer in its banner stack; [approval details](https://github.com/pingdotgg/t3code/blob/2a23c30ea60854cb17bec1a9d248032207c5d6b2/apps/web/src/components/chat/ComposerPendingApprovalPanel.tsx) scroll at 80px rather than stretching the dock.

Use one 20px Studi shell, 16px text inset, an 8px toolbar inset, and a 36px Send/Stop control. Join Your move with a single rule. Sending needs visible feedback; disabled controls retain legible labels. Keep the assignment picker keyboard navigable. [Claude desktop](https://code.claude.com/docs/en/desktop) supports steering while running, Stop, attachments, and @ context; questions belong beside the student's next action.

## Work pane (tree, viewers, terminal)

Let the file lead, with its name before quiet actions. Use 32px file rows, a compact tree that folds above the viewer in panes below 560px, and no empty permanent sidebar. Render markdown, text, code, CSV/TSV tables, PDFs, and images in place. Unsupported files get one Open action. [Claude desktop](https://code.claude.com/docs/en/desktop) previews PDFs/images and opens files in other apps; [AI Elements Artifact](https://elements.ai-sdk.dev/components/artifact) pairs generated content with header actions.

Show command, result, duration, and expandable output; keep the terminal collapsible. [Codex desktop](https://openai.com/index/introducing-the-codex-app/) supports reviewing changes within the thread and opening them in an editor. [Cursor review](https://docs.cursor.com/en/agent/review) uses file-by-file review and a floating action bar. Apply that proximity to Studi's requirements summary and files.

## Details

Use four plain facts, status first, quieter evidence beneath, then instructions and sources. Keep prose within 68ch and separate sections by 24px. Preserve messy evidence verbatim; wrapping and hierarchy should do the work. The local [interface-design guide](../../.agents/tmp/skills/interface-design.md) favors one focal point, 14–16px body text, approximately 1.5 line height, and deliberate density.

## Cross-cutting

Use at least 32px desktop targets, 0.96 press scale, keyboard-only 2px focus rings, 150ms named transitions, tabular numbers, pretty body wrapping, balanced headings, and reduced-motion overrides. Follow [make-interfaces-feel-better](../../.agents/tmp/skills/make-interfaces-feel-better.md); the plan's 32px minimum overrides its 40px recommendation. Follow [Impeccable](../../.agents/tmp/skills/impeccable.md) with one inspection round, one correction batch, and one confirmation round. Reference products supply interaction evidence, not permission to import pills, tinted boxes, or extra controls.
