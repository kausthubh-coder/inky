# Learn revamp: build plan

Updated 2026-10-01 for branch `t3code/learn-redo` (PR 41). This file is the brief for the model that implements it. Read `.agents/tmp/codex-common.md` first: its taste rules, working rules and verify commands all apply here.

## Summary

**What we're building.** Learn becomes a 1-on-1 lesson at a whiteboard. Chalky, the tutor, sits in a side chat on the left. The board on the right holds only the work: the question, what helps answer it, and the student's answer. The student answers on the board and talks to Chalky in the chat. The board changes as the lesson goes: Chalky adds to what's already up, and nothing follows a script.

**Why.** Today a lesson is a list of questions that loses Chalky's explanations, marks some right answers wrong, throws the session away when time runs out, and starts every student at the bottom level. The home page shows one goal at a time and has no real place for learning outside school.

**The work, in four rounds.**

| Round | What changes | Student-visible result |
|---|---|---|
| A. Lesson rules | Time-outs, levels, marking, when topics come back | A lesson that runs out of time still counts. A strong student is placed at Good on day one. "it's 4" is marked right. Earlier topics return at the start of later lessons |
| B. The board | Chalky can reply in chat, keep things up, add to them, erase them, and let the student try again | The board builds up during a question and reacts to what the student says |
| C. Screens | Learn home, the lesson (board and side chat), the wrap-up | Home lists every test and everything learned for yourself. The lesson looks like `shots/lesson-*.png` |
| D. Measuring | One telemetry event per lesson, new numbers in the simulated-student run | We can see whether students get later, unaided questions right |

**How it's tested.** Each rule has a small automated test. Each screen has a preview scenario that is screenshotted and compared with the reference. One scripted run clicks through the real flow. Simulated students take whole lessons against the real tutor. A fresh model audits the finished screens blind. One real lesson is run in the desktop app before it's called done. Details are in Part E.

**Who does what.** Codex implements and tests one round at a time. Claude audits each round's diff and screenshots before the next starts. The student sees screenshots at the end of rounds B and C.

## Files in this folder

| File | What it is |
|---|---|
| `home.html`, `lesson.html` | The UI reference, built with the app's tokens, fonts, controls and Chalky. `?screen=ID` shows one frame |
| `shots/*.png` | Each reference frame as an image |
| `before/*.png` | The same screens in the app today |
| `approved/*.png` | Homework screens the student has already accepted. Learn must read as their sibling |
| `shoot.mjs` | Re-renders `shots/` (`node docs/redesign/learn-v2/shoot.mjs`) |
| `explorations/` | Everything tried on the way here. Not the reference; do not build from it |

## 1. Goal

Learn should give a student as many real "it clicked" moments as possible per minute, teach ideas intuitively, raise their score on the real exam, and feel like a lesson with a personal tutor.

## 2. The evidence this is built on

Each row is a rule the plan implements. Do not add features the table doesn't call for.

| Rule | Evidence | Where it lands |
|---|---|---|
| The student attempts before being told | Self-generated solutions were re-solved 78% of the time a week later, against 41% when shown (Kizilirmak 2016) | Prediction before any visual (A5) |
| Hints, never answers; the student tries first | Plain GPT-4 raised practice scores 48% and lowered the unassisted exam 17%; a hint-only tutor avoided the harm (Bastani 2025). Students who abuse hints learn far less (Baker 2004) | Hint gate (A5) |
| Topics come back after a gap that scales with the time left | Best gap is about 20–40% of the days to the test at one week, about 20% at 5–10 weeks; too long costs less than too short (Cepeda 2008). Expanding re-tests (Rawson & Dunlosky 2011) | Review dates (A4) |
| Mix earlier topics into each session | Mixed practice 61% against 38% a month later (Rohrer 2020) | Lesson opens with what's coming back (A4) |
| Mastery is unaided success on a later day | Three right in a row predicts the next item but only half pass a transfer question (Kelly 2015) | "Solid" needs another day (A2) |
| Worked examples for novices, questions for everyone else | Barbieri 2023; expertise reversal (Kalyuga 2003) | Worked steps (A5) |
| Feedback that explains beats right/wrong, and belongs next to the answer | Effect about 0.49 against 0.05 (Van der Kleij 2015); spatial contiguity (Ginns 2006) | Marked explanations (A3); feedback under the answer (C2) |
| Predict, see it fail, explain | Refutation beats clear exposition (Muller 2008); a demo without a prediction teaches about nothing (Crouch 2004) | Prediction before any visual (A5) |
| Judge by delayed unaided answers, not by how the session felt | Deslauriers 2019; Kornell & Bjork 2008 | What we report (D) |

Wrong ideas produce the same "aha" feeling as right ones (Danek & Wiley 2017). So every claimed "it clicked" must be backed by a later unaided right answer (A6).

## 3. What exists today

Three separate agents run Learn, each a Pi session with its own prompt and a fixed tool list:

| Agent | Code | Tools |
|---|---|---|
| Learn chat ("Hey Chalky…" on Learn home) | `ConversationCoordinator`, target `{kind:"learn"}`; prompt in `desktop/agent-system/packs/roles/learn` | notes, connected apps, `learn_set_exam`, `learn_start_session`, `learn_import_source` |
| Tutor (a lesson) | `desktop/electron/agent/tutor-coordinator.ts`; prompt is `TUTOR_SYSTEM_PROMPT` in `tutor-tools.ts:7` | eight `tutor_*` tools |
| Syllabus reader | `desktop/electron/agent/learn-extraction.ts` | `learn_record_source` |

This plan changes only the tutor and the two Learn screens.

How a lesson runs:

1. `TutorCoordinator.start` (`tutor-coordinator.ts:35`) creates the session in SQLite (`LearnRepository.startSession`, `learn-records.ts:245`) and launches a Pi session.
2. The first prompt carries the lesson context (`buildTutorContext`, `tutor-context.ts:39`), the study-folder notes and the saved session (`tutor-coordinator.ts:144`).
3. Every tool call becomes a saved block (`openBlock`, `learn-records.ts:307`). Ask, model and page tools wait inside `#execute` (`tutor-coordinator.ts:164`) until the student answers (`answerBlock`, `learn-records.ts:349`).
4. A message from the student mid-question (`send`, `tutor-coordinator.ts`) aborts the waiting turn and starts a fresh one from the saved state.
5. `tutor_finish` (`finish`, `learn-records.ts:403`) is the only place a level changes.
6. The renderer never sees answer keys, accept lists, rubrics or unrevealed hints (`publicTutorSession`, `shared/tutor.ts:143`).

The lesson is already unscripted: Chalky decides each step after seeing what the student did. What it cannot do today is keep anything on screen, change it, or answer the student anywhere but in the next lesson line.

Measured on the 25 Sep simulated-student run (`.studi-harness/tutor/2026-09-25T20-58-38.672Z`):

