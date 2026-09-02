# Studi versus `/school` workflow comparison

Date: 2026-09-02  
Status: final signed-in Moodle run pending

## Comparison boundary

This compares observable outcomes and intervention costs, not model prose or hidden tool traces. The `/school` baseline comes from `.agents/qa/evidence/final/school-baseline.md` and the named existing Codex tasks. Studi evidence comes from the packaged normal-user run, deterministic receipts, current source, and focused live regressions. No real coursework was submitted for this comparison.

| Outcome | Existing `/school` tasks | Packaged Studi through current evidence | Current disposition |
| --- | --- | --- | --- |
| Start from an authenticated provider | The user opens a Codex task already attached to their subscription and project context. | Dedicated Clerk account restores approved beta/100 credits, then Pi restores the user's Codex subscription through device authorization. | Studi adds setup, but the resulting provider is real and restart-stable. |
| Enter the school safely | Tasks use the user's existing browser/project automation and can ask for login. | One persistent visible school browser owns cookies; passwords never enter React. Current run truthfully paused at expired Unity ID + Duo. | Equivalent handoff semantics; persistent signed-in continuation still needs final proof. |
| Discover courses and assignments | Existing tasks show strong Moodle/WolfWare and linked-system traversal, but behavior is distributed across task prompts and memory. | One general browser layer plus scan recording tools; current-snapshot facts only, no seeded data, successful workflow replay, assignment-to-task projection. | Architecture is more coherent; full signed-in live coverage is pending. |
| Decide what may run | Corrections in the baseline show occasional drift around what to do or submit. | Stored global/course/pattern/assignment rules resolve before queueing, exact start, and submission. Fresh profiles visibly default to do-not-attempt. | Studi has the stronger explicit control boundary. |
| Preserve queue and selection | Work is coordinated across separate Codex tasks and user prompts. | One durable deadline/priority queue, exact selected-task start, one visible-browser lease, restart reconciliation. | Studi removes fragmented ownership in the tested local runtime. |
| Preserve answers and recover | Existing tasks can save Markdown and use project memory, but closure and ownership vary by task. | Review keeps the live page; deadline/restart writes Markdown before releasing the lease; task events and artifacts remain local. | Studi has a repeatable recovery contract; final real assignment exercise is pending. |
| Submit safely | Existing tasks have had submission ambiguity and user corrections. | `attempt` never submits; auto-submit re-resolves permission, uniquely rebinds a fresh control, proves confirmation changed, and records one receipt. | Studi has a stronger policy/effect boundary; no real LMS submission was performed. |
| Remember preferences | `/school` tasks have useful durable memory but baseline reports stale-memory closure and distributed ownership. | Preferences are always supplied; scoped Markdown memories obey visibility; school/workflow/task state stays in typed SQLite + artifacts. | Studi centralizes ownership; live learned-course-rule quality is not yet compared. |
| Explain current truth | Codex tasks expose conversational status but the user must often reconcile multiple tasks. | Dashboard, desk, library, handoffs, failures, evidence, saved answers, and diagnostics project one local state. | Studi offers the clearer single-product surface in UI tests. |

## Material capability gaps still open

1. The final packaged build must resume after Unity ID + Duo and prove current course/assignment discovery on the canonical Moodle dashboard.
2. Any linked third-party system found must remain an explicit sign-in handoff until verified; the final run must record what was actually reached.
3. One safest discovered assignment should exercise the queue-to-desk path without submitting. If no safe candidate exists, that absence must remain explicit rather than using a different objective.
4. The final comparison must record interventions and discovery coverage from that run before declaring no unexplained P1-critical gap.

## Current conclusion

Studi already improves the recurring weaknesses in the `/school` baseline—permission drift, submission ambiguity, fragmented ownership, and inconsistent recovery—through explicit durable owners. The existing `/school` tasks still have stronger retained evidence for broad, signed-in real-course traversal. Final equivalence remains unclaimed until the pending authenticated Moodle continuation closes that exact gap.
