# Checkpoint 5 — Tutor and Learn (J3)

Status: **PASS, with one caveat.** Scripted and live gates are green. The tutor screenshot comes from the real app driven by a scripted tutor; the live persona runs have no UI. The student decided the 60% citation share is a reported number, not a gate, because the model should judge when a source applies.

Implementation: 5f85dfc (Claude). Test harnesses and two workspace fixes: GPT-6 Sol/high via Codex, first session. After Windows stopped launching processes (`0xc0000142`) mid-run, Claude finished the verification in a second session.

## Gate

| Criterion | Target | Result | Evidence |
|---|---:|---|---|
| typecheck, build, storage, agent, contracts, UI, LMS | Green | **Pass** — 188 + 74 + 76 + 23 + 43, 0 failures | Tails below |
| Existing Electron J1/J2 | Green | **Pass** — 6/6 | Full e2e run below |
| Study page sandbox in real Electron | No network, app origin, navigation, forms or popups; explore and resize work | **Pass** — probe server got 0 requests | `tests/e2e/study-page-sandbox.test.mjs` |
| Scripted J3 | 5 phases, level 0→1, folder files, restart; 3 green runs in a row | **Pass** — 3/3 consecutive, then again inside the full suite | `tests/e2e/j3-learn.test.mjs` |
| Live tutor quality | 3 personas, every rubric item ≥4/5, a visual each session | **Pass** on run 5 (committed prompt): lowest score 4, visual in 3/3 | `.studi-harness/tutor/2026-09-25T20-58-38.672Z/` |
| Real-app screenshots of E and F | From the real app | **Captured** from the real app with a scripted tutor | `.agents/audit/cp05/learn-goals.png`, `tutor-study-page.png` |

## Live tutor runs (GPT-6 Sol, high; judge GPT-6 Sol)

Scores are orient / first wrong assumption / sources / one idea / evidence only.

| Run | Change before the run | Novice | Partial | Strong |
|---|---|---|---|---|
| 1 | none (5f85dfc prompt) | 5/1/5/3/5, no visual, 2 min | 5/5/5/5/5, visual | 5/2/5/5/5, no visual |
| 2 | keep teaching after a good check; use the time; let a wrong On-your-own answer be revised; one thing per question; a visual on visual topics | 5/3/5/5/5, visual | harness crash (choice answered in words) | 5/5/4/5/5, visual |
| 3 | typed answers accept a unit word ("2 shifts."); follow-ups keep the source label; harness maps worded choices | 5/5/5/4/5 | 5/5/5/5/5 | 5/3/5/5/5 (guessed the cause of a wrong answer) |
| 4 | ask how they got a wrong answer before naming a cause | 5/4/5/5/5 | interrupted by a session restart | — |
| 5 | same prompt, committed in 5eee9b1 | **5/4/5/5/5**, visual, 60% cited, 4.0 min, $0.26 | **5/5/5/5/5**, visual, 100% cited, 3.5 min, $0.20 | **5/5/5/5/5**, visual, 83% cited, 3.0 min, $0.17 |

