# Review before calling a change ready

Review the final diff and the evidence, not just whether the implementation follows the initial plan. Apply this to the changed behavior and nearby dependencies; an ordinary fix is not permission to rewrite or audit the entire repository.

## Common failures first

Prioritize observed failures, likely student behavior, and serious data/permission/account risks. Scan versus assignment contention, login expiration, repeated clicks, interrupted work, navigation away, draft retention and restart are useful candidates when the feature touches them. Do not turn this into a universal matrix or a hunt for unlikely combinations. A serious isolation or data-loss issue still matters even if uncommon.

For a larger architecture gap, a small honest UI fix can be the right first delivery: name the blocking work, offer a supported next action, and preserve saved progress. Do not remove an ownership check to make the button appear to work, hide duplicate data, or label “wait” as an automatic queue without implementing one. Record the deeper dependency separately.

## Self-explanatory UI

Check whether the next action is visible, labels describe outcomes, status matches actual progress, and errors explain recovery. Use sensible defaults, recognition over raw IDs, progressive disclosure for advanced options, and distinct emphasis for primary versus secondary actions. Show why an action is unavailable. Preserve user input on failures. Use Inky's voice naturally without substituting personality for clarity. Avoid extra cards, confirmations or explanatory paragraphs when the interaction can communicate the same thing directly.

## High-value code

- Prefer one understandable source of truth and a short direct data/action flow. Check whether new state duplicates derived/backend state or creates another owner that can disagree.
- Reuse existing boundaries when they fit. Remove dead code made obsolete by the change. Question pass-through wrappers, one-use generic frameworks, speculative options, repetitive checks and helpers whose abstraction costs more than they explain.
- Small code is a result of clear design, not a line-count target. Do not compress readable code into dense one-liners, remove useful types or delete meaningful validation/tests to appear concise.
- Trace asynchronous success, failure and cancellation to the visible result. Look for swallowed errors, unhandled promises, stale cached settings, lost work, effects on the wrong activity and guards enforced only in the UI.
- Keep temporary probes/fixtures out of production behavior. Remove debug logging, duplicated comments that narrate the code and abandoned paths. Preserve unrelated user changes.
- Review tests for what they prove. Favor the original bug reproduction and observable invariants. Avoid assertions tied to source text, incidental markup or private implementation steps unless that exact boundary is the contract. A pure label/icon edit may need visual interaction verification and no new automated test.

## Completion and manager handoff

For a bug, retain a minimal failing reproduction when practical and show the corrected outcome. For a feature, exercise its main path and relevant failure/recovery. Run the appropriate build/typecheck and focused checks, then inspect the final diff for correctness, maintainability and UI behavior. Fix actionable findings within scope and rerun only invalidated checks. Document material pre-existing findings separately.

Implementation owners send the manager the commit/revision, changed boundaries, expected versus observed results, concise evidence locations and untested limits. The manager reviews the diff and evidence, sends actionable findings back, and performs an integrated affected-flow pass when combining changes. Independent review is valuable for cross-cutting, permission, identity or concurrency work; a second task is not required for every cosmetic edit. Do not mark a task ready merely because it compiled, another agent said it passed, or its time budget ended.

Verification does not itself authorize merging, publishing, real schoolwork submission or messages to external recipients. Respect the task's existing authorization; do not introduce a new approval round for routine fixes already requested.
