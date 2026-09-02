# `/school` comparison baseline

Date captured: 2026-09-02  
Purpose: factual baseline for the final Studi capability comparison. This is not the comparison verdict.

## Evidence set

- `school` (`01a015f1-671a-7de0-adf1-5e1a998d26f4`): the long-running WolfWare/course task, including class-by-class scans, Moodle activity checks, third-party systems, assignment work, repository work, and memory updates.
- `Review school chat patterns` (`01a04a0b-4df3-7112-b04f-492ef2b0df86`): read-only audit of 21 School records (9 user-owned tasks and 12 helper runs).
- `Review school chat workflows` (`01a03477-ac9b-7c32-b194-ddfbc846ac76`): earlier workflow/memory synthesis.
- `Complete CSC217 Lab 1 Setup` (`01a045db-8500-7fb3-a031-b3856cec79df`): real repository/setup/completion boundary.
- `Answer Moodle quiz questions` (`01a04a80-2564-7a00-a25a-49d36a4b9966`): real “answer and preserve, do not submit” boundary.
- `Check upcoming class tests` (`01a04a2c-5ce3-7421-8bcb-e8d19483a829`): real cross-class discovery boundary.

## Repeated costs found in the existing workflow

1. **Action-level drift:** the agent sometimes explains or drafts when the user wanted it to perform the reversible work.
2. **Submission ambiguity:** “fill but do not submit” needed repeated steering, and final-submit behavior was inconsistent between tasks.
3. **Authentication friction:** existing sessions, SSO, and fresh tabs were not always attempted before asking the user; Duo and expired third-party sessions still require legitimate handoffs.
4. **State closure:** memory sometimes retained an older `uncommitted`, `blocked`, or `in progress` state after the browser or repository had moved on.
5. **Overproduction:** some tasks produced dashboards, handoffs, or strategy material when a compact result or direct action was requested.
6. **Fragmented ownership:** queue/order, login state, browser state, submission intent, and durable memory were reconstructed across task history instead of projected by one product runtime.

## Existing workflow strengths Studi must preserve

- Can inspect authenticated Moodle/WolfWare pages and follow links into Gradescope, WebAssign, Gmail, course repositories, Jenkins, and official course resources.
- Can distinguish verified facts from stale copied course content and explicitly leave uncertain dates unverified.
- Can do substantial repository work, run tests and coverage, edit documents, and reconcile external build results.
- Can leave Moodle answers saved without final submission when the boundary is followed.
- Can write durable class/system/topic memory that improves later audits.

## Final comparison dimensions

The final installed-app run will compare the same user outcome rather than raw tool count:

- authenticated discovery coverage and evidence quality;
- number and clarity of human handoffs;
- whether `attempt` versus `auto-submit` remains stable without repeated steering;
- whether completed answers survive review expiry and restart;
- whether queue, browser, task, and memory state remain coherent after interruption;
- whether the final result is compact and actionable;
- capability gaps where the general Codex task can still reach a system or workspace Studi cannot.

No live coursework submission is required or authorized for this comparison.
