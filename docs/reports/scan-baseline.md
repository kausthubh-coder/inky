# Scan baseline: local Moodle and Canvas fixtures

The existing Studi scanner was measured against the new **local, synthetic** school scenarios. No real school account or schoolwork was accessed. Both runs used GPT-6 Sol, High reasoning, normal speed, Pi 0.87.1, seed 42, and a three-minute deadline. The school clock began at 2026-09-13T16:00:00.000Z. The scanner itself was unchanged for this checkpoint.

| Scenario | Result | Found / expected | Recall | Precision | Exact due dates | Junk | Duplicates | Invented dates | Time | Tool calls | Schoolwork writes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `moodle-noisy` | Timed out while running | 1 / 9 | 11.1% | 100% | 11.1% | 0 | 0 | 0 | 180.011 s | 51 | 0 |
| `canvas-basic` | Timed out while running | 9 / 9 | 100% | 100% | 33.3% | 0 | 0 | 0 | 180.002 s | 44 | 0 |

Precision is 100% for Moodle because its **one** saved assignment is valid; it does not imply useful coverage. Canvas saved all nine assignments but omitted the exact deadline timestamps on six. The three exact matches are expected date-only or unknown dates. The side-effect journals contain zero schoolwork writes in both runs. The three-minute time target was missed by both; Moodle also missed the recall and due-date targets. No positive scanner-readiness claim follows from this baseline.

| Scenario | Total tokens | Completed-generation lower bound | Uncached input | Cached input read | Output | Peak prompt tokens, lower bound | Peak serialized request |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `moodle-noisy` | Unknown | 817,977 | 35,848 | 779,776 | 2,353 | 29,688 | 383,856 chars |
| `canvas-basic` | Unknown | 715,123 | 68,916 | 643,072 | 3,135 | 31,960 | 142,784 chars |

The runs were interrupted at the deadline, so final aggregate usage was unavailable. These are sums of completed model generations and cannot be presented as final token totals. Peak serialized request size can include non-text payload. The intended targets in `agent-harness/benchmark/slo.json` are 200,000 tokens / 60 tool calls for Moodle and 150,000 tokens / 50 calls for Canvas, within three minutes; missing aggregate usage cannot pass a token gate.

## Reproduction and real command tails

Run after `bun run build:lms` with a signed-in dedicated QA provider profile. The benchmark starts its own local school and records the result in `.studi-harness/benchmarks/<run-id>/`. Neither command points at a real school URL.

```powershell
bun run benchmark -- live --lms-module .studi-lms/build/server.mjs --scenario moodle-noisy --budget-ms 180000 --max-tool-calls 160 --model gpt-6-sol --effort high
```

```text
{"path":"C:\\Users\\kaust\\.t3\\worktrees\\studi-2\\t3code-7b59ae23\\.studi-harness\\benchmarks\\d867b447-62dd-41cd-b468-8c56dbb244fc\\result.json","error":"Benchmark deadline exceeded","phases":[{"name":"cold","status":"timed_out","scanState":"running","passed":false,"metrics":{"durationMs":180011.17080000002,"toolCalls":51,"modelCalls":52,"usage":null}}]}
error: script "benchmark" exited with code 1
```

```powershell
bun run benchmark -- live --lms-module .studi-lms/build/server.mjs --scenario canvas-basic --budget-ms 180000 --max-tool-calls 160 --model gpt-6-sol --effort high
```

```text
{"path":"C:\\Users\\kaust\\.t3\\worktrees\\studi-2\\t3code-7b59ae23\\.studi-harness\\benchmarks\\c200fe06-3f82-45cd-9fb7-f358c07ca908\\result.json","error":"Benchmark deadline exceeded","phases":[{"name":"cold","status":"timed_out","scanState":"running","passed":false,"metrics":{"durationMs":180002.46110000001,"toolCalls":44,"modelCalls":45,"usage":null}}]}
error: script "benchmark" exited with code 1
```

The independent scorer reads checked-in `expected/<scenario>.json`, the saved final school state, and the school effect journal. For each run, inspect `result.json`, `trace.jsonl`, `final-school.json`, `scan-evaluation.json`, and `school/receipt.json` under the run ID above. The replayable local evidence also lives in ignored `.agents/audit/checkpoint-01/` (`moodle-sol6.log`, `canvas-sol6.log`, `live-summary.json`).

After these runs, expected targets were corrected to accept a valid school LTI launch URL as an alias of its vendor assignment URL. Both saved runs were re-scored without rerunning the model. The table uses the corrected `scan-evaluation.json`; the embedded score in the older raw `result.json` may still show Canvas 8/9 and one junk URL. This was a scoring correction, not a scanner improvement. There is no comparable previous baseline, so the 25% regression rule has no valid earlier run to compare.

The blocked first attempt had an expired QA login and made zero model calls. A second, partial GPT-5.6 Sol attempt was stopped when the requested app model changed. Neither is included in the baseline. Browser/HTTP checks covered the two scenarios, their API-off variants and SSO; the model baseline covers the two required initial cold scans only. Real WolfWare captures and real-school validation are deferred to Checkpoint 8 and require the plan's separate read-only procedure.
