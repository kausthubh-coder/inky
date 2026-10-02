# Live tutor quality check

Run from the repository root after `bun run build && bun run build:lms`:

```powershell
node agent-harness/tutor/run.mjs
```

The runner uses the production Pi learning runtime with GPT-6 Sol/high for Inky, three GPT-6 Sol simulated students plus a returning student with two topics due, a blind explanation marker, and a separate rubric judge. Use `node agent-harness/tutor/run.mjs --effort medium` for the comparison run. It seeds each student's Learn repository from the local fake `learn` course syllabus and numbered review sheet. It uses only the local fake school and writes transcripts and summaries under ignored `.studi-harness/tutor/`.

The existing dedicated QA Codex credential cache must be available. The runner prints scores, placement, visual use, blind-marking agreement, timing, chat replies, retries, board capacity, and returning-topic checks. Student misconception prompts and complete transcripts stay in the ignored run directory. These measurements are observations, not gates: the run exits zero unless a student could not run (including unavailable dependencies, credentials, or judge responses).