- All three students finished at level 1, including the strong one who got 3 of 3 right.
- The wait between an answer and Chalky's reply had a median of 5–7 seconds, up to 15.
- The judge scored 5 of 5 on nearly every item, so the rubric no longer separates good from bad.

## 4. Settled decisions

Don't reopen these.

- **The lesson is a whiteboard with a side chat.** Chalky and the conversation are in a panel on the left; the board holds only the work.
- **Answering and talking are separate.** The student answers on the board. The chat box is only for talking to Chalky and never counts as an answer.
- **Chalky never gives positions or sizes.** It says what a thing is and, at most, what it belongs under. The app lays the board out.
- **Colour.** The question is black. Purple is only for what Chalky adds: its notes, its ticks and circles, and what it draws on a picture. The student and the data are black plain type. Yellow marks only the newest thing on the board. Nothing in a lesson is red.
- **Chalky marks answers itself, in the same turn,** through `tutor_grade`. A separate grader session would add seconds to every wait. The simulated-student run reports how often an independent judge agrees.
- **No new lesson step.** The questions on earlier topics are part of Check.
- **No prediction tool.** A prediction is an ordinary question asked before a visual.
- **`plan.path` is deleted.** It is computed and never drawn.
- **Levels stay 0–4** with the same words: Not yet, Shaky, Getting there, Good, Solid. Readiness maths is unchanged.
- **Home is a list that opens in place.** No separate page per goal, no cards, nothing open by default.
- **Numbers the app owns are rules; teaching judgment stays in the prompt.** Don't add gates on how many questions Chalky must ask.

## 5. Order of work

| Round | Steps | Touches |
|---|---|---|
| A: lesson rules | A1 to A7 | `desktop/shared`, `desktop/electron`, tests |
| B: the board | B1 to B7 | `desktop/shared`, `desktop/electron`, tests |
| C: screens | C0 to C5 | `desktop/src/app`, `desktop/src/preview`, one journey |
| D: measuring | D1 to D3 | telemetry, `agent-harness/tutor` |

After every step: `bun run typecheck` and the storage and agent suites pass. Change an existing test when its expectation is about something this plan deliberately changes; add a test only where a step names one. Part E says how each round is checked before the next begins.

Rounds A and B do not change what the student sees much: the current lesson screen keeps working, showing new fields only where it already has a place for them.

---

# Part A: lesson rules

## A1. A session that runs out of time still counts

**Today.** When the budget ends, a timer marks the session `expired` and aborts the agent (`tutor-coordinator.ts:127`). `tutor_finish` never runs, so the level, the progress note and the cheat sheet are all lost. Chalky also never sees the clock after launch.

**Change.**

1. Add `TUTOR_WRAP_SECONDS = 90` to `shared/tutor.ts`. A session may live that long past its budget, only to finish.
2. Every tutor tool result carries `secondsLeft` (whole seconds, never below 0). The launch prompt states it too.
3. When the budget reaches zero:
   - the open block, if any, is closed as `cancelled`;
   - the waiting tool call returns `{ timeUp: true }` with the text "Time is up. Call tutor_finish now with the evidence so far.";
   - `openBlock` rejects every tool except `tutor_finish` and `tutor_grade` with the same text.
4. `finish` is allowed during the 90 seconds. If it doesn't arrive, the session expires exactly as it does today.
5. `state()` (`learn-records.ts:279`) and `transition()` (`:288`) expire a session only after budget plus wrap time. `tutorTimeLeft` keeps returning 0 past the budget; `elapsedSeconds` never exceeds the budget.

**Tests.** Rewrite "expiry and cancellation preserve answers without awarding mastery" (`tests/storage/learn-tutor.test.mjs:189`) into two cases: finishing inside the wrap window saves the level; no finish inside it expires with no level. In `tests/agent/learn-tutor.test.mjs` add one case: a waiting tool call returns `timeUp` when the budget ends and a following `tutor_finish` completes the session.

**Done when** a session whose clock runs out mid-question ends as `completed` with a result.

## A2. Levels that mean something

**Today.** `learn-records.ts:437` caps every session at one step up from the level at its start, and an unchecked topic starts from 0. A student who already knows a topic needs four sessions to show it.

**Change, in `finish`:**

- **First session on a topic** (its entry in `session.initialLevels` is null): Chalky may place the student at 0 to 3. It still needs at least one unaided right answer to go above 0.
- **Later sessions:** at most one step up, as today.
- **Level 4 ("Solid")** is granted only when the topic already has an unaided right answer saved at least 18 hours earlier. Otherwise the result is capped at 3.
- Lowering is unchanged: one step down, only with a wrong unaided answer.

**Prompt.** Replace the level sentence (see Prompt changes).

**Tests.** Update "only eligible evidence changes mastery, capped once…" (`:158`): first placement can reach 3; a second session the same day cannot reach 4; a session a day later can.

**Done when** the strong simulated student ends its first session at 2 or 3.

## A3. Every answer is marked, once, where the student can see it

**Today.**

- Typed answers are an exact match (`typedAnswerMatches`, `shared/tutor.ts:117`). "it's 4" fails against "4", "0.5" fails against "1/2", and Chalky cannot overturn it.
- Explanations get no verdict until `tutor_finish`, where Chalky supplies `correct` for each cited block. The student never sees which points they hit.

**Change.**

1. **Typed matching** accepts, before giving up:
   - a lead-in before the answer ("it's", "i get", "i think", "about", "roughly", "=", "x =", "answer:");
   - numbers that are equal: `0.5`, `1/2`, `.5`, `50%` against `0.5`. A bare `50` does not equal `50%`.
2. **New tool `tutor_grade`** `{ blockId, correct: boolean, met?: boolean[], equivalentTo?: string }`. Like `tutor_advance` it is not a block; `#execute` routes it to a new `LearnRepository.grade`.
   - **Explanation blocks:** `met` is required, one entry per rubric item in order. Saves `result.correct` and `result.met`.
   - **Typed blocks:** allowed only when the app's verdict is wrong. `correct: true` needs `equivalentTo` equal to one of the block's `accept` entries. Saves `result.correct = true`. A right answer can never be changed to wrong.
   - Any other block: rejected.
3. **Order rule.** While an answered explanation has `result.correct === null`, `openBlock` rejects new ask, model and page blocks and `finish`, with "Mark the explanation with tutor_grade first". `tutor_say` is still allowed, so Chalky can reply and mark in either order.
4. **`tutor_finish` evidence** drops `correct`: each item is `{ blockId, rationale }` and the app uses the saved verdict. Delete the "cannot be overridden" check.
5. **Tool results** for typed answers add `matched: boolean`, so Chalky knows whether the app or it decided.
6. **Public state** (`publicTutorSession`): an explanation block exposes `points: { text, met }[]` once it is marked, built from the rubric and `met`. Before that it exposes nothing about the rubric, as today.

