# Studi 0.2.0 candidate

The candidate implements PR #38's Today, assignment review, contextual conversation,
Learn, and fixed tutor components in the actual app. Remaining scope is listed
below; this is not a claim that all of #38 is complete. Claude
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

App and LMS typechecks/builds, backend, scripted harnesses and native material
checks passed. Focused checks passed for the corrected Learn ordering, shell
timeout units, sign-in actions and desktop layouts. Live Clerk admission, renewed
ChatGPT authorization, real smoke scan, home chat and restart persistence passed.
Tutor produced a real first exercise; complete tutoring remains pending. Live
homework Start was blocked by automatic approval review; Claude is not connected.

CI 35456369848 at 64ec94b still failed: macOS packaged renderer/preload first
launch passed, but disk-image cleanup remained busy after process-group shutdown.
Windows passed 424 of 425 Node tests plus the native checks; the assignment shell
write command timed out even with a 60-second allowance. Cold startup alone does
not explain that failure. Both runner failures require diagnosis and fresh proof.

“Do this next” now queues discovered/failed homework at the front, retains the
current browser lease, and records an explicit start request. The kernel starts
that request when the browser is free even in manual mode, without enabling
automatic work. Controlled tests cover duplicate requests, permission rejection,
restart persistence, UI interaction, browser contention and manual-mode isolation.

The renderer handoff includes actual-component visual/interaction evidence under
`tests/ui/evidence/pr38/renderer-handoff.md`. Preview evidence is separate from
native and live evidence. Native installer checks use disposable CI machines.

Do not publish until the required receipts and artifact hashes pass the release
gate described in [the promotion guide](../README.md). No `evidence.json` is
provided until those checks have actually succeeded.

Known UI coverage limits: native file selection is supported; drag-and-drop is
not implemented. Assignment receipts show recorded checkpoint summaries.
Historical school-check links open the current check. File previews and action history are
available. The Files panel now retains bounded shell results, including failed
commands, with controlled storage and rendered-interaction evidence; live command
execution in that panel remains unverified.
