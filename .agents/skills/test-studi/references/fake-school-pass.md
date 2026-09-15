# Tier 2: fake school pass

The fake school in `agent-harness/lms` serves courses, assignments, files, drafts and submission receipts on loopback with authored ground truth. The benchmark runner in `agent-harness/benchmark` boots the production scan coordinator, manager, storage and browser controller against it in a hidden Electron window, then grades what Inky recorded. Use this tier for scanner, agent pack, materials, manager and storage changes. It never opens the product UI, Clerk or Convex.

## Build

```powershell
bun run build:electron
bun run build:lms
```

Rebuild `dist/electron` after every production change. The school build only changes when `agent-harness/lms` does.

## Inspect the school by itself

```powershell
bun run lms -- list
bun run lms -- start --scenario scan-regression --run .studi-lms/runs/<name>
```

Open the printed `url` in an isolated browser to read what a student would see. Send `{"command":"inspect"}` on the process's stdin to read state, effects and `truth`. `agent-harness/lms/README.md` lists the scenarios and the `advance` events (`deadline-change`, `restore-access`, `next-week`, and others). Use this when the question is what the school shows, or when a scan tool needs a page to look at.

## Deterministic replay, no provider

```powershell
bun run benchmark -- replay
```

Feeds fixed page observations through the actual scan recording tools, storage and manager and grades recorded facts and queue decisions. Use it for recording-tool, identity, deadline, requirement and eligibility changes. It is fast and repeatable and needs no credentials.

## Live scan, real provider

```powershell
bun run benchmark -- live --lms-module .studi-lms/build/server.mjs --scenario smoke --budget-ms 180000 --max-tool-calls 150
```

Options: `--scenario` (`smoke` for one task, `scan-regression` for nine tasks across four courses, `semester` for the full inventory), `--provider` and `--model` (defaults are ChatGPT and Astra; pass `--provider anthropic --model claude-fable-5-1` for Claude), `--effort`, `--phases cold,unchanged` to rescan with the same store, `--show` to watch the window.

The runner imports the dedicated QA provider cache into a private run directory; see [provider-login.md](provider-login.md). A missing or expired credential is recorded as a failure, never replaced by a script. Results, per-phase school state and `trace.jsonl` land in ignored `.studi-harness/benchmarks/<run-id>/`.

Read the checks, not the exit code alone. They cover inventory, titles, courses, deadlines including date-only wording, retained requirements, known completion state, forbidden queue entries and any school writes. A failed check names the fact that was wrong. Grade discovered records and school effects; do not trust the agent's own summary.

## Focused node tests

The same code paths have unit coverage that runs in seconds after `build:electron`:

```powershell
node --test tests/storage/school-scan-coordinator.test.mjs tests/storage/scan-evidence.test.mjs tests/storage/school-materials.test.mjs tests/storage/lifecycle-execution.test.mjs tests/agent/*.test.mjs
```

Run the files for the area you touched before a live run, and `bun run test:benchmark` when the grader or metrics changed.

## Limits

This tier proves scan and work orchestration against a controlled school. It does not prove onboarding, the visible school pane, chat UI, notifications or the installed app. One scenario is not compatibility proof for a real LMS. For a claim about prompt or model quality, repeat runs with fixtures and configuration held constant and keep every run's outcome; one success is not a trend.
