# Scan benchmarks

Two different kinds of evidence share a result format and strict paired comparator.

- `replay` feeds fixed synthetic page observations through the selected build's **actual** scan recording tools, local storage and manager. It measures whether recorded facts and queue decisions are correct. Its browser and model are controlled; token usage is unknown. It is not a speed or model-quality benchmark.
- `live` runs production Pi scan sessions, BrowserController, scan coordinator, storage and manager in an isolated Electron window against the durable local LMS. It records effective model/reasoning, tool traces, usage when supplied, persisted results, and independent school state. It does not exercise desktop admission, product UI, downloads, popup tabs, or assignment execution/submission.

Run commands with Bun, using Node for SQLite-compatible runtime execution:

```powershell
bun run build
bun run test:benchmark
bun run benchmark -- replay
bun run benchmark -- live --lms-module .studi-lms/build/server.mjs --scenario smoke --budget-ms 180000 --max-tool-calls 150
```

Build the LMS with `bun run build:lms` first. The live runner imports the dedicated test-studi provider cache into a new private run directory. It never copies the everyday Studi profile. Missing credentials and provider failures are recorded as failures; there is no scripted fallback.

## Compare revisions

Build the baseline checkout before modifying production code. Preserve its complete `dist` tree, including agent packs, in an ignored directory, or use a separately built baseline worktree. Both builds must resolve the same locked dependencies. Use `--build` and `--revision` to identify each build; results also hash the actual files loaded.

```powershell
bun run benchmark -- replay --build .studi-harness/baseline-3365ad6/dist --revision 3365ad6
bun run benchmark -- replay --build dist --revision <candidate-commit>
bun run benchmark -- compare <baseline-result.json> <candidate-result.json> --output comparison.json
```

For live pairs, keep model, provider, reasoning, scenario, seed, budgets and phase sequence identical. Each run gets a fresh school and agent store. `--phases cold,unchanged` preserves that run's store across two real scans. A changed phase requires the fixture's deterministic `deadline-change` event. A resume phase requires an actual `needs_user` scan and the fixture's `restore-access` event. Unsupported transitions fail; they are not treated as successful recovery. A recovery run keeps its expected interruption visible and cannot pass the all-phases-success comparator; inspect that recovery evidence separately.

Live grading measures the declared assignment inventory, title/course/deadline accuracy, known completed status, and forbidden queue/write effects. It does not establish full requirement capture, answer quality, or that every eligible task was queued. The richer replay checks cover recorded requirements and exact queue eligibility. Hidden Electron uses offscreen rendering and a five-second screenshot timeout; an unavailable frame is a tool error, not a fabricated screenshot.

Artifacts live in ignored `.studi-harness/benchmarks/<run-id>/`. Review `result.json`, per-phase school state, and `trace.jsonl`. Records retain incomplete phases and errors. The comparison refuses fixture/configuration mismatches and external exploratory Codex runs. Unknown usage stays `null`; zero tokens are never inferred from a failed request. Token deltas are measurements, not subscription prices or a general model-quality verdict.

## Ground truth and fairness

The operator process owns the fixture and expected outcomes. Live candidate tools receive public browser URLs and production scan tools, with no shell or file tools. The browser is restricted to the current run's school origins. This is capability separation, not an OS security sandbox against arbitrary native code.

The replay corpus recreates submitted/graded work, closed and explicitly accepted late work, date-only deadlines, prerequisites, unavailable status, missing requirements and multi-part instructions. The baseline receives the full continuous instruction passage that its existing tool accepts. New fields are passed only to builds that expose them. The grader does not call production eligibility code and does not trust the agent's success statement.

Exploratory Codex review can inspect public school pages and later inspect all results. A reviewer who has read source scenarios or answer keys is not a blind model trial. Keep their findings separate from controlled model comparisons.