**Prompt.** See Prompt changes: rubric items are written as short plain statements because the student will read them.

**Tests.** Extend the two typed-answer tests (`:357`, `:364`) with the lead-in and number cases. Add one storage test for the marking rules: an explanation must be marked before the next question; a typed answer can only be raised, and only by naming an accepted answer; rubric text stays private until marked.

**Done when** "it's 4" is right against "4", and an explanation shows its points with ticks as soon as Chalky marks it.

## A4. Topics come back, mixed into the next lesson

**Today.** One recap falls due three days after the last finished session, on that session's topic only (`planLearn`, `shared/learn.ts:112`). Earlier topics never return unless they become the biggest gap. Sessions cover one topic.

**Change.**

1. **Data.** `TopicMasterySchema` (`shared/learn.ts:46`) gains `review: { dueOn, gapDays, lastRightOn } | null`, default null. `masterySummaries` (`learn-records.ts:58`) includes it.
2. **One pure function** in `shared/learn.ts`, `nextReview(previous, { today, examDate, right })`, called from `finish` for every assessed topic that has evidence. `right` means at least one unaided right answer and no wrong one.

   | Case | New gap in days |
   |---|---|
   | Right, and it had no review or the last result was a miss | With an exam date: a quarter of the days left, at least 1, at most 14. Without one: 2 |
   | Right, and it was due | Double the previous gap, at most 30 |
   | Right, and it was not due yet | No change |
   | Not right | 1 |

   `dueOn` is today plus the gap. If that lands on or after the exam and the exam is more than a day away, use the day before the exam.
3. **Planner.** `planLearn` returns:

   | Field | Meaning |
   |---|---|
   | `leadExam`, `readiness` | Unchanged |
   | `todayTopic` | The biggest weighted gap among topics that are below Good or unchecked and not resting (`review` null or due). Null when there is none |
   | `comingBack` | Topics at Good or Solid whose `dueOn` is today or earlier, most overdue first |
   | `topicsLeft` | How many topics are below Good or unchecked |

   Delete `recapDue`, `recapTopic` and `path` from `LearnPlan`, `LearnPlanSchema` (`shared/learn-state.ts:4`) and every caller.

   The home page runs `planLearn` once per goal in the renderer to build its rows, so keep it pure and cheap.
4. **Session start.** For `topic` and `recap` sessions the coordinator adds the goal's `comingBack` topics to `topicIds`: up to 3 for a topic session, up to 5 more for a recap. Relax the "exactly one topic" check (`learn-records.ts:255`) to allow them. Mock exams are unchanged.
5. **Context.** `buildTutorContext` marks each topic `role: "today" | "comingBack"` and gives `lastRightOn`.
6. **A recap** is now "everything that's coming back": it is offered only when there is no `todayTopic` but `comingBack` is not empty.

