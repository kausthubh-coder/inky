# Studi redesign: how it works

Companion to `concept.html`. The mock shows what the student sees. This says what decides it and what has to be built. Names in `code` are from `desktop/shared`.

## 1. The rule everything follows

Screens and components are fixed. The agent never invents UI. It produces data, and the app decides how to show it. Where the model must choose what happens next (tutor sessions), it chooses by calling one of a small set of tools, and each tool maps to one component we build by hand.

## 2. Today

### What goes on the list

Computed in the renderer from `SchoolOnboardingState.assignments`, `TaskSummary`, and `LifecycleState`. No model involved.

| Group | Included | Order |
|---|---|---|
| Needs you | Task state `needs_user` or `ready_review`. Scan state `needs_user`. | `handoffDeadline` or `reviewDeadline`, soonest first |
| Inky now | `lifecycle.execution` in a live phase. At most one, because of the browser lease. | n/a |
| Up next | Not done, and overdue or due within 7 days | Due date, unless the student reordered (`priority` on the queue entry) |
| Later | Due after 7 days | Collapsed behind a count |
| No due date | No `dueAt` and no parseable `dueText` | Collapsed behind a count |
| Handed in | `submitted` this week | Shown only when Needs you is empty |

The headline is a template picked by state, not model text: counts of Needs you, the live execution title, or the next scheduled start.

### What a row shows

- Left edge: class color (`courseTone`, already in the app).
- Needs you rows carry one button: Review, Add files, or Sign in.
- Up next rows carry no button except the first startable one. The right side says when Inky starts, from the resolved rule and the due date.
- Clicking a row opens it in place: instructions (`assignment.instructions` or `requirementEvidence`), source page, Inky's plan, I'll do this myself, Ask Inky about it, and Something wrong.

### Something wrong

| Option | Effect |
|---|---|
| Wrong due date | Student sets `dueAt`. Marked as student-set so a later scan doesn't overwrite it silently. |
| This isn't homework | Task state `ignored`. Hidden from Today, kept in All work under Done. |
| Details look wrong | Targeted re-scan of that assignment (`targetAssignmentId`, exists today). |
| I already did it | Task state `ignored` with a reason, so the scan's school status can confirm it later. |

Add homework takes a link or a title. A link starts a targeted scan of that page. A title creates a manual assignment with no source.

### Inky's rule

One line on Today: the default mode and a count of exceptions. Change opens the editor.

| Scope | In the code today | New work |
|---|---|---|
| Everything | `global` | none |
| A class | `course` | none |
| A kind of work | `pattern` (confirmed group) | The scan labels each assignment with a kind: quiz, problem set, essay, code, discussion, reading, group work. The kind is the pattern ID. |
| One assignment | `assignment` | Set from the row's details |

Most specific wins, as `resolvePermission` already does.

## 3. Talking to Inky

One conversation. It opens as a sheet over the current screen. There are no threads and no chat page.

- **Messages carry context as a tag.** `AgentMessage.assignmentRefs` already exists. Inside an assignment or a check, the tag is attached automatically. From Today, Ask Inky about it attaches one.
- **Inky's own updates are part of the timeline.** `chatTimeline` already merges messages with cards. Extend the card kinds to: started, needs you, ready for review, handed in, couldn't finish, check finished, session finished, memory saved. These come from lifecycle transitions, not from the model.
- **What Inky did** is the same timeline filtered to cards. This replaces a separate activity log.
- **Context changes three things:** the placeholder in the box, the suggestions that appear when the student clicks into it, and the tools the agent is given. Inky's face in the box opens the conversation. While Inky is working, the empty send button is a stop button.

| Where | What the box is for | Tools |
|---|---|---|
| Today, All work | I can start, stop, or reorder homework, check school, and remember things. | `home_status`, `queue_*`, `assignment_start`, `note_*`, `connected_apps_*`, plus new `queue_reorder`, `assignment_set_owner` |
| Inside an assignment | What you ask here changes this assignment. | The assignment worker's tools. The message goes to the running worker session. |
| Inside a school check | What you say here steers this check. | New `scan_add_source`, `scan_skip_source` |
| Learn | Ask anything, get quizzed, or tell me about an exam. | `note_*`, `connected_apps_*`, new `learn_set_exam`, `learn_start_session` |
| Tutor session | Your answers and questions go to this session. | The tutor tools in section 6 |

Today the code keeps separate agent sessions for home and for each assignment. Keep that. Only the presentation is unified: the app stores all messages in one ordered timeline and sends each new message to the session that matches its tag. Context compaction stays internal and is never shown.

**Chat changes the queue visibly.** When a tool call changes a task, the renderer flashes that row, and the reply carries a card that links to it.

## 4. Assignment view

One layout for every kind of assignment: a side panel and the school browser filling the rest. The phase (`AssignmentExecution.phase`) picks the panel's content.

| Phase | Panel shows | Data | Controls |
|---|---|---|---|
| `working` | Latest action as the headline, then the actions so far. No step count, because the agent has no fixed number of steps. | `AgentRunEvent` stream | Takeover on the existing browser overlay (`drive-overlay.ts`). Stop is the empty send button in the chat box. The header has only Back. |
| `needs_user` | The one thing Inky needs and the control that fixes it, plus how long it waits | `returnPredicate` or `lastError`, `handoffDeadline` | File drop, I signed in, Continue |
| `ready_review` | Inky's doubts, then requirements and work, folded | `missingRequirements`, `completionChecklist`, `answerSnapshot` or folder files, `reviewDeadline` | Submit by rule, Edit it myself, Discard |
| `submitting` | Two lines | `submissionAttemptedAt`, checkpoints | none |
| `submitted` | Receipt replaces the school page | `SubmissionReceipt.preSubmit`, `postSubmit`, `verifiedStatus` | Back to today |
| `failed` | Why, and what was saved | `lastError`, `attempts` | Try again, Open saved answers |

