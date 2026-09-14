# Fake school and scan benchmark report

This work builds a repeatable local school, changes how Studi records and queues homework, and compares the current scanner with the previous production build. The baseline is commit `3365ad6`; implementation lives on `codex/fake-lms-scan-comparison` in a separate worktree.

## How the fake school was made

The simulator lives in `agent-harness/lms/` and is excluded from the packaged app. Its scenarios translate observed failure patterns from the September school-task investigations and saved PostHog audit into invented school records: completed work queued again, closed overdue work, extensions, conflicting or date-only deadlines, lost requirement fragments, aliases, blocked prerequisites, external sign-ins, and interrupted work.

The portable semester has six courses, 39 activities, and 15 synthetic files, including six PDFs. Its explicit grading inventory contains 25 assigned tasks; completed readings and informational pages remain visible as distractors. A nine-task regression scenario and a one-task smoke scenario make smaller checks practical.

React server-rendered pages expose ordinary links, forms and downloads. Node and SQLite persist drafts, uploaded-file metadata, submission receipts, an ordered event journal, school time and consumed faults. Statistics homework, build reports and feedback use separate local origins and independent simulated sign-in state. Named events change deadlines or restore access deterministically. Each run has its own directory and dynamically allocated ports.

Real course documents are **not** committed or silently copied into the portable school. A private import command accepts explicitly selected files, verifies hashes and stores a local content-addressed pack. The shipped examples are synthetic. Optional PostHog export is explicitly configured for a development project and sends allowed metadata; it is not required for local operation. No production telemetry destination was changed.

The simulator separates its public pages from operator inspection. Expected assignment IDs and queue restrictions are authored independently of Studi's eligibility function. School acceptance and automatic queue readiness are different: a school may accept a response while Inky still lacks enough deadline or requirement evidence to start automatically.

## What changed in Studi

Assignments now retain the school's submitted/graded/locked/unknown status separately from Inky's own execution state. Status, deadlines, late windows and requirement fragments retain evidence. Date-only deadlines remain date-only. Requirements from multiple passages can be saved, replaced per source and reconciled without silently losing unresolved gaps.

A shared eligibility decision checks saved school status, requirement completeness, deadline precision and late acceptance at enqueue and before starting. Submitted, graded, locked, stale or unresolved work cannot enter the ordinary work queue. Settings distinguish manual work requests from automatic queueing; restarting or changing settings withdraws unstarted automatic work while preserving explicit student requests.

Scans start with discovery and use targeted detail reads. Source checkpoints record progress and content digests. Full unchanged detail observations can reuse requirements; an unchanged index does not claim that every linked page was checked. Compact summaries and bounded checkpoint-driven session rotation reduce the need to carry full school history through every request. Failed or partial checks retain discoveries and can resume.

An assignment with unresolved evidence now offers **Check assignment details**. That check preserves the selected assignment's identity and the full-school inventory, survives a pause or restart, and returns to an explicit Start action. It cannot create work or queue it, including when automatic work is enabled. Submitted, graded and locked work exposes its school state instead of a misleading Start action. The scan browser boundary also rejects known schoolwork mutations, including draft saves, and permits text entry only in identified search/filter controls. These are explicit tool guards, not a claim that arbitrary school JavaScript is intrinsically read-only.

## How the benchmark works

`agent-harness/benchmark/` has two evidence classes:

1. **Controlled production replay:** identical synthetic observations invoke each build's actual scan tools, storage and manager. There is no handwritten approximation of the old scanner. The old tool receives the full continuous instruction excerpt it supports. Independent grading checks canonical identity, status, dates, late policy, retained requirements, unresolved gaps and the exact queue. This measures correctness, not model intelligence or token savings.
2. **Live production runtime:** real Pi sessions use the production browser controller, scan coordinator, storage and queue manager in an isolated Electron window against a reset fake school. The model receives browser/scan tools, not fixture truth, source files or a shell. Grading checks declared inventory, title/course/deadline facts, completed status and forbidden queue/write effects. This narrower live grade does not establish full requirements or answer quality.

Each result identifies the fixture, seed, clock, model/reasoning, budgets, revision and hashes of the actual build and benchmark. Paired comparisons reject changed fixtures, settings or benchmark code. Every phase and failure remains visible; missing token usage remains unknown. The total tool and wall-time budget applies across phases. An exploratory Codex reviewer can inspect the public school and results, but is not represented as a blind model trial.

## Results

The paired controlled results use identical fixture/configuration and benchmark hashes:

| Measurement | Previous scanner | Updated scanner |
| --- | ---: | ---: |
| Assignments discovered | 9/9 | 9/9 |
| Independent checks passed | 51/72 | 72/72 |
| Assignments queued | 9 | 2 |
| Incorrectly queued assignments | 7 | 0 |
| Recorded school statuses | 0/9 | 9/9 |
| Date-only deadline preserved without a time | No | Yes |
| Model/token measurement | Not applicable | Not applicable |

The two eligible assignments were accepted late practice and the upcoming puzzle project. Both builds retained the full supported instruction passage; the comparison does not deliberately handicap the old tool. Independent review checked the raw SQLite assignment/course/queue records against both result files and found zero assignment executions.

Controlled run IDs: baseline `09b04c09-caa4-4aec-8ca8-b6da3f79a5d1`, integrated candidate `0f6e8ace-d99b-42a8-a665-2b4ae38dd3c1` at `a28722d`. An earlier candidate also passed 72/72. Recorded runtime differences of less than a second are not evidence of model-efficiency improvement. [Compact measured evidence](fake-lms-scan-evidence.json) retains both builds' hashes, fixture/configuration, check outcomes, recorded facts and actual queues.

