# Scan v2: the model leads, tools make it fast

Decided with the student on 2026-09-27 after the first real WolfWare run (see docs/reports/checkpoint-08 when written).

## Goal given to the agent
"You're setting up Studi for this student. Find the work they need to do (assignments, quizzes, labs, exams, vendor homework). Set up each class: its syllabus, upcoming exams, study guides and other useful material. Check their connected email for school updates."

## Decisions
- **Inky (GPT-6 Sol) leads every scan on every school system.** The zero-token Moodle/Canvas readers become tools, not a pipeline. Keep the zero-token path in mind for a future "check without AI" mode.
- **Playbooks per system, each with a fallback.** Moodle and Canvas: "use your Studi tools first". If a tool errors or leaves a gap (missing column, customised school), switch to the browser for that class and get the same information by hand. Any other system (Google Classroom, Blackboard, D2L, custom): browser from the start, with a guide to where things usually live.
- **Save everything useful, categorised.** Items have `category`: work (default), exam, resource, grade. Only work goes into the student's week and Today; the rest is class context. The old problem was wrong categorisation, not saving. Meetings and office hours aren't saved at all.
- **Learn setup by the agent.** Record upcoming exams (with dates), resources (syllabus, study guides, past exams, slides, assignments as practice) and a class note (grading, kinds of work, where it's submitted, exam dates). Class folders are created.
- **Email at every depth.** Connected email (school Gmail) since the last check: deadline changes, announcements, exam info. Read-only, never changes read state.
- **Reasoning always high.** "How hard Inky thinks" is removed from Settings. High is a ceiling, so reasoning stays dynamic. Scans previously ran at the lowest effort.
- **Depth setting (Settings → School):** Normal (default) gets the important things: every work list, each class's syllabus, exams and study guides, email. It opens an item only when its list entry lacks something. Deep gets as much as possible: every item's full instructions, all materials, announcements, gradebook detail, linked systems in full.
- **School memory.** At the end of every scan the agent writes "how this school works" notes (where each class posts work, which classes use WebAssign, where syllabi live). Refreshes start from them and only go deeper where something changed.
- **Exact dates.** When an item has both an exact API instant and written text, code keeps the exact instant; this isn't the agent's concern.

## Build steps
1. Categories on saved items; the week and Today show only work. **Done.**
2. Tools: Moodle and Canvas readers as agent tools (school overview, read a class, work lists); record exam, record resource, class note (done), school memory, read email.
3. Prompt: shared core, three playbooks with fallback, depth rules; remove the fixed pipeline.
4. Settings: remove the thinking control (always high); add Normal/Deep.
5. Tests: fake school gets email, exams, resources, and a broken-tool case proving the fallback. Live GPT-6 Sol runs at both depths, measuring time and tokens.
6. The student reruns setup on WolfWare; compare row by row with the Codex report.