**Prompt.** See Prompt changes (Check opens with what's coming back).

**Tests.** Rewrite "planner orders gaps, schedules mock two days before, and recap is due after three days" (`:121`) for the new plan fields. Add one test for `nextReview` covering the four table rows and the day-before-exam cap.

**Done when** a second session two days after the first opens with a question on the first session's topic, and finishing it moves that topic's `dueOn`.

## A5. Three teaching moves

1. **Worked steps.** Add optional `steps: string[]` (at most 6, each at most 300 characters) to `TutorSayInputSchema`, `TutorTypedInputSchema` and `TutorExplainInputSchema` (`shared/tutor.ts:14`, `:20`, `:21`). On a say it is a worked example. On a question it is the steps already done for the student. Public schemas pass it through.
2. **Prediction before a visual.** Prompt only (see Prompt changes). No schema change and no app gate.
3. **Hints need a try.** `hint` (`learn-records.ts:370`): the first hint is free. A later hint is rejected with "Type your best try first." while the block's saved draft is empty. The renderer already flushes the draft before every action.

**Tests.** Extend "one open block, immutable answers and drafts…" (`:134`) with the hint rule.

## A6. The finish carries what clicked

**Change.**

1. `TutorFinishInputSchema` (`shared/tutor.ts:36`) gains `clicked?: { before, after, wrongBlockId, rightBlockId }[]`, at most 2; `before` and `after` at most 200 characters.
2. `finish` keeps an entry only when:
   - `wrongBlockId` is an answered block in this session whose saved verdict is wrong; and
   - `rightBlockId` is a later typed or explanation block in On your own, right, with no hints.

   Entries that fail are dropped silently; the finish still succeeds.
3. `TutorSessionResultSchema` (`:80`) gains `clicked: { before, after }[]`, `cheatsheet: string[]`, and `dueOn` on each entry of `assessments`.
4. The public finish block exposes `clicked` and `cheatsheet` alongside summary, missing and next.

**Tests.** One storage test: a `clicked` entry survives only with a wrong block followed by an unaided right one.

## A7. Cleanup in the same round

- `TutorCoordinator.#start` with a free `topic` (`tutor-coordinator.ts:35`) calls `createFreeTopic`, which makes a topic that belongs to no goal and appears nowhere. Make it create, or reuse, a goal of kind `topic` with that title, as the "Learn something new" form does, and start on its first topic.
- Delete `desktop/agent-system/packs/roles/tutor/instructions.md` and the `{kind:"tutor"}` branches that only serve it, if nothing else uses them. If something does, leave them and say so.
- `desktop/electron/agent/LEARN-INTEGRATION.md` says the tutor has six tools and describes the old recap. Correct it or delete the stale lines.

---

# Part B: the board

Today a lesson is a line of blocks, one open at a time, and each new block replaces the last on screen. This part gives Chalky a board it can keep working on, and a place to answer the student. Everything is still fixed tools with validated arguments; Chalky still writes no layout.

After this part the tutor has twelve tools: `tutor_say`, `tutor_reply`, `tutor_ask_choice`, `tutor_ask_typed`, `tutor_ask_explain`, `tutor_show_model`, `tutor_show_page`, `tutor_update`, `tutor_erase`, `tutor_grade`, `tutor_advance`, `tutor_finish`.

## B1. Chalky can answer in the chat

**Today.** A message from the student restarts Chalky's turn, and Chalky answers with `tutor_say`, which is also how it writes lesson lines. The student's own message is never shown.

**Change.**

1. New tool `tutor_reply { text }` (at most 600 characters). It is saved as a block with `status: "complete"` and `replyTo`, the id of the newest student message that has no reply yet. With no such message it is rejected: "Nothing to reply to. Write on the board with tutor_say."
2. `tutor_say` keeps its meaning: a note written on the board. Its two-in-a-row limit does not count replies.
3. The public session exposes the student's messages (`messageId`, `text`, `createdAt`) so the screen can show both sides in order.

**Tests.** One agent test: a message mid-question followed by `tutor_reply` leaves the question open, records `replyTo`, and a second `tutor_reply` with nothing new to answer is rejected.

## B2. Things stay on the board

**Today.** A model or page is one block: it appears, the student presses "I've tried it", and it is gone.

**Change.**

1. `tutor_show_model` and `tutor_show_page` gain `wait?: boolean`, default `true` (today's behaviour). With `wait: false` the visual goes up and the call returns at once with its `blockId`, so Chalky can ask a question while it stays up and usable.
2. A visual is **up** from when it is shown until it is erased, replaced, or the board is cleared. The block gains `erasedAt: timestamp | null`.
3. What the student does with a visual that is up (`explored`) is saved on its block and included in the result of their next answer.
4. `tutor_show_model` and `tutor_show_page` gain `under?: blockId`: this thing belongs under that visual (a table of values under the graph it came from). It must name a visual that is up.
5. **Capacity.** At most two top-level visuals are up at once, each with at most two things under it. One more is rejected: "The board is full. Erase or replace something first."
6. The board is cleared of visuals automatically when the lesson advances to On your own and when it finishes.

**Tests.** One storage test: a visual shown with `wait: false` stays up across a question and its answer; a third top-level visual is rejected; advancing to On your own clears them.

## B3. Chalky can change and erase what's up

1. New tool `tutor_update { id, args }`. `id` must be a visual that is up. `args` replaces its arguments and must validate against the same tool and the same model. The block gains `updatedAt`.
2. New tool `tutor_erase { id }`. Sets `erasedAt`. Erasing a visual erases what is under it.
3. Neither tool waits for the student.

**Tests.** One storage test: an update that changes the model type is rejected; an update of an erased visual is rejected; erasing a parent erases its children.

## B4. More than one try at a question

**Today.** A wrong answer closes the block. To ask again Chalky must open a new one, which the screen would show as a new question.

**Change.**

1. When the newest question block is answered wrong and Chalky repeats that exact tool and arguments, the block reopens for another try, up to three tries.
2. The block gains `attempts: { answer, correct, hintsUsed, seconds }[]`. `result` is always the newest.
3. Only the first try can be cited as unaided evidence in `tutor_finish`. A later right answer counts as "with help", like a hinted one.
4. The ask tools gain `note?: string` (at most 300 characters): the standing line under the question, such as what the picture shows. It stays for every try.

**Tests.** Extend "one open block, immutable answers…": a repeated ask after a wrong answer reopens the block and keeps the first try; a fourth try is rejected; citing a second-try answer as evidence is rejected.

## B5. Two additions to the built-in visuals

1. **A table.** `{ model: "table", params: { columns: string[] (at most 8), rows: (string | number)[][] (at most 8) }, controls: [] }`. No interaction.
2. **The function plot** gains optional `secant: { x, gap }` with the control `"gap"`, and optional `labels: { x, text }[]` (at most 4). The lesson in the reference needs both: a line through two points on a curve whose gap the student shrinks, and a label Chalky adds when asked what "the gap" is.

Every built-in visual and every page Chalky writes is drawn in the board's style: plain type for labels and numbers, pencil for the figure, Chalky's purple for what Chalky adds. For pages, `shared/study-page.ts` gives the page the board's fonts and colours as CSS variables and a base style sheet.

**Tests.** Extend "all five fixed model types are bounded…" for the table and the two new plot fields.

## B6. A new question folds the last one

No engine change; this is a rule for B7 and the screen. When the student moves on to a different question, the previous question folds into one line (the question, the final answer, right or not). Visuals that are up stay up.

**As built.** What Chalky wrote after the student's last answer stays up above the next question, because that is where the bridge to it is written. Notes written between tries were about a wrong answer, so they fold with the question.

## B7. One description of the board for the screen and the tests

Add a pure function `boardView(session, at?)` to `shared/tutor.ts`. It turns the public session into what the screen draws, so the layout rules live in one tested place.

**As built.** The lesson is a line of **stops**: a question, or a visual that waits for the student. Chalky can be a stop ahead of the student, so the function takes `at`, the stop the student is on (the newest when left out), and the screen moves `at` forward only when the student presses Next. A visual that has been tried has nothing left to read, so the screen moves on from it by itself.

| Field | What it holds |
|---|---|
| `at`, `following` | This stop's id, and the next stop's once Chalky has made one |
| `done` | Questions before this stop, oldest first: question text, final answer, right or not |
| `lead` | Chalky's notes since the student's last answer: what leads into this stop |
| `question` | This stop's question block, or null when the stop is a visual to try |
| `note` | Its standing line |
| `visuals` | Visuals that are up, in the order shown, each with the things under it |
| `tries` | Earlier tries at the current question |
| `feedback` | Chalky's notes since the student's latest try at this stop; notes about an earlier try go with it |
| `newest` | The id of the most recently added or updated thing, cleared by the student's next action |
| `chat` | Student messages and Chalky's replies, oldest first |
| `move` | What the one button does now: `check`, `tried`, `next` (a later stop exists), `finish` (the lesson has ended), or `wait` (Chalky is writing) |

**Tests.** A small table of cases for `boardView`: a fresh question; a visual kept up across two questions; a wrong try then a right one; a chat exchange mid-question; an erased visual; a visual that waits as a stop of its own; the student staying on a question while Chalky is ahead, and the last question folding when they move on.

**Done when** the simulated-student run shows at least one lesson where Chalky replied in chat, updated a visual instead of redrawing it, and let a student try again, with the board never over capacity.

---

# Part C: screens

Build from `home.html` and `lesson.html`. Where this text and the reference disagree, the reference wins on layout and this text wins on behaviour. The UI is fixed and only its content changes: every word of a question, a reply or a level comes from real session data.

`approved/` holds the homework screens the student has already accepted. Learn must read as their sibling: the same hello row, the same rows, the same buttons, the same type.

Take a screenshot of each new preview scenario, compare it to the matching file in `shots/`, fix, and take one more round at most.

## C0. The rules this design follows

Several earlier versions of these screens were rejected, and an independent audit scored the last one 6 out of 10 (`explorations/final/AUDIT-fable.md`). Each row is a mistake already made and the rule it became. Check every screen against them.

| What was wrong | Rule |
|---|---|
| The home page was one test's page; other goals were a footnote | Home is a list of every goal, tests and things for yourself alike, with one suggestion above it |
| Detail was always open | Detail opens on click, in place, one row at a time |
| The board was split into words on the left and a drawing on the right | The board is one column. Everything on it starts on the same left edge |
| Things sat at unrelated positions and sizes | One order, top to bottom: question, standing note, visuals, answer, feedback. A visual is the full column wide and keeps one size |
| The student's messages were invisible and Chalky's reply overwrote its last line | Both sides of the conversation stay in the side chat. Replies never touch the board's notes |
| The answer blank was weaker than the chat box | The answer is a real field, focused when a question is up, and the strongest control on the board |
| Chalky was small and moved around | Chalky has one fixed home, at the top of the side chat, at 112px |
| A wrong answer vanished | The try stays, struck through, beside a fresh field |
| Purple, black and yellow each meant several things, and a board that was all purple looked odd | The question is black. Purple is only Chalky's notes and marks. Yellow is the newest thing only |
| Everything was handwritten at one size, including numbers and fractions | Handwriting is Chalky's voice only. Labels, numbers, options and maths are plain type; fractions are stacked |
| Grey text was too faint | Grey is `#6b6359` or darker on the board |

Type:

| Role | Face and size |
|---|---|
| Home headline | Shantell Sans 700, 28px |
| The question on the board | Shantell Sans 700, 26px, `--pencil` |
| Chalky's notes on the board | Shantell Sans 500, 20px, in Chalky's purple |
| Labels on the board | Nunito Sans 600, 15px, `#6b6359` |
| Data, options, the student's answer | Nunito Sans, 16 to 24px, tabular figures |
| The side chat | Nunito Sans 400, 15 to 16px |

Chalky's purple is a new token, `--ink-chalky: #5a4691`.

## C1. Learn home (`LearnScreen.tsx`, `learn.css`)

Reference: `home.html`, `shots/home.png`, `home-test.png`, `home-self.png`, `home-new.png`, `home-empty.png`. Today: `before/learn.png`.

**What the student thinks on landing:** "What have I got coming, and what should I do now?"

**Structure** (column 752px, the existing `rd-column`):

1. **Hello row**, the same grid as the Week page's (`hw-hello`, `homework.css:3`): Chalky at 64px, the headline with one sentence under it, and the one filled button on the right.
2. **"Tests"**: one row per test in `orderGoals` order, then "+ Add a test".
3. **"For yourself"** with the caption "No test, no deadline.": one row per goal of kind `topic`, then "+ Learn something new". This group is always shown, even when empty.
4. The chat box, floating at the bottom as on the Week page.

**A row** (`lr-row`), the same for both groups:

| Part | A test | Something for yourself |
|---|---|---|
| Left edge | 3px in the class colour (`courseTone`) | 3px in `--blot2` |
| Title | The test's name | The goal's name |
| Under it | "{class code} · Next: **{topic}**" | "Next: **{topic}**" |
| Middle | The strip | The strip |
| Right, bold | "6 days", "Tomorrow", "Today", "No date" | "{N} sessions" or "New" |
| Right, small | "Mon, Oct 6" | "last Tuesday" |

- With no topics yet, the line under the title says what's needed ("Tell me what's on it", "Starts with a 5 minute check") and there is no strip.
- **The strip** is one mark per topic in outline order. The fill is pencil at 12, 28, 48, 72 and 100% for levels 0 to 4, and a hollow outline for an unchecked topic. Give it an `aria-label` in words ("2 of 5 topics Good or better").
- Hover washes the row. There are no boxes and no lines between rows.

**The suggestion at the top.** The renderer runs `planLearn` once per goal (it is a pure shared function), then takes the first goal in `orderGoals` order that has, in this order of preference: an open session, a `todayTopic`, or any `comingBack`.

| Case | Headline | Sentence | Button |
|---|---|---|---|
| Open session | as below for that goal | "You're partway through {topic}. Your answers are saved." | "Continue" |
| `todayTopic` on a dated test | "{Test} is in N days." / "is tomorrow." / "is today." | "Next up is **{topic}**, {your biggest gap / not checked yet}. {We'll start with N quick ones from earlier.}" | "Start · 15 min" |
| `todayTopic` on an undated test or a goal for yourself | "{Goal}." | "Next up is **{topic}**." | "Start · 15 min" |
| Only `comingBack` | as above for that goal | "Nothing new today. {N} topics are coming back for a quick check." | "Start · 5 min" |
| Nothing anywhere | "Nothing to do today." | "Next is **{topic}** in {goal}, {tomorrow / on Thursday}." | none |
| No goals | "What do you want to learn?" | see first run | none |

When two tests share a name, put the class code in front ("CSC 316 Midterm is in 12 days.").

**Opening a row** (`shots/home-test.png`, `home-self.png`). Clicking a row opens it in place and closes any other; clicking it again closes it. The open goal sits on a sheet (`lr-open`: `--page`, radius 16, the app's lift shadow) with its row as the heading. Under it:

1. **One line and "Change".** For a test: the pace line. For yourself: "Your outline. Chalky suggested it after your first check; change it any time." "Change" opens today's edit form (name, class, date, scope note, topics, remove) in the same sheet, and gains "Find more in class".
2. **Topic rows**, divided by hairlines: name, share of the test when every topic has one, the four level marks, the level word, and "Practise" on hover or keyboard focus.
   - The next topic has the highlighter under its name and an outlined "Start · 15 min" that is always visible.
   - A topic whose `dueOn` is today or tomorrow gets a second line: "Last right N days ago. Coming back today." or "Coming back tomorrow."
3. **Label, value, way in** (`lr-more`):
   - "Test yourself": tests with 1 to 30 topics only.
   - "Cheat sheet": only when it has lines or pages. Opens the existing sheet dialog with the lines of `CHEATSHEET.md` in file order and the saved study pages.
   - "Studying from": the sources, with "Add a file".
   - "From homework Dot did": as today, only when there are any.

The page has one filled button, in the hello row.

**Pace line**, from `topicsLeft` (T) and whole days to the test (D):

| Case | Line |
|---|---|
| No date | "T topics to go." |
| T is 0 | "About N% ready." when readiness is known, otherwise "Every topic is Good or better." |
| T ≤ D | "T topics to go. One a day leaves you {D − T} days spare." With nothing spare: "One a day gets you there." |
| T > D, D ≥ 1 | "T topics to go in D days: {ceil(T ÷ D)} a day." |
| D is 0 | "T topics to go, and it's today." |

**Adding** (`shots/home-new.png`). The add row opens the same sheet in its place.

- "+ Learn something new": two fields ("The thing", "Why, or how far, if you like"), then filled "Start with a 5 minute check", quiet "Just add it for later", plain "Cancel". Beside them, the three "What happens" steps. This is today's `SomethingElse` form.
- "+ Add a test": today's intake (drop a syllabus or study guide, type what you know, "Find my tests") and the name, class and date fields.

**First run** (`shots/home-empty.png`): the hello row with no button, then two doors of equal size, "A test that's coming up" and "Something for yourself".

**Learning outside school must never be a dead end.** Three ways in, all ending in a row under "For yourself":

1. "+ Learn something new".
2. The second door on the first-run page.
3. Asking in the chat box ("teach me how mortgages work"). Today `tutor.start({ topic })` makes a topic with no goal (`createFreeTopic`, `learn-records.ts:219`), which appears nowhere. Make it create, or reuse, a goal of kind `topic` with that title, exactly as the form does.

**IPC for the cheat sheet**, added through the registry in `desktop/shared/ipc.ts`:

| Method | Returns |
|---|---|
| `getLearnNotes({ examId })` | `{ cheatsheet: string[], pages: { name, title, date }[] }` |
| `readLearnPage({ examId, name })` | The saved page document. `name` must be one of the names `getLearnNotes` listed; reject anything else |

Fetch the notes when a row opens and on returning from a lesson, not on the 2.5 second poll.

## C2. Lesson: the board and the side chat (`TutorScreen.tsx`, `learn.css`)

Reference: `lesson.html`, `shots/lesson-*.png`. Today: `before/tutor-choice.png`, `before/tutor-typed.png`.

**What the student thinks:** "What am I being asked, where do I answer, and can I ask my tutor?"

Draw everything from `boardView(session)` (B7). The screen makes no layout decisions of its own beyond the rules below.

**Three regions.**

| Region | Holds |
|---|---|
| Top bar, 56px | "← Learn"; the topic and the goal; five marks with "Step 2 of 5 · Learn"; minutes left, only in the last three minutes (a clock running the whole lesson read as a deadline); "Pause" |
| Side chat, 300px on the left | Chalky at 112px with its name; the conversation; the chat box |
| The board, the rest | One column, 720px, centred on the board |

**The board, top to bottom.** One column; every item starts on its left edge.

1. **Finished questions,** each folded to one line: a tick or a dash, the question, the final answer, and "Show" to reopen it (`shots/lesson-steps.png`). One finished question is shown as a line; with more, a single "N earlier questions" line opens the list.
2. **What Chalky wrote since the last answer** (`lead`), in Chalky's hand at 20px.
3. **The question,** in Chalky's hand at 26px, in black.
4. **The standing note** (`note`), in Chalky's hand at 20px. For a question on an earlier topic, a grey label instead: the topic and "you last got this right N days ago".
5. **Visuals,** in the order shown. Each is the full column wide. A graph is 230px tall; with two visuals up, each is 170px. A visual keeps its size for as long as it is up. Things under a visual (its control row, a table) sit directly beneath it.
6. **The answer row:** the label "Your answer", any earlier tries struck through, the field, the button, then "Hint" when the question has hints left.
7. **Chalky's feedback** on the answer, in Chalky's hand, directly under the answer row.

When the board is taller than its frame it scrolls, and the answer row is brought into view when something is added. It never scrolls while the student is typing or dragging.

**The newest thing** on the board (`newest`) has a yellow highlight. Only one thing is highlighted at a time, and it clears on the student's next action.

**Ways to answer.**

| Kind | Looks like | Reference |
|---|---|---|
| Typed | A field 190 by 50px with a 2px pencil outline; focused, it gains a lavender ring and a caret. Enter presses Check | `lesson-question.png` |
| Pick one | A lettered list in plain type. Clicking a line or pressing its letter picks it; the letter fills in black. Check commits it | `lesson-pick.png` |
| Explain | A text box at least 104px tall. Once sent it stays on the board in plain type, and after Chalky marks it each rubric point follows with a tick or a dash | `lesson-explain.png` |
| Worked steps with the last left open | Steps in plain type with stacked fractions; the field is in the open step | `lesson-steps.png` |
| Something to try | The visual's own controls. The button reads "I've tried it" and is disabled until the student has used the visual | |

**The one button** sits at the end of the answer row and never moves within a question. Its label comes from `move`:

| `move` | Button | Beside it |
|---|---|---|
| `check`, nothing entered | "Check", disabled | |
| `check` | "Check" | |
| `tried` | "I've tried it" | What's needed, when disabled |
| `wait` | "Check" or "Next", disabled | "Chalky is writing…" |
| `next` | "Next" | |
| `finish` | "See how you did" | |

- **Next is the screen's.** The engine already has the next question; the board turns to it only when the student presses Next. On reopening a lesson, go straight to the newest unanswered question.
- **A right answer** is circled and ticked in Chalky's ink (`lesson-right.png`). **A wrong one** stays, struck through, beside a fresh field (`lesson-wrong.png`); Chalky's note says why. After three tries, or when Chalky moves on, the button becomes Next.
- **Being marked:** while an explanation, or a typed answer the app couldn't match, waits for Chalky, the label beside it reads "Chalky is reading it…".
- **Hints:** "Hint", then "Show one step", then "Walk me through it". From the second on it is disabled, with "Type your best try first.", until something is typed. Hints appear under the answer row in Chalky's hand.

**The side chat.**

- **Chalky** sits at the top at 112px, with "Chalky" in its hand and "your tutor" under it. Its expression follows the lesson: asking, listening, thinking, explaining, pleased.
- **The conversation** fills the panel from the bottom up: the student's messages in a soft bubble on the right, Chalky's replies as plain text on the left. Older exchanges fade to 55% but stay readable, and the list scrolls. Empty, it shows one grey line: "Ask me anything while you work."
- **The chat box** is at the bottom of the panel: one row, text and a round send button. Sending never counts as an answer and never pauses the lesson. Once the lesson has ended the conversation stays readable but the box is closed, because the engine takes no messages for a finished session.
- Below 1000px of window width the panel moves under the board as one row: Chalky at 64px, the last exchange, and the chat box.

**Out of time.** The minutes read "Wrapping up…", the field and button are disabled, and the wrap-up follows.

**Keyboard and screen readers.** The field, the options, the button, the hint, the chat box and "Show" are real controls in that tab order. Chalky's notes and replies are announced when they arrive. Each visual has a text description. Chalky's animations play once per change of expression and then rest; they stop under `prefers-reduced-motion`.

## C3. Wrap-up (`WrapUp`, `TutorScreen.tsx:175`)

Reference: `shots/lesson-wrap.png`, `shots/lesson-quiz.png`. Today: `before/tutor-finished.png`, `before/tutor-quiz.png`.

The wrap-up is the last board. The side chat stays open for questions about the lesson.

**Lesson, in this order:**

1. The heading in Chalky's hand, in black: "That's today's session.", "Time's up for today." or "We stopped here."
2. **What clicked,** only when `result.clicked` has entries, in Chalky's hand: "Before" struck through, "Now" with the yellow highlight.
3. **Where you are:** one row per assessed topic in plain type: name, the four level marks, then "**{Level}**, up from {old}." or "still there after N days." and "Back on {day}."
4. **Added to your cheat sheet,** when there are lines.
5. **Still to practise,** when there are any.
6. The button "Back to Learn".

Drop the paragraph "One session moves it at most one step."

**Quiz:** the score in Chalky's hand at 44px, Chalky's one line, the by-topic rows with the weakest in bold, then "Study {weakest} · 15 min" and a quiet "Back to Learn".

## C4. The chat box on Learn home (`LearnConversation.tsx`, `composer.css`)

Reference: the box at the bottom of the home frames. Today: `before/learn.png`, `before/learn-chat.png`.

- One row: text and a round send button, exactly as on the Week page (`approved/week.png`). Remove the note-icon button (`LearnConversation.tsx:114`), the "Learn" tag (`:120`) and the suggestions (`:148`). They overlap the text today.
- The send button is quiet when the box is empty and nothing is running. It shows Stop only while a reply is running.
- The line showing Chalky's last message above the box stays, and is the way into the sheet.
- In the sheet, the box spans the sheet's width.

## C5. Preview scenarios and the journey

- Update `desktop/src/preview/learnFixtures.ts` for the new data: review dates, tries, a marked explanation, worked steps, visuals kept up, a chat exchange, `clicked`, cheat-sheet lines, two goals for yourself.
- Scenarios (`desktop/src/preview/scenarios.ts:7`): keep the existing ids working. Add one per reference frame: `learn-open`, `learn-self`, `learn-new`, `learn-sheet`, and `tutor-pick`, `tutor-question`, `tutor-asked`, `tutor-wrong`, `tutor-right`, `tutor-steps`, `tutor-explain`, `tutor-wrap`.
- `tests/ui/release-learning.journey.mjs` expects buttons that no longer exist ("Date wrong?", "Paste text"). Replace its contents with one journey for the new screens:
  1. Home lists tests and "For yourself"; nothing is open; Start is in the hello row.
  2. Clicking a row opens it in place; clicking another closes the first.
  3. "+ Learn something new" makes a row under "For yourself".
  4. In a lesson, the answer field has focus; Check is disabled until something is typed; pressing it shows the result at once.
  5. A wrong answer stays struck through beside a fresh field.
  6. A message typed in the chat box appears in the side chat, Chalky's reply appears under it, and the question is still open.
  7. A pick-one question needs a pick and then Check.
  8. Next shows the next question, and the last one is folded at the top; "Show" reopens it.
  9. The second hint is disabled until something is typed.
  10. The wrap-up shows "What clicked" and each topic's return day.

---

# Part D: measuring

Report these numbers. Do not turn any of them into a pass or fail gate.

## D1. One event per finished lesson

Add `studi_learn_session` to `desktop/shared/telemetry.ts`, captured in main when a session first becomes `completed`, `expired` or `cancelled`. Wire the coordinator's `onChange` option for this (`main.ts:1803`); it is not wired today.

| Property | Meaning |
|---|---|
| `mode`, `outcome`, `minutes` | Session kind, how it ended, active minutes |
| `questions`, `unaided_asked`, `unaided_right` | Counts from saved verdicts |
| `came_back_asked`, `came_back_right` | Earlier-topic questions: the delayed, unaided measure |
| `clicked` | Entries that survived A6 |
| `chat_messages`, `chat_replies` | What the student typed to Chalky, and how many got a reply |
| `second_tries` | Questions that needed more than one try |
| `level_before`, `level_after` | Main topic |
| `wait_median_s` | Median seconds from an answer to Chalky's next block |
| `score_share` | Quizzes only |

No answer text, question text or topic titles.

## D2. The simulated-student run (`agent-harness/tutor/run.mjs`)

Add to the printed summary:

- the level each student was placed at;
- the share of models and pages that came straight after a committed answer;
- how often the judge, marking each explanation blind against the rubric, agrees with `tutor_grade`;
- whether the session finished before time ran out.

Add one run: a returning student whose saved mastery has two topics due. Report whether both were asked in Check and whether their dates moved.

The README says a missed gate exits nonzero. Make the run print and exit zero unless a student could not run.

## D3. Reasoning effort

The tutor runs at the app's chosen effort, default "high" (`desktop/shared/agent-runtime.ts:90`, used at `runtime.ts:303`). Run D2 at "high" and at "medium" and report judge scores and the median wait for each. Change nothing; the result decides a later step.

Also add to the simulated-student summary, for Part B:

- how many chat messages got a `tutor_reply`;
- how often Chalky updated a visual that was up, against showing a new one;
- how many questions had more than one try, and whether the board ever hit capacity.

---

# Part E: how this is tested

Six layers, cheapest first. A round is not done until its layers pass or what could not be run is written down.

| Layer | What it proves | How | Rounds |
|---|---|---|---|
| 1. Rule tests | Each app-owned rule holds: time-outs, levels, marking, review dates, hints, tries, capacity, replies | The storage and agent suites, with the cases each step names. `timeout 580 node --test --test-timeout=60000 "tests/storage/*.test.mjs" "tests/agent/*.test.mjs" "tests/contracts/*.test.mjs" "tests/telemetry/*.test.mjs"` | A, B, D |
| 2. Board description tests | The screen will be told the right thing to draw | The table of cases for `boardView` (B7). No browser needed | B |
| 3. Screens against the reference | Each state looks like its reference | One preview scenario per reference frame, screenshotted at 1280×800 and at 1000×720 with `.agents/tmp/shots.mjs`, and compared by eye with `shots/` | C |
| 4. The flow, clicked through | The screens work together | The journey in C5, run with `node .agents/tmp/journeys.mjs tests/ui/release-learning.journey.mjs` | C |
| 5. Chalky teaching, simulated | The real tutor uses the board and the rules as intended | `node agent-harness/tutor/run.mjs`: three simulated students plus a returning one, with the numbers in Part D | A, B, D |
| 6. A real lesson | It works end to end with a real model in the real app | The checklist below, in the desktop app (`.agents/skills/test-studi/SKILL.md`, full-app tier). Needs a signed-in provider; if that isn't available, say so and list it as unverified | C |

Two checks at the very end:

- **A blind design audit.** Give a fresh Claude Code session (Fable 5.1, high effort) only the screenshots of the built screens and the brief used for `explorations/final/AUDIT-fable.md`. Record the score. None of that audit's first five problems may come back.
- **A keyboard pass.** Take one whole lesson without the mouse: answer, ask in chat, use a hint, move on, finish.

**What is checked at the end of each round.**

| Round | Before the next round starts |
|---|---|
| A | Layers 1 and 5 pass. In the run: the strong student is placed at 2 or 3; a session that runs out of time finishes with a result; the returning student is asked both due topics |
| B | Layers 1, 2 and 5 pass. In the run: at least one lesson with a chat reply, a visual updated in place and a second try; the board never over capacity |
| C | Layers 3, 4 and 6, the blind audit and the keyboard pass. The student reviews the screenshots |
| D | Layer 1 for the event; the run prints every number in Part D and exits zero |

**The real-lesson checklist** (layer 6, and the walk-throughs for layer 4 where a fixture can show them):

| # | Do this | Expect |
|---|---|---|
| 1 | Start a first lesson on a topic and answer Check and On your own right | Ends at Good, not Shaky |
| 2 | Start another topic's lesson two days later | It opens with a question on the first topic; getting it right makes that topic Solid and moves its return day |
| 3 | Type "it's 0.5" where "1/2" is accepted | Marked right at once |
| 4 | Type an answer that means the same but doesn't match | "Chalky is reading it…", then right, with no wrong mark shown in between |
| 5 | Explain an idea in your own words | Your words, then each point with a tick or a dash, then Chalky's note |
| 6 | Let the clock run out mid-question | "Wrapping up…", then a wrap-up with a level |
| 7 | Answer a question wrong | Your try stays struck through; the field is free again; Chalky's note is under it; the picture did not change size |
| 8 | Ask something in the chat box mid-question | Your message and Chalky's reply are in the side chat; the question is still open; if Chalky changed the board, only that change is highlighted |
| 9 | Ask Chalky to "say that another way" after a reply | A new reply in the chat; nothing on the board is lost |
| 10 | Ask for a second hint with nothing typed | Disabled, "Type your best try first." |
| 11 | Finish a lesson where a wrong idea was fixed | The wrap-up leads with What clicked |
| 12 | Open Learn with two tests and one goal for yourself | All three are rows, nothing is open, one filled Start |
| 13 | Type "teach me how mortgages work" in the home chat box | A row appears under "For yourself" and the 5 minute check starts |

**What this cannot prove.** Whether students learn more. That needs real use: the `came_back_right` number in Part D is the first honest signal, and it only appears after students return for later lessons.

---

# Prompt changes (`TUTOR_SYSTEM_PROMPT`, `tutor-tools.ts:7`)

Keep everything not mentioned here. Write in the prompt's existing voice.

**"How to teach": add three bullets.**

> - A student new to a procedure (no level yet, Not yet or Shaky, or a failed first try) gets one worked example first: a tutor_say with `steps`, up to six short lines. Then ask the same shape with the last step left to them, putting the steps you've done in the question's `steps`. Take away one more step each time. At Good or above, ask first and show no example.
> - Before any model or study page, get a committed prediction: a tutor_ask_choice or tutor_ask_typed on exactly what the visual will show. After they've tried it, ask what they saw against what they predicted.
> - When two ideas are easy to mix up, put the two cases side by side and ask what differs.

**Phase 1, Check: replace with.**

> 1. Check: starts with what's coming back. The lesson context marks some topics comingBack. Ask one unaided question on each (set topicId, typed or explain, no hints, in the instructor's style), in any order. Don't reteach here: if one is missed, give the fix in one line and move on. Then one or two questions on today's topic to find where they are. Ask today's key idea in a form you can ask again in On your own with new numbers; that pair is how we know it clicked. If they clearly know the basics, skip the reteach, not the lesson: go straight to a harder condition, an edge case or the classic mistake for this topic.

**"Tools": add.**

> A worked example goes in `steps`, not in the sentence.
> After every explanation, call tutor_grade before you reply: `met` says which rubric points the answer showed, in the rubric's order, and `correct` is your overall verdict. The student sees the rubric points with ticks once you mark it, so write each as a short plain statement. If the app marked a typed answer wrong (`matched` is false) but it means the same as an accepted answer, call tutor_grade with correct true and equivalentTo naming that accepted answer, before you reply. You can't change a right answer to wrong.
> Every tool result carries secondsLeft. Reach On your own with at least a third of the time left. When a result says timeUp, call tutor_finish straight away with the evidence so far.

Remove "then grade it in tutor_say" from the rubric sentence.

**"Restoring, messages and finishing": replace the evidence and level sentences with.**

> Cite evidence by block ID with a short reason; the app uses the verdicts it saved. Levels: 0 not yet, 1 shaky (recognises it), 2 getting there (can apply with support), 3 good (right unaided today), 4 solid (right unaided again on a later day). On a student's first session on a topic, place them anywhere from 0 to 3 on what they showed unaided. After that the app moves a level one step per session, and gives 4 only when there is unaided evidence from an earlier day. Include an assessment for every comingBack topic you asked: Solid if they got it, one level lower if not.
> clicked: when the student held a wrong idea (a wrong answer or prediction) and later answered a question on the same idea right, unaided, add it: `before` and `after` in their words, and the two block IDs. At most two. Leave it out when it didn't happen.

Add `tutor_grade` to `TUTOR_TOOL_NAMES` and `specifications`:

> "Mark an explanation against its rubric, or accept a typed answer that means the same as an accepted one"

**"Restoring, messages and finishing": one more change.** Where it says to answer a question asked mid-question with tutor_say, say tutor_reply.

**New section, "The board":**

> The student sees a whiteboard and, beside it, a chat with you. The board holds the work; the chat holds the conversation.
> - tutor_say writes a note on the board. Use it for the lesson: what you're teaching and your response to an answer.
> - When the student types to you in the chat, answer there with tutor_reply, in one to three sentences. If the answer is better shown than said, change the board too, then say what you changed.
> - A question can carry a `note`: one line that stays under it, such as what the picture shows.
> - Show a visual with `wait: false` when the student should use it while answering a question. It stays up until you erase it. Use `under` to put a table or a second view beneath the visual it came from.
> - Prefer changing what is up over drawing again: tutor_update to add a label, a row or a point; tutor_erase when something is no longer needed. The board holds two visuals; make room before adding a third.
> - After a wrong answer, don't move on and don't give the answer. Write what their answer actually was, add what will help, and ask the same question again by repeating the same tool call. They get up to three tries; only the first counts as unaided.
> - You never choose where things go or how big they are. Say what a thing is and what it belongs under; the app arranges the board.

Add `tutor_reply`, `tutor_update` and `tutor_erase` to `TUTOR_TOOL_NAMES` and `specifications`, with `tutor_grade`.

---

# Out of scope

- The Learn chat agent on the home page, the syllabus reader and the school scan.
- A separate grader session, a bank of pre-written quiz questions, and declarative "scene" visuals (all in the older `docs/redesign/LEARN-PLAN.md`).
- Freehand drawing by Chalky or the student, and the student clicking a thing on the board to ask about it.
- Decaying a level over time, and changing how readiness is computed.
- Replacing the 2.5 s and 1.2 s polling with pushed updates.
- Reminders that a topic is coming back.

# Known risks

- **The board can get crowded.** The capacity rule and folding are the guard; the simulated-student run is where it will show first.
- **Maths beyond stacked fractions** (integrals, matrices) is not designed. Chalky's pages can render it; the built-in steps cannot yet.
- **Chalky's replies take 5 to 15 seconds today.** The design shows "Chalky is writing…" but does not make it faster. D3 measures whether a lower reasoning effort helps.
- **The side chat narrows the board** to about 900px at a 1280px window. Wide visuals have 720px.
