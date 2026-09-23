# Learn: design and build plan

Status: design, not started. Branch: `codex/studi-redesign-release`. Written 2026-09-19.

Goal: a 1-on-1 tutor whose job is the student's highest score on their real test, taught from their
real coursework. Exams are the priority. Course goals and free topics use the same model but ship last.

## 1. What is wrong today

- The screen mixes two exams. Updated Sep 23 at `aa957c0`: loading now sends the selected exam, but
  every action (add source, save date, retry, import) still returns state built without it
  (`main.ts:467-500`), so Today, path, readiness and Start follow the planner's pick while the header
  follows the chip (`LearnScreen.tsx:159-167`, Start at `:330`).
- "Add another" mixes source actions with Enter an exam date (`LearnScreen.tsx:627-668`, from the PR 40
  audit fix).
- No way to add a second exam. "Enter an exam date" overwrites the selected one (`LearnScreen.tsx:493`).
- "Add another" is a sources row with a test action parked in it. Sources bind to a course, never an exam.
- "Something else" hides everything and has no sources.
- The tutor sees topic titles only (`tutor-coordinator.ts:138`). No source text, course name, exam
  date, or history. Extraction quotes are validated then discarded.
- Nothing stops lecturing (`tutor_say` is unlimited). Explain answers are graded by the tutor itself
  and always count as clean evidence.
- The scan cannot fetch study guides, slides or past quizzes; PDF reading is assignment-only
  (`scan/materials.ts:32`).
- Renderer polls at 2.5 s and 1.2 s because `onChange` is never wired (`main.ts:1677`).

## 2. Data model

One new concept, `Goal`. Everything on screen and every IPC response derives from one selected goal.

```ts
// shared/learn.ts
Goal = {
  goalId, kind: "exam" | "course" | "topic",
  courseId: nullable,            // null only for kind "topic"
  title, date: nullable,         // date only meaningful for "exam"
  dateOrigin: "source" | "student",
  scopeNote: string | null,      // student's words: "ch 1-4, no recursion"
  createdAt, updatedAt,
}
```

- `Exam` becomes `Goal{kind:"exam"}`. Migration: one goal per existing exam, same id. `examId` fields
  on topics and sessions are renamed `goalId`.
- `LearnSource` gains `goalIds: string[]` (a syllabus can serve several exams) and
  `role: "syllabus" | "study_guide" | "slides" | "past_test" | "notes" | "assignment" | "other"`.
  `kind` gains `"link"`.
- `LearnTopic` gains `style: "conceptual" | "factual" | "procedural"` (set by extraction, editable)
  and `quotes: string[]` (the extraction quotes, now kept).
- New `SourceChunk { sourceId, index, text }` table, built at import. Retrieval is plain keyword
  scoring against topic title + quotes. No embeddings until that proves too weak.
- `planLearn` takes a required `goalId` and never picks its own. The dashboard computes a light
  summary per goal (days left, readiness, source count); the full plan is only built for the open goal.
- A goal with no date or no topics is a valid state with its own UI, not a fallback trigger.

Learner profile lives in the existing notes system, no new store:
`scope:"student", about:"knowledge"` for cross-course habits, `scope:"course", about:"knowledge"`
for per-course misconceptions. `NoteRetrievalContext` gets a `learn` variant.

## 3. Dashboard

One column. No sidebar, no cards, no pills. A class is a colour dot, nothing more.

Empty:

```
Inky   What are you getting ready for?

  [ Drop a file, paste a link or text, or type "CS 230 midterm Oct 3"      ]
    Scan my school for it
```

With goals:

```
Inky   Midterm 1 in 6 days. You're about 40% ready.

● CS 230   Midterm 1            6 days   ████░░░░░░   4 sources
    Today: Heaps · 15 min                                  [Start]
    Heaps           ●●○○  Shaky
    Hash tables     ○○○○  Not checked
    Graphs          ●●●○  Good
    Practice quiz · Mock exam (opens 2 days before)
    Sources: Syllabus, Study guide 1, Quiz 2, Lecture 7 slides
    Edit
● ST 370   Midterm              12 days  ██░░░░░░░░   1 source
● CS 230   Final                61 days  not checked  1 source
  Add an exam

  [ Hey Inky…  drop files here too                                          ]
```

Rules:
- Rows sorted by date; undated last. Nearest exam open by default. Clicking a row opens it in place
  and closes the other. Selection is one `goalId` in state, sent with every IPC call and returned by it.
- Undated goal row says "When is it?"; topic-less goal says "Tell me what's on it" with the intake box
  scoped to that goal. Never a blank section.
