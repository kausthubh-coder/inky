# Live tutor quality check

Run from the repository root after `bun run build && bun run build:lms`:

```powershell
node agent-harness/tutor/run.mjs
```

The runner uses the production Pi learning runtime with GPT-6 Sol/high for Inky, three GPT-6 Sol simulated students, and a separate GPT-6 Sol rubric judge. It seeds each student's Learn repository from the local fake `learn` course syllabus and numbered review sheet. It uses only the local fake school and writes transcripts and summaries under ignored `.studi-harness/tutor/`.

The existing dedicated QA Codex credential cache must be available. The runner prints only score summaries; student misconception prompts and complete transcripts stay in the ignored run directory. A nonzero exit means at least one persona missed the rubric, source-label, or visual gate, or could not run.
