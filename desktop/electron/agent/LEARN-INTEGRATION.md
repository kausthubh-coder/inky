# Learn, Tutor, and memory integration

All data is local SQLite schema 9. `LearnRepository` binds every query/mutation to the authenticated subject at construction. Never accept this subject from renderer input. Do not reuse a repository or coordinator after signout.

```ts
const learn = new LearnRepository(store.database, authenticatedSubject);
const tutor = new TutorCoordinator(learn, piRuntime, { onChange: publishTutorState, onError: reportError });
const extraction = new LearnExtractionWorker(learn, piRuntime, { onChange: publishLearnState, onError: reportError });
const memory = new MemoryCoordinator(store.notes, authenticatedSubject);
```

The runtime dependency has one method:

```ts
createLearningSession(tools: readonly ToolDefinition[], systemPrompt: string, target?: AgentSessionTarget): Promise<AgentSession>
```

Use the production Pi session implementation, `noTools: "all"`, exact supplied custom tools, the current model/reasoning selection, existing authentication, and existing usage recording. A home/assignment session factory has the wrong prompt and tool authority. Tutor sessions get six tools; extraction gets only `learn_record_source`. No fake provider fallback exists here.

## Public API

Import schemas directly from `shared/learn-state.ts`, `shared/learn.ts`, `shared/tutor.ts`, and `shared/memory.ts`. `TutorSessionSchema` and `TutorBlockSchema` are **private storage/model records**. Every tutor coordinator return and callback is `PublicTutorSession`; it strips choice keys, accepted typed answers, explanation rubrics, and unrevealed hints. `LearnStateSchema` contains `TutorSessionSummarySchema` records, mastery levels/evidence counts, and source metadata. Its SQL projections omit blocks, messages, answer evidence, and source text. Fetch `tutor.state(sessionId)` when opening a session. `learn.sessionSummaries()` returns most recently updated first; it does not load blocks.

| Action | Domain call |
| --- | --- |
| Learn page | `learn.learnState(todayDate, selectedExamId?)` |
| Set/correct exam | `learn.setExam({examId?, courseId, title, date})` |
| Paste or trusted scan source | `learn.importSource({sourceId?, courseId, title, kind, sourceTarget, text})` |
| Read pending/retry sources | `extraction.processPendingSources({retryFailed?, forceSourceId?, signal?})` |
| Native file import | `importLearnFile(learn, mainChooserPath, courseId, title?, assertActive?)` then process pending sources |
| Topic session | `tutor.start({topicId, mode:'topic', minutes:15})` |
| Free topic | `tutor.start({topic:'What I want to learn', minutes:15})` |
| Recap | `tutor.start({topicId, mode:'recap'})` (five minutes) |
| Mock exam | `tutor.start({examId, mode:'mock_exam', minutes:15})` |
| Session state | `tutor.state(sessionId)` |
| Answer | `tutor.answerBlock(sessionId, blockId, answer)` |
| Hint/draft | `tutor.hint(sessionId, blockId)` / `tutor.saveDraft(sessionId, blockId, text)` |
| Mid-block question | `tutor.send(sessionId, text, clientMessageId)` |
| Lifecycle | `await tutor.pause/resume/cancel(sessionId)` |
| Memory | `memory.list()`, `await memory.read(noteId)`, `await memory.update({noteId,expectedRevision,title,content})`, `await memory.delete({noteId,expectedRevision})` |

There is no renderer finish/mastery mutation. Only successful `tutor_finish` validates evidence and commits a completed session and mastery together. The timeline can derive its session-finished card from the durable completed session/result using `sessionId` for deduplication; provider terminal prose is not a completion receipt.

## Discovery and source changes

The scan coordinator owns browser provenance. Its `recordSyllabus({courseId,title,text,sourceTarget})` callback imports a pending source; after the scan ends call `processPendingSources()`. “Find it” uses the real school scan. Drive discovery can import through the same boundary after a connected-app read; this module does not search a personal Drive itself. Native PDF/text import must use a main-process dialog result, never an arbitrary IPC path. The final `assertActive` callback rechecks current auth/repository after asynchronous file parsing.

Sources dedupe by course + source URL (or content hash for unaddressed imports). Unchanged content reuses the extraction. A changed hash updates the same source and invalidates stale extraction results. Exam/topic identities match existing normalized titles within their source/exam; provider key spelling changes do not discard saved identity. Date changes update the saved exam while student-set dates remain authoritative. Every extracted record quotes the supplied source. The model's semantic interpretation of that quote still requires live quality checks.

Extraction is sequential and bounded to 60 seconds per source by default (maximum 120 seconds). It re-queries pending sources after each result. Imports arriving during a batch are processed once per source/hash; failed reads require an explicit retry. Disposing aborts the active read and awaits the batch.

