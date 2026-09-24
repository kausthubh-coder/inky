# Checkpoint 3b — unknown LMS agent fallback

**Gate: passed.** The final live production Pi scan ran against `unknown-lms` with GPT-6 Sol/high and no Moodle or Canvas connector. The fixture exposes nine authored assignments through its own dashboard, expanded list, course pages and linked vendors; its Moodle/Canvas routes and APIs return 404. The agent followed observed links and used the browser tools to save all nine tasks.

| Phase | Recall | Exact due dates | Junk / invented / writes | Time | Tools | Model calls | Tokens | Changes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Cold | 100% | 100% | 0 / 0 / 0 | 1.74 min | 38 | 39 | 233,359 | 9 new |
| Unchanged | 100% | 100% | 0 / 0 / 0 | 1.44 min | 24 | 24 | 161,016 | 0 |
| Changed | 100% | 100% | 0 / 0 / 0 | 1.18 min | 21 | 22 | 138,287 | 1 updated |

All phases are below the unknown-LMS targets of 10 minutes, 160 tools and 600,000 tokens, with ≥90% recall and exact due dates. The saved [live result](../../.studi-harness/benchmarks/c9812a66-01b3-4156-bf28-6fd665271f2e/result.json) has per-row scoring and side-effect evidence; the harness directory is ignored because it contains local run state.

The first live attempt failed: cold scan found 9/9 tasks but recorded an extra linked-system alias as a tenth task, invented one deadline with it, and used 682,219 tokens. The agent guessed a Moodle `/courses` route on the unfamiliar school and wandered through those legacy pages. I fixed the production scan path: read-only navigation now requires a URL observed in the browser, duplicate class/title/deadline rows are skipped, and the scan prompt tells the agent to batch list rows and stop after observed sources. I then made the fixture's leftover Moodle routes return 404 so the scenario actually represents an unfamiliar LMS. The final run above is against that corrected fixture. Focused browser, scan, and LMS tests pass.
