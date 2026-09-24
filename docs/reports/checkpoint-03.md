# Checkpoint 03: New scan
Status: PASS for the synthetic gate
Commits: `33f00fa..HEAD`

## Gate

| Criterion | Target | Result | Evidence |
| --- | --- | --- | --- |
| Moodle with APIs | <3 min; recall, precision, exact due ≥98%; 0 junk | 0.732 s; 100% each; 0 junk | `0a4cbbfa` cold |
| Moodle without APIs | <10 min; same accuracy | 0.871 s; 100% each; 0 junk | `69cfa21e` cold |
| Canvas with APIs | <3 min; same accuracy | 0.752 s; 100% each; 0 junk | `068a642a` cold |
| Canvas without APIs | <10 min; same accuracy | 0.691 s; 100% each; 0 junk | `9a2497f0` cold |
| Unchanged refresh | <1 min; 0 changes | Four scenarios: 0.395–0.443 s; 0 changes | Same runs, `unchanged` |
| Changed refresh | Exact semantic changes | Four scenarios: one changed deadline each; 0 extra changes | Same runs, `changed` |
| Sign-in expiry | Needs-you; resumes without rereading finished courses | Cold needs-user at 34.241 s; resume succeeds with 9/9 at 0.634 s; focused resume test proves finished-course skip | `8bd27010`, `scan-structured.test.mjs` |
| School effects and data quality | 0 writes, invented dates, junk rows | 0 in all 14 phases, including interrupted SSO cold | Independent benchmark grades and effect journals |
| Usage | Numeric for every phase, including timeouts | All 14 phases have numeric usage; SSO cold 42,628 total tokens; timeout unit test covers completed calls plus flagged in-flight estimate | `test:benchmark`, run records |

Run IDs above are directories under ignored `.studi-harness/benchmarks/`, each containing `result.json`, `trace.jsonl`, `final-school.json`, and the school effect journal. All runs used only the local fake LMS, GPT-6 Sol configured at high effort, and seed 42. Scan sessions themselves use low effort. The four ordinary scenarios completed through signed-in connectors plus verified course HTML, so their measured model and tool calls were both 0. The SSO cold phase used 12 model calls and 10 tools; its independent discovery grade is false by design before sign-in, while its handoff and resume gate passed. These runs do not prove the model fallback on an arbitrary school.

## Metrics against `agent-harness/benchmark/slo.json`

| Scenario / phase | Time | Recall / precision / exact due | Changes | Tools / tokens | Time / tools / tokens target |
| --- | ---: | ---: | ---: | ---: | ---: |
| Moodle / cold | 0.732 s | 100 / 100 / 100% | 9 new | 0 / 0 | 180 s / 60 / 200,000 |
| Moodle / unchanged | 0.443 s | 100 / 100 / 100% | 0 | 0 / 0 | 60 s / 20 / 50,000 |
| Moodle / changed | 0.458 s | 100 / 100 / 100% | 1 | 0 / 0 | 180 s / 60 / 200,000 |
| Moodle no API / cold | 0.871 s | 100 / 100 / 100% | 9 new | 0 / 0 | 600 s / 160 / 600,000 |
| Moodle no API / unchanged | 0.405 s | 100 / 100 / 100% | 0 | 0 / 0 | 60 s / 20 / 50,000 |
| Moodle no API / changed | 0.401 s | 100 / 100 / 100% | 1 | 0 / 0 | 600 s / 160 / 600,000 |
| Canvas / cold | 0.752 s | 100 / 100 / 100% | 9 new | 0 / 0 | 180 s / 50 / 150,000 |
| Canvas / unchanged | 0.430 s | 100 / 100 / 100% | 0 | 0 / 0 | 60 s / 20 / 50,000 |
| Canvas / changed | 0.464 s | 100 / 100 / 100% | 1 | 0 / 0 | 180 s / 50 / 150,000 |
| Canvas no API / cold | 0.691 s | 100 / 100 / 100% | 9 new | 0 / 0 | 600 s / 120 / 400,000 |
| Canvas no API / unchanged | 0.395 s | 100 / 100 / 100% | 0 | 0 / 0 | 60 s / 20 / 50,000 |
| Canvas no API / changed | 0.357 s | 100 / 100 / 100% | 1 | 0 / 0 | 600 s / 120 / 400,000 |
| Moodle SSO / cold | 34.241 s | Paused before discovery | 0 | 10 / 42,628 | 180 s / 65 / 200,000 |
| Moodle SSO / resume | 0.634 s | 100 / 100 / 100% | 9 new | 0 / 0 | 180 s / 65 / 200,000 |

