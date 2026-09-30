# Checkpoint 01: A fake LMS that fails like real schools

Status: PASS for the **negative-baseline gate**. The existing scanner timed out; scanner quality and release readiness are not approved by this checkpoint.

Commits: `7c36b18` (Settings review fixes), `77e6f3d` (GPT-6 Sol default); this report accompanies the Checkpoint 01 fixture commit.

## Gate

| Criterion | Target | Result | Evidence |
| --- | --- | --- | --- |
| LMS suite | `bun run test:lms` green | PASS, 42/42 | Real tail below |
| Current scanner on `moodle-noisy` | Fail for time or junk | PASS as negative test: timed out at 180.011 s with 1/9 assignments | Live tail below; `scan-baseline.md` |
| Baseline for Moodle and Canvas | Recall, precision, due-date accuracy, junk, time, tools, tokens | PASS, both recorded; interrupted calls estimated and flagged | Table below; `scan-baseline.md` |
| Side-effect journal | 0 schoolwork writes | PASS, 0 in both | `final-school.json` and `scan-evaluation.json` in each local run |

## What changed

- `agent-harness/lms/{server,school-theme,school-scenarios,scenarios,store,document-fixtures,replay,record}.*`: Moodle/Canvas-like pages and APIs, noisy activity list, SSO, linked vendors, document types, faults, safe replay plumbing.
- `agent-harness/lms/expected/*.json` and `evaluate-scan.mjs`: independent expected rows and scan metrics from saved state and side-effect journal.
- `agent-harness/benchmark/{live-runner,cli,comparison,slo.json}`: themed live runs, bounded targets, and hard failure for timeouts or errors.
- `agent-harness/lms/tests/scan-fixtures.*` and `tests/benchmark/metrics.test.mjs`: HTTP/browser journeys, score and timeout behavior.
- Settings review fixes and GPT-6 Sol default were committed separately before this checkpoint. The app default is GPT-6 Sol, High reasoning, normal speed; explicit saved model choices remain respected.

## Exact commands and output tails

```powershell
bun run test:lms
```

```text
✔ vendor sign-in and runs are independent; public pages cannot inspect control data (305.8584ms)
✔ prerequisites gate direct actions and unlock after saved completion (127.1279ms)
✔ interrupted scan retries once and saved event/clock changes survive restart (86.8714ms)
✔ synthetic PDF downloads support byte ranges and private import validates hashes (121.0779ms)
✔ same seed reproduces initial state; unsafe origin and fabricated success are rejected (114.819ms)
✔ export retains correlation but excludes private details and uses stable event IDs (49.3835ms)
✔ missing config and delivery failure are explicit and do not mutate local events (2.4745ms)
ℹ tests 42
ℹ suites 0
ℹ pass 42
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3764.1092
```

```powershell
bun run benchmark -- live --lms-module .studi-lms/build/server.mjs --scenario moodle-noisy --budget-ms 180000 --max-tool-calls 160 --model gpt-6-sol --effort high
```

```text
$ node agent-harness/benchmark/cli.mjs live --lms-module .studi-lms/build/server.mjs --scenario moodle-noisy --budget-ms "180000" --max-tool-calls "160" --model "gpt-6-sol" --effort high
{"path":"C:\\Users\\kaust\\.t3\\worktrees\\studi-2\\t3code-7b59ae23\\.studi-harness\\benchmarks\\d867b447-62dd-41cd-b468-8c56dbb244fc\\result.json","error":"Benchmark deadline exceeded","phases":[{"name":"cold","status":"timed_out","scanState":"running","passed":false,"metrics":{"durationMs":180011.17080000002,"toolCalls":51,"modelCalls":52,"usage":null}}]}
error: script "benchmark" exited with code 1
```

```powershell
bun run benchmark -- live --lms-module .studi-lms/build/server.mjs --scenario canvas-basic --budget-ms 180000 --max-tool-calls 160 --model gpt-6-sol --effort high
```

```text
$ node agent-harness/benchmark/cli.mjs live --lms-module .studi-lms/build/server.mjs --scenario canvas-basic --budget-ms "180000" --max-tool-calls "160" --model "gpt-6-sol" --effort high
{"path":"C:\\Users\\kaust\\.t3\\worktrees\\studi-2\\t3code-7b59ae23\\.studi-harness\\benchmarks\\c200fe06-3f82-45cd-9fb7-f358c07ca908\\result.json","error":"Benchmark deadline exceeded","phases":[{"name":"cold","status":"timed_out","scanState":"running","passed":false,"metrics":{"durationMs":180002.46110000001,"toolCalls":44,"modelCalls":45,"usage":null}}]}
error: script "benchmark" exited with code 1
```

## Metrics

| Local scenario | Assignments | Recall | Precision | Exact due dates | Junk | Time | Calls | Total tokens | Completed-generation lower bound | Writes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| Moodle noisy | 1/9 | 11.1% | 100% | 11.1% | 0 | 180.011 s | 51 | ~864,557 estimated | 817,977 | 0 |
| Canvas basic | 9/9 | 100% | 100% | 33.3% | 0 | 180.002 s | 44 | ~743,509 estimated | 715,123 | 0 |

Saved run IDs: Moodle `d867b447-62dd-41cd-b468-8c56dbb244fc`; Canvas `c200fe06-3f82-45cd-9fb7-f358c07ca908`. Both are under ignored `.studi-harness/benchmarks/`. There is no earlier comparable baseline. The valid LTI URL alias was added to expected files after the runs, and the saved runs were re-scored; see `scan-baseline.md` for the discrepancy in older embedded scores and token breakdown.

Additional focused checks: `bun run typecheck` passed; `bun run test:agent` 46 passed; `node --test 'tests/contracts/*.test.mjs'` 76 passed; `bun run test:benchmark` 23 passed. Browser journeys passed for `moodle-noisy`, `canvas-basic`, both API-off variants, and `moodle-sso`, with zero page errors and zero schoolwork writes. These are local controlled checks, not full installed-app or real-school journeys.

## Screenshots

- `.agents/audit/checkpoint-01/moodle-noisy-dashboard.png`, `moodle-noisy-course.png`, `moodle-noisy-quiz.png`, `moodle-noisy-webassign.png`: JS dashboard, nested course, quiz iframe, linked vendor.
- `.agents/audit/checkpoint-01/canvas-basic-dashboard.png`, `moodle-sso-dashboard.png`: client-rendered planner and SSO return.
- `.agents/audit/settings/settings-{inky,homework,school,notifications,you}.png`: five Settings tabs re-captured at 1120×760 after review fixes.

## Limits and next review

These are synthetic approximations of Moodle/Canvas routes and behavior, not full distributions or real-school captures. Replay uses static, sanitized recordings and returns 404 for unrecorded paths; real WolfWare recording belongs to Checkpoint 8. The real scanner still times out and lacks due dates; its browser tools and scan workflow are later checkpoints. Interrupted calls have estimated, flagged tokens rather than exact provider totals. No real school account, schoolwork, production deployment, or release was touched.

## Fixes after review

The Moodle course now has a literal "Submit Lab 3" link that only opens Pacific lab's assignment page. `/calendar/export.php` supplies an iCal fallback, including when connector APIs are disabled. Assignment inventory and expected rows did not change.

Timed-out benchmark runs now preserve completed-call usage and estimate the in-flight call separately from provider request size. A missing usage metric fails the comparison gate. Recovered the two saved local runs: ~864,557 and ~743,509 estimated total tokens; both remain failed scans. `bun run test:lms` passed 42/42 and `bun run test:benchmark` passed 24/24 after these fixes.