Real bug found by the live run: the typed-answer checker marked "[1, 2, 3]; 2 shifts." wrong because of the full stop, and "2 shifts" wrong against "2". Fixed in `typedAnswerMatches` (a trailing unit word counts; "2 or 3" doesn't).

Lessons run 3–6 minutes because simulated students answer in seconds; the tutor finishes once unaided answers show the next level.

## What changed after 5f85dfc

- `tutor-coordinator.ts`: study-page and finish writes are awaited before the tool returns, so the folder is complete when the lesson ends. Errors still go to `onError` and never stop a lesson.
- `learn-workspace.ts`: cheat-sheet dedupe compares whole lines across the whole file. Before, it matched substrings in only the last 4,000 characters, so "A stack is LIFO" hid "A stack is LIFO after each push".
- `study-page.ts`: study pages get app-styled buttons instead of the grey system default.
- Fake `learn` course: a numbered CS 316 review sheet and an "Insertion sort" topic for the live visual lesson. Topic weights were rebalanced, and `agent-harness/lms/tests/redesign.test.mjs` was updated to match.
- New tests: the Electron sandbox proof, scripted J3, and the exact-line dedupe case (in `tests/storage/learn-workspace.test.mjs`). The e2e harness gained `restart()` and scripted tutor turns.

## Commands run and actual output tails

```text
$ bun run typecheck && bun run build
tc=ok
build=ok
$ bun run test:storage      ℹ tests 188  ℹ pass 188  ℹ fail 0
$ bun run test:agent        ℹ tests 74   ℹ pass 74   ℹ fail 0
$ node --test "tests/contracts/*.test.mjs"   ℹ pass 76  ℹ fail 0
$ bun run test:ui           ℹ tests 23   ℹ pass 23   ℹ fail 0
$ bun run test:lms          ℹ tests 43   ℹ pass 43   ℹ fail 0
```

```text
$ node --test --test-concurrency=1 tests/e2e/j3-learn.test.mjs   (x3)
✔ J3: class material, five lesson phases, study page, files and restart (22084ms)
ℹ pass 1  ℹ fail 0
ℹ pass 1  ℹ fail 0
ℹ pass 1  ℹ fail 0
leftover electron processes: 0
```

```text
$ node --test --test-concurrency=1 tests/e2e/*.test.mjs
✔ J1: onboarding scans the isolated LMS and Today matches expected.json
✔ J2 files: coding work stays in the homework folder and uploads the required files
✔ J2: attempt-only stops at review, student submits once, and Studi shows the receipt
✔ J2: auto-submit commits exactly once when the review window ends
✔ J2: takeover pauses a working assignment and Stop this releases it
✔ J2: Stop from the composer cancels a working assignment without submitting
✔ J3: class material, five lesson phases, study page, files and restart
✔ study page in Electron cannot reach network, app origin, navigation, forms or popups
ℹ tests 8  ℹ pass 8  ℹ fail 0
```

```text
$ node agent-harness/tutor/run.mjs        (run 5)
{"persona":"novice","status":"completed","minutes":3.96,"sourceShare":0.6,"visual":true,"scores":{"orient":5,"firstWrongAssumption":4,"sourceCitations":5,"oneIdea":5,"evidenceOnly":5},...}
{"persona":"partial","status":"completed","minutes":3.49,"sourceShare":1,"visual":true,"scores":{"orient":5,"firstWrongAssumption":5,"sourceCitations":5,"oneIdea":5,"evidenceOnly":5},...}
{"persona":"strong","status":"completed","minutes":2.98,"sourceShare":0.83,"visual":true,"scores":{"orient":5,"firstWrongAssumption":5,"sourceCitations":5,"oneIdea":5,"evidenceOnly":5},...}
```

## Metrics

| Metric | Result |
|---|---:|
| Sandbox probe-server requests | 0 |
| Saved explored labels (sandbox / J3) | `x` / `popped B` |
| Frame height | Follows content, clamps at 640 px |
| J3 consecutive green runs | 3 |
| Live rubric (run 5), lowest item | 4/5 |
| Live source share (run 5) | 60% / 100% / 83% |
| Live tokens per session, tutor + student + judge (run 5) | 80k–130k input incl. cache, 4.7k–6.5k output, $0.17–$0.26 |

## Screenshots

- `.agents/audit/cp05/learn-goals.png`: Learn with the CS 316 goal, today's topic, and "Find more in class" reading the syllabus.
- `.agents/audit/cp05/tutor-study-page.png`: the tutor in the Learn phase with a study page in the sandbox, a cited source, and the phase row.

## Not done

- F from a live (not scripted) tutor session in the real app. Do this during the real-school session in Checkpoint 8.
- The simulated novice often answers like a stronger student, so the "first wrong assumption" rubric is exercised less than intended. The personas were not changed, so the gate couldn't be gamed.

## Decisions

- The scripted journey adds an undated exam, because the fake published exam (Sep 21) is already past and Learn correctly hides past goals. It still runs the real materials scan against the fake school.
- The live runner seeds the syllabus and review sheet directly, so tutor quality is measured separately from scan reliability.
- The Windows `0xc0000142` failure was environmental. It cleared after the session restarted, and Electron runs now go one at a time with 0 leftover processes.
