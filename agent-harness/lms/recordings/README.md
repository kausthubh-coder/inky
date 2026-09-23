# Golden pages

Real WolfWare dashboard/course/quiz recordings are deliberately pending CP8 and student consent. No real school pages were collected for CP1.

Export an authorized HAR with response bodies, keep the raw file outside the repository, then run:

```powershell
node agent-harness/lms/record.mjs capture.har redactions.json agent-harness/lms/recordings/wolfware
bun run lms -- start --replay agent-harness/lms/recordings/wolfware --run .studi-lms/runs/wolfware-replay
```

`redactions.json` declares `origins` (e.g. `{"https://school.example.edu":"school"}`) and `replacements` for every real name and identifying ID. Inspect the resulting `recording.json` before committing: automatic scrubbing cannot identify all personal prose. Import retains only GET text responses; no request headers, cookies, passwords, POST bodies or opaque binary files. Duplicate keys are rejected by replay. A recording can only replay recorded method/path/query keys; every other request returns 404. Scripts and forms are disabled; local origin placeholders keep navigation in the replay. This is a static golden-page regression, not a second dynamic LMS implementation.