## Learn conversations and homework hints

The persisted `ConversationTarget` accepts `{kind:"learn"}` with owner-scoped job identity. Supply `ConversationCoordinator.options.learning` implementing `LearningConversationHooks` from `learn-conversation.ts`: `state()`, `setExam(input)`, `startSession(input)`, and `importSource(input)`. Main must validate current repository identity before effects and after asynchronous provider readiness, validate course ownership, and queue extraction after import. Keep `state()` brief bounded. The Learn role has `note_search/read/upsert`, connected-app discovery/read tools, `learn_set_exam`, `learn_start_session`, and `learn_import_source`. Tutor blocks remain in their dedicated durable session rather than the generic chat transcript.

Source import tools accept text only when it appears in the student's persisted message or an actual connected-app read result; a supplied Drive URL must occur in that read result. Home and Learn preference writes fix scope to the authenticated owner's student preferences and require a quote from the student's current explicit request to remember. Existing edits require the current revision from note search/read. No legacy/scoped ownership is inferred.

Call `learn.syncHomeworkHints(items: readonly {assignmentId:string;courseId:string;title:string}[])` only with main-verified assignments and exact-owner execution evidence (saved answer plus review checkpoint or a submitted receipt). It maintains stable topic hints with `origin:"homework_hint"`, null exam/source/weight, and never changes mastery. Legacy executions without owner evidence must be excluded by the caller.

## Guarantees and bounds

- Missing mastery stays unknown. Missing weights stay unknown. Readiness normalizes the provided positive exam shares; partial evidence reports known coverage with no whole-exam percentage.
- Planner choices are deterministic. Explicit past/undated exam selections keep their own topics/readiness and have no future path. The default lead is the nearest future exam with topics. Recap is due after three calendar days; the path schedules a mock two days before the exam. Mock exams cover 1–30 topics; larger topic sets do not show a mock path action.
- A tutor session has at most 120 blocks, 100 student messages, and 250,000 serialized characters. Sessions have 1–60 active minutes. Pause stops the clock; restart charges through the last persisted event and restores the unfinished block/draft.
- A correct choice or model interaction never establishes mastery. Typed answers use normalized exact matching, without executable regex. Explained answers require the prior rubric and a model verdict referencing the student's actual saved response. A positive hinted answer alone cannot increase mastery.
- Each assessed topic moves at most one level per completed session. Repeated finish calls cannot award a second change. Mock assessment commits atomically only with typed/explanation evidence for every topic.
- Homework storage/scan writes have no mastery API. Homework hints are never scored or used as an exam source.
- Source import is bounded to 8 MB and 200,000 extracted characters; PDFs are limited to 80 pages. Image-only PDFs fail honestly with a paste-text recovery action. There is no OCR success placeholder.
- The five model schemas are population grid, number line, bounded function family, flashcards, and JavaScript code runner. The renderer owns visual fidelity and interaction. The code runner must use an opaque sandbox iframe and disposable browser Worker, network-denying CSP, and a hard timeout of at most one second. Never execute it in Electron main, Node, or the school's guest browser. `shared/tutor-code-sandbox.ts` provides the isolated iframe document; verify result source window and run ID.

## Account shutdown and memory

Await `tutor.dispose()`, `extraction.dispose()`, and `memory.dispose()` before closing SQLite or dropping account resources. Memory disposal marks the coordinator disposed synchronously, denies new operations, and drains in-flight reads/mutations and the NoteStore queue. Revision-checked writes recheck authorization before publishing Markdown. Account-ambiguous legacy `student/primary` preferences are not automatically adopted. The default memory list includes only exact-owner student preferences. A scoped-access callback is available only when main has independent evidence that those school/course/assignment IDs belong to that owner.

`NoteStore` serializes reads/writes, rejects stale revisions, and removes authoritative Markdown before its SQLite index entry. A restart repairs an interrupted deletion without resurrecting the forgotten note. Home automatic/search retrieval uses the authenticated student's preferences only.

## Verification

The focused controlled suites are `tests/storage/learn-tutor.test.mjs`, `tests/storage/learn-conversation.test.mjs`, `tests/agent/learn-tutor.test.mjs`, and `tests/storage/memory.test.mjs`; neighboring note, retrieval, agent-host, migration, and backup suites cover affected boundaries. Build once and run serially while holding the test slot. Controlled drivers prove orchestration and persistence, not real provider teaching or extraction quality.

Release verification still needs a real syllabus discovery/extraction, an exam-moved scan, an adaptive tutor session, a mid-block question, all five rendered model interactions (including code timeout/network denial), and a restart through actual IPC. The coordinator owns that integrated pass. Current live-provider authentication is tracked by the coordinator, not bypassed by these modules.
