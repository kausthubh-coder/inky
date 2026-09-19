# Studi 0.2.0 candidate

The accepted PR #38 design is implemented in the actual app: Today, assignment
review, one contextual conversation, Learn, and fixed tutor components. Claude
subscription support comes from #36, with selected provider UI from #37. Existing
Markdown rendering already covers #32; #33 is an overlapping alternative.

New behavior includes source-backed study planning, resumable tutor sessions,
editable personal memories, homework corrections and ownership, scoped rules,
scheduled work, and isolated JavaScript tutor exercises. New installations and
scan benchmarks default to GPT-5.6 Sol/high at normal speed. Existing saved model
selections are preserved.

Test Studi supports focused scopes as well as the full release pass, bounded
workers, durable receipts, reusable QA identities and leased disposable signup
accounts. The synthetic LMS now includes quizzes, multi-file coding, syllabus
changes, access recovery and independent outcome evaluation. Docker compilation
is optional and remains unproven until its isolated runner executes.

## Verification in progress

The integrated controlled pass built/typechecked both app and LMS. Its four Node
failures were three outdated transition expectations and one real Learn tool-order
mismatch. Focused rechecks passed after correction. Backend, scripted harnesses
and native material checks passed. The source-mode Electron check and the full
live provider journeys are still being resolved; they are not release proof yet.

The renderer handoff includes actual-component visual/interaction evidence under
`tests/ui/evidence/pr38/renderer-handoff.md`. Preview evidence is separate from
native and live evidence. Native installer checks use disposable CI machines.

Do not publish until the required receipts and artifact hashes pass the release
gate described in [the promotion guide](../README.md). No `evidence.json` is
provided until those checks have actually succeeded.

Known UI coverage limits: native file selection is supported; drag-and-drop is
not implemented. Assignment receipts show recorded checkpoint summaries.
Historical school-check links open the current check. “Do this next” currently
reorders homework already in the queue. File previews and action history are
available; a dedicated command-output panel is not yet implemented.