Against `docs/reports/scan-baseline.md`: Moodle improved from 1/9 to 9/9, exact due from 11.1% to 100%, 180 s to 0.732 s, 51 to 0 tool calls, and ~864,557 estimated tokens to 0. Canvas kept 9/9, improved exact due from 33.3% to 100%, 180 s to 0.752 s, 44 to 0 tool calls, and ~743,509 estimated tokens to 0. These compare a model-driven old scan with deterministic connector coverage on the fake LMS; they are not a general real-school speedup claim. Both baselines and all new runs recorded 0 school writes.

## What changed

- `scan/coordinator.ts` and shared scan schema: connector-first setup/refresh, six-tool production discovery, bounded progress, honest partial finish, semantic changes and resume checkpoints; school time zone saved from an explicit page signal or profile.
- `scan/connectors/`, `shared/due-date.ts`, and `scan/refresh-diff.ts`: signed-in Moodle/Canvas readers, conservative deadline precision and identity-based refresh diff. Student deadline overrides remain owned by storage.
- Browser controller and read-only guard: observed sign-in chains and verified course LTI forms populate exact-host allowlists; unrelated POSTs stay blocked.
- Scan prompts/runtime: low-effort scan role, concise tool contracts and strict read-only instructions. Homework and tutor model effort remains unchanged.
- School-check UI and IPC: streaming class/system states, visible failures, sign-in handoff and “Finish with what you found.”
- Benchmark harness: changed-phase expected dates and complete numeric token accounting, including timeout estimates.

## Commands run

```text
bun run build                         PASS
bun run typecheck                     PASS
bun run test:storage                  182/182 PASS after final additions
bun run test:agent                    72/72 PASS
bun run test:ui                       23/23 PASS
bun run test:benchmark                24/24 PASS
bun run test:lms                      42/42 PASS
node --test tests/storage/scan-structured.test.mjs                 4/4 PASS after final additions
node --test tests/storage/due-date.test.mjs tests/agent/scan-connectors.test.mjs  13/13 PASS
node tests/electron-self-test-runner.mjs                            PASS on rerun
```

The first controlled Electron run timed out waiting for the expanded assignment browser view; the immediate rerun passed all scenarios without code changes. The browser-view timeout remains a possible test flake to monitor. Playwright exercised the real React preview at 1280×760 and 800×650: sign-in, result, details/focus, narrow layout, pause, failure and assignment navigation passed.

## Screenshots

- `.agents/audit/cp03/scan-running-chat.png`: controlled preview of the running school check, course progress and a visible failure.
- `.agents/audit/cp03/handoff.png`: controlled preview of the linked-system sign-in handoff.
- `.agents/audit/cp03/scan-result.png`: controlled preview of the completed scan and changed-work navigation.

## Not done, or failed

- Real WolfWare/Canvas validation and arbitrary-school model fallback are outside this synthetic checkpoint. No personal school account was accessed.
- The existing assignment-details path retains its legacy record tools so the homework worker keeps its detail evidence contract. Setup, refresh and materials expose only the six new scan tools; the details-path migration belongs with Checkpoint 4's homework changes.

## Decisions I made

- A naive wall-clock deadline gets an exact `dueAt` only when a validated school zone or explicit source zone is known. Date-only and ambiguous relative text keep their original wording without an invented exact deadline.
- A course completed before sign-in remains in the scan and is excluded from resumed page reads. The resume test checks the actual skip list, not just the final row count.