- `Edit` expands inline under the open goal: title, class, date, what's covered (scope note), sources
  with remove, "Something's wrong or missing" (free text to Inky, which fixes or rescans), remove goal.
  This replaces "Date wrong?", "Syllabus wrong?", "Enter an exam date", "Paste text", "for [class]".
- Course and free-topic goals are rows under the exams with the same open/closed behaviour, no
  countdown, no readiness percent for free topics.
- Completed sessions are reachable from the topic row (last result + "again").

### Intake

One box, everywhere (empty state, composer, inside a goal). It accepts files, links, pasted text, a
typed sentence, or "scan". A single `learn_intake` step classifies what arrived
(`role`, course, which goals it serves, any exams it implies) and Inky confirms in one line:
"CS 230 syllabus. Found Midterm 1 (Oct 3) and Final (Dec 12). Add both?" The student never picks
between "source" and "exam". Links are fetched through the existing connected-app/browser read path
with the same provenance check `learn_import_source` already enforces.

### Materials scan

New scan kind `learn_materials`, scoped to one course, read-only, started from a goal
("Find study materials") with a confirm the first time. It looks for syllabus, study guides, review
sheets, slides and past quizzes and records each through a generalised `scan_record_material`
(today's `scan_record_syllabus` plus `role`). `scan_read_material` loses its assignment-only guard
when the scan kind is `learn_materials`; output goes to `LearnRepository.importSource`, not the
homework folder. Graded assignments already in the store are linked as `role:"assignment"` sources
instead of inert homework hints.

## 4. Tutor

### Context sent each turn

`{ goal(title, course label, date, daysLeft, scopeNote), topic(title, style, quotes),
   excerpts(top chunks for this topic, ≤6k chars, each tagged with source title+role),
   history(last results and missed questions on this topic), profile(relevant notes),
   session }`

Prompt rule: teach what this exam tests, in the formats the study guide and past tests use; spend
time in proportion to weight and days left. Free-topic goals keep "teach from first principles".

### Lesson phases (app-owned)

`probe → teach → guided → independent → recap`. `session.phase` is stored; the model moves forward
with `tutor_advance(reason)` and the app checks the exit condition:

| Phase | Tools offered | Exit condition |
|---|---|---|
| probe | ask_choice, ask_typed, ask_explain | ≥1 answered question |
| teach | say, show, ask_predict, ask_explain | ≥1 student response |
| guided | ask_typed (hints on), ask_explain, show | ≥2 answered |
| independent | ask_typed (no hints), ask_explain | ≥2 answered, exam-style |
| recap | say, observe, finish | finish |

Enforced in `learn-records.ts openBlock`: at most 2 `tutor_say` in a row; tools outside the phase
are rejected. Only independent-phase evidence can raise mastery; any phase can lower it.

### Teaching style by `topic.style`

- conceptual: puzzle first, `tutor_ask_predict` before any reveal, smallest nudge that unblocks,
  student states the rule, then the tutor names it.
- factual: retrieval first, short reads second, misses come back later in the session.
- procedural: worked example, then the same shape with steps removed, then alone.

### New and changed tools

- `tutor_ask_predict { question, reveal }`: student commits a prediction before the reveal or visual.
- `tutor_ask_explain` gains `probe: "reasoning" | "assumption" | "transfer"`.
- `tutor_observe { kind: "misconception"|"habit"|"preference"|"strength", text, topicId? }`: writes a
  profile note. Not shown to the student.
- `tutor_show` replaces `tutor_show_model` (section 5).
- `tutor_advance`, above.

### Grading

Explain and predict answers are scored by a separate one-shot grader call: input is the rubric
written before the answer, the answer, and the source excerpt; output is per-criterion pass/fail plus
the misconception if any. The tutor receives the verdict and cannot override it, same as typed answers
today. Typed matching gains numeric equivalence (`0.5`, `1/2`, `50%`) before falling back to the grader.

### Missed questions

Every incorrect independent-phase block is stored as a `ReviewItem { topicId, blockRef, dueAt }` with
growing intervals (1, 3, 7 days, capped by the exam date). The probe phase pulls due items first.
This replaces the fixed 3-day recap.

## 5. Visuals

`tutor_show` takes one of two payloads.

**Scene (default).** A declarative spec the app renders: `axes`, `plot(expr)`, `point`, `vector`,
`shape`, `table`, `labelled diagram (nodes+edges)`, `sequence (step-through frames)`, `slider(name,
min, max)`; any numeric field can be an expression over slider names. Evaluated by a small safe
expression parser, no `eval`. Covers most maths, physics, statistics, data structures. The five
current widgets are re-expressed as scenes or kept as named presets.

**Applet (long tail).** Model-written self-contained HTML/JS, run in the existing opaque sandbox
iframe: no network, no storage, strict CSP, size cap, `postMessage` only. Before the student sees it
the app loads it hidden and requires a `ready` message within 2 s and no errors; on failure the
tutor is told and must fall back to a scene or words. Applets report interactions
(`{event, values}`) which become the block's `explored` record. Working applets are cached by
`(topic, contentHash)` so the library grows from use. Ship scenes first; applets behind a flag until
the eval suite shows they load reliably.

## 6. Practice tests and quizzes

Background job per exam goal (same worker pattern as extraction), rerun when sources change:

1. Generate items per topic from `past_test`, `assignment`, `study_guide` chunks: same formats, same
   difficulty, each item keeps `sourceRef`. Item = `{ topicId, format: choice|typed|explain, prompt,
   answer/rubric, sourceRef, difficulty }`.
2. A second pass solves each item cold; disagreement with the key drops the item.
3. Goals without such sources still get items, marked "not based on your past tests".

Two consumers: a 5-minute topic quiz from the topic row, and the timed mock exam (weights follow
topic weights). Both run through the normal session machinery in a `quiz` phase set with no teaching,
graded by the same grader, feeding mastery and review items. Result screen shows score by topic and
what to study next.

## 7. Runtime and harness

Runtime keeps its shape: a Pi session with a raw system prompt and app-executed tools, state rebuilt
from SQLite every turn. Changes: richer snapshot, phase-gated tool lists (tools are created per
launch from `session.phase`), grader and item-bank as separate single-purpose sessions via
`createLearningSession`, `onChange` wired so the renderer stops polling. Delete the dead
`roles/tutor` pack path and `{kind:"tutor"}` AgentTarget.

Test harness additions under `agent-harness/`:
- **Simulated students.** Persona files (`knows X, believes misconception Y, guesses when stuck,
  terse`) played by a model against the real `TutorCoordinator` with an in-memory repository.
- **Judge rubric** over the transcript, reported per run: asked before telling; say:ask ratio;
  planted misconception detected and recorded via `tutor_observe`; questions traceable to supplied
  source excerpts; mastery moved only on independent evidence; session ended with `tutor_finish`.
- **Fake LMS** gains course materials (study guide PDF, slides page, past quiz) so
  `learn_materials` scans are tested end to end.
- Deterministic tests stay for the repository rules (phase gating, say limit, grader verdict
  immutability, review-item scheduling). No tests for copy or layout.

## 8. Build order

Each step ships on its own and is checked in the real app before the next.

1. **Goal model + dashboard.** Schema migration, `goalId`-required plan, goal rows, inline Edit,
   add exam, push updates, delete the audit-fix CSS layer and duplicate controls.
   Done when: two exams in one course can be added, switched, edited, and nothing on screen ever
   names a different goal than the open one.
2. **Intake box.** `learn_intake` classify-and-confirm for files, paste, typed sentence; sources
   bind to goals with a role. Links after files.
3. **Grounded tutor.** Keep quotes, chunk sources, new snapshot, exam-aware prompt.
   Done when: a session on a real syllabus + study guide asks questions traceable to them.
4. **Phases, enforcement, grader, predict/observe tools, profile notes, review items.**
5. **Simulated-student evals.** Baseline the step 3 tutor, then prove step 4 improved it.
6. **Materials scan** (`learn_materials`, generalised material reader, fake-LMS fixtures).
7. **Item bank, topic quiz, rebuilt mock exam.**
8. **Scenes**, then **applets** behind a flag.
9. **Course and free-topic goals in the UI**, long sessions.

## 9. Open decisions

- Applets: model-written code in the sandbox, or scenes only for the first release? Plan assumes
  scenes first, applets flagged.
- Materials scan: confirm every time or only the first time per course? Plan assumes first time.
- Link intake for pages behind school login goes through the school browser; public links through a
  plain fetch. Confirm that split is acceptable.

## 10. Added Sep 23

Three sections were added to `learn-plan.html` and are the source of truth for them:
"Three kinds of goal" (test, class, something else: how Studi tells, where facts come from, planner
target, tutor stance, screen), "From adding a test to after it" (first-session check, daily sessions,
behind-schedule rule, day before, test day, after), and "Inside a lesson, when the student" (questions
mid-block, "I already know this", "just tell me", files dropped mid-lesson, running out of time).
Stories G1 to G7 and H1 to H5 cover them.