The real-model baseline smoke used `gpt-6-astra`, medium reasoning, a 180-second budget and 150-tool limit. It finished **partial** in 74.1 seconds, after 26 tool calls and 27 provider requests. Reported usage was 34,959 input, 1,580 output and 206,848 cached-input tokens. The assignment was found but its exact deadline was not retained. The run also encountered unreadable PDF/rubric content, ambiguous empty linked-system pages and a partner-board link missing from the small scenario.

The matched candidate also finished **partial**, after 176.6 seconds. It made 56 tool calls and 57 provider requests, with 66,393 input, 3,085 output and 649,984 cached-input tokens. Both runs failed the same three live checks: scan completion, the conservative navigation restriction and the exact deadline. Both found the assignment; neither changed schoolwork. The candidate retained its not-submitted status and explicit missing attachments, but this live run provides **no speed or token-efficiency improvement**.

| Live smoke measurement | Previous scanner | Updated scanner |
| --- | ---: | ---: |
| Scan result | Partial | Partial |
| Duration | 74.1 s | 176.6 s |
| Tool calls | 26 | 56 |
| Provider requests | 27 | 57 |
| Input / output tokens | 34,959 / 1,580 | 66,393 / 3,085 |
| Cached-input tokens | 206,848 | 649,984 |
| Exact deadline retained | No | No |
| Schoolwork writes | 0 | 0 |

Live run IDs: baseline `1dff0cd2-bcf5-425a-b18f-0ce90689a489`, candidate `f89063b0-66dc-46fe-96f1-10c7a649966b`. The comparator confirms identical fixture, benchmark and settings. These runs had already started with medium reasoning before the user changed all subsequent coding/review tasks to Astra/high; the historical evidence is not relabeled.

The recorded navigation restriction was Chromium's built-in PDF viewer resource, not evidence that the model attempted to visit an unrelated external school. These fixture/window limitations confound a model-quality conclusion. A prior exploratory run timed out on hidden-window PDF screenshot capture; it remains recorded as a failure.

Trace review also found a concrete parser defect shared by both builds: the candidate supplied the correct offset-bearing timestamp for a visible `America/New_York` deadline, but validation rejected it. The model retried without a timestamp, losing deadline precision. This is a production validation failure, not evidence that the model could not read the date.

That failure improved the harness: hidden windows now render offscreen, screenshots have a bounded failure path, and interrupted runs recover already-persisted facts without marking the scan complete. It does not prove that the visible installed app's PDF viewer is broken. Separate PDF/download work is not included in this comparison.

The simulator's normal Chromium journey passed draft save, reload, server restart with the same draft, submission receipt and reload without duplicate submission. Its first browser failure exposed a real header bug: `Referrer-Policy: no-referrer` produced `Origin: null` on form submission. Changing it to `same-origin` fixed the form while preserving exact-origin and CSRF checks. Simulator/type checks, 11 simulator/telemetry tests, the existing QA-fixture regression, all four old harness suites (27 assertions), and 22 benchmark grader/metrics tests passed. The scanner owner additionally passed 34 focused scan/manager/alias tests and 19 lifecycle/chat/task-transition tests.

After the frozen live pair, the final simulator removes the unavailable partner-board announcement from smoke and explicitly labels empty vendor assignment lists. Its type check, build and all 11 tests passed. These corrections have controlled verification; the recorded live pair used the earlier identical fixture on both sides. The integrated app type check, full renderer/Electron build and 44 focused scanner/browser/IPC regressions also passed at `a28722d`.

## Independent review and limits

The additional Codex review task examined the simulator, production changes and benchmark. Its findings improved phase usage accounting, comparison gates, exact queue grading, baseline instruction fairness, evidence binding, alias reconciliation, explicit-request preservation, and recovery from incomplete assignment details.

The remaining architectural limits are explicit: eligibility rechecks saved evidence up to 24 hours old rather than enforcing a new live page read at every start; session rotation depends on checkpoint calls rather than a universal production token cap; automatic queue preference is not a new autonomous dispatch/submission loop. Unchanged page digests cannot prove that an attachment changed independently. Live benchmark windows do not verify desktop admission, product UI, downloads, popup tabs, assignment execution, or native installed-app behavior. Those require separate app evidence.

## Reproduce the comparison

See [benchmark instructions](../../agent-harness/benchmark/README.md) and [simulator instructions](../../agent-harness/lms/README.md). Build and preserve the baseline's complete `dist` tree before building the candidate, using the same locked dependencies. Each live invocation creates a fresh school and agent store. Provider credentials come only from the dedicated QA cache.

```powershell
bun run build:lms
bun run build
bun run test:benchmark
bun run benchmark -- replay --build .studi-harness/baseline-3365ad6/dist --revision 3365ad634f8b3aaaf930d09977200ec6219b4650
bun run benchmark -- replay --build dist --revision <candidate-commit>
bun run benchmark -- compare <baseline-result.json> <candidate-result.json> --output comparison.json
bun run benchmark -- live --lms-module .studi-lms/build/server.mjs --build dist --revision <candidate-commit> --scenario smoke --model gpt-6-astra --effort medium --budget-ms 180000 --max-tool-calls 150
```

Raw run artifacts are retained locally under `.studi-harness/benchmarks/<run-id>/`, including failures, browser/tool traces and persisted school state. They are ignored by Git. Run the live command for both builds with the same fixture bundle, seed, model and budgets; the comparator rejects mismatches. Repeated unchanged/changed/resume phases are supported but were not measured in this limited live comparison.
