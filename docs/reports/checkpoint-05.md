# Checkpoint 5 — Tutor and Learn (J3)

Status: **PARTIAL — everything scripted is green; the live tutor quality run is still owed.** The ChatGPT account used for GPT-6 Sol hit its usage limit (resets 2026-09-26 08:11), so the three live persona sessions and the judge have not run.

Implementation: 5f85dfc (Claude). Test harnesses and two workspace fixes: GPT-6 Sol/high via Codex, first session. After Windows stopped launching processes (`0xc0000142`) mid-run, Claude finished the verification in a second session.

## Gate

| Criterion | Target | Result | Evidence |
|---|---:|---|---|
| typecheck, build, storage, agent, contracts, UI, LMS | Green | **Pass** — 188 + 74 + 76 + 23 + 43, 0 failures | Tails below |
| Existing Electron J1/J2 | Green | **Pass** — 6/6 | Full e2e run below |
| Study page sandbox in real Electron | No network, app origin, navigation, forms or popups; explore and resize work | **Pass** — probe server got 0 requests | `tests/e2e/study-page-sandbox.test.mjs` |
| Scripted J3 | 5 phases, level 0→1, folder files, restart; 3 green runs in a row | **Pass** — 3/3 consecutive, then again inside the full suite | `tests/e2e/j3-learn.test.mjs` |
| Live tutor quality | 3 personas, every rubric item ≥4/5, ≥60% sourced questions, a visual each session | **Not run** — provider usage limit | `agent-harness/tutor/run.mjs` |
| Real-app screenshots of E and F | From the real app | **Captured** from the scripted J3 run. The plan asks for a live session; F will be recaptured then | `.agents/audit/cp05/learn-goals.png`, `tutor-study-page.png` |

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
$ node agent-harness/tutor/run.mjs
ERROR: You've hit your usage limit ... try again at Sep 26th, 2026 8:11 AM.
```

## Metrics

| Metric | Result |
|---|---:|
| Sandbox probe-server requests | 0 |
| Saved explored labels (sandbox / J3) | `x` / `popped B` |
| Frame height | Follows content, clamps at 640 px |
| J3 consecutive green runs | 3 |
| Live rubric, source share, visual use, tokens, minutes | Not measured yet |

## Screenshots

- `.agents/audit/cp05/learn-goals.png`: Learn with the CS 316 goal, today's topic, and "Find more in class" reading the syllabus.
- `.agents/audit/cp05/tutor-study-page.png`: the tutor in the Learn phase with a study page in the sandbox, a cited source, and the phase row.

## Not done

- Live persona run: `bun run build && bun run build:lms && node agent-harness/tutor/run.mjs` once the limit resets. If a persona misses the gate, change only `TUTOR_SYSTEM_PROMPT` or `tutor-context.ts`, then rerun all three.
- The live harness records only the last model call's usage (`takeLastUsage`), not the session total. Sum per turn before reporting tokens.
- Recapture F from a live session.

## Decisions

- The scripted journey adds an undated exam, because the fake published exam (Sep 21) is already past and Learn correctly hides past goals. It still runs the real materials scan against the fake school.
- The live runner seeds the syllabus and review sheet directly, so tutor quality is measured separately from scan reliability.
- The Windows `0xc0000142` failure was environmental. It cleared after the session restarted, and Electron runs now go one at a time with 0 leftover processes.