### Turning agent events into sentences

`tool_started` and `tool_finished` carry `toolName` and `arguments`. Do not ask the model to narrate. Two options, in order of preference:

1. Each of our tool wrappers returns a short `label` with its result ("Typed the answer to question 2"). The wrapper knows the element name and the file name, so the sentence is exact.
2. Fallback: a renderer-side map from `toolName` to a template.

`text` events are shown as Inky's handwritten lines. `retry` events are shown in red. Raw tool calls are not shown to students.

### Doubts

Today `missingRequirements` is a list of strings. Make it a list of `{ where, why }` that the worker records when it calls `assignment_start_review`. These are the handwritten margin notes.

### Different kinds of work

The panel never assumes numbered questions. Work is shown as either the answer snapshot (text) or the files in the assignment's folder. Requirements are always requirement plus evidence. That covers quizzes, essays, code uploads, and discussion posts with no per-kind UI.

## 5. Learn

All computed in the app, so the page is predictable.

| Decision | Rule |
|---|---|
| Which exam leads | Nearest exam date that has a syllabus. The student can switch with the buttons under the headline. |
| Today's topic | Largest gap between a topic's share of the exam and the student's level. Ties go to the earlier chapter. |
| Recaps | Every third day, five minutes on the last topic learned. |
| Levels | 0 to 4. They move only when `tutor_finish` reports evidence from a typed answer or an explanation. Homework Inky did never counts. |
| Readiness | Sum of level times topic weight, as a percent. |
| Something else | A topic with no exam. Starts with a short check, then the same session format. |

Data to add (local SQLite, next to tasks):

- `exam`: course, date, source (syllabus file, typed, scan).
- `topic`: course or free, title, weight, source.
- `topic_level`: topic, level, evidence list, updated at.
- `session`: topic, started, finished, blocks, result.

Sources, in order: a syllabus found by the scan or in Drive (`connected_apps_*`), text the student pastes, a date the student types. With no source, Learn asks for one and shows only topics from homework Inky has done, labelled as such.

## 6. Tutor session

A tutor session is a conversation with a tutor agent (`AgentTarget` kind `tutor` already exists) that can only act through these tools. Each tool is one component. The student's interaction is the tool result. The agent reads it and picks the next tool.

| Tool | Component | Result returned |
|---|---|---|
| `tutor_say` | Inky's handwritten line above the block | none |
| `tutor_ask_choice { question, options, correct }` | Question with option cards | `{ picked, seconds }` |
| `tutor_ask_typed { question, accept, hints }` | Typed answer with a hint ladder. The app checks the answer against `accept`, not the model. | `{ answer, correct, hintsUsed }` |
| `tutor_show_model { model, params, controls }` | One of a small registry of interactive models we build: population grid, number line, function plot, code runner, flashcards | `{ explored, seconds }` |
| `tutor_ask_explain { prompt, rubric }` | Text box, then Inky's written verdict | `{ text }`. The agent grades it and replies with `tutor_say`. |
| `tutor_finish { topic, level, evidence, missing, next }` | Summary block | Updates `topic_level`, posts a card to the timeline |

Rules the app enforces, not the model: a time budget per session, at most one open block, and a level can rise by one step per session at most. Free text typed in the box is sent to the agent as a normal message, so the student can always ask a question mid-block.

Earlier blocks collapse to one line each above the current block. There is no fixed sequence and no step counter, only time left and the goal.

## 7. Onboarding

Keep the existing onboarding. It already speaks as Inky, asks the rule question, and ends on "Your week is ready". Restyle it to the new tokens only. Reordering it is optional and out of scope.

### Work that is not a web page

When an assignment has files (code, a report, a spreadsheet), the right side gains a second tab beside School page called Inky's files: the file list, the open file, and test or command output. It appears only when the assignment's folder has files, so a plain quiz never shows it. The existing overlay covers only the school page tab.

### The hands-off student

Some students set Do it and submit once and never look. For them Today says nothing needs you, lists what Inky handed in on its own with receipts, and shows what is next. Inky notifies only when it is stuck. Studi keeps working from the tray when the window is closed.

## 8. Visual system

- **Type roles:** display 30 handwriting for Inky's headline, voice 15 to 17 handwriting for anything Inky says in first person, title 16/700, body 15, meta 13, label 12.5/600. Nunito Sans at 400, 600, 700. Handwriting is never used for labels or buttons.
- **Space:** 4 base. About 4 between rows in a group, 32 between groups. Groups are separated by space and a small label, not lines.
- **Controls:** filled highlighter for the one next action, outlined for a choice, quiet blotter fill for everything else. Underlines only for links inside sentences.
- **Color:** paper, pencil, graphite, blotter, highlighter, red pen. Class colors only as a left edge or a small dot. Learn swaps the highlighter to lavender.
- **Motion:** press scale 0.96, 150 ms color transitions, one row flash when chat changes it, the mode switch thumb slides. Nothing loops except Inky.

## 9. Suggested build order

1. Today list with the grouping rules, row details, and Something wrong. No agent changes needed.
2. Assignment view: event feed with tool labels, phase panels, full-bleed browser.
3. One conversation sheet, timeline cards from lifecycle transitions, context line and tags.
4. Rule editor with kinds of work (needs the scan to label kinds).
5. Queue tools for chat: reorder and hand back.
6. Learn data model and rules, then the tutor agent and its first three components.
