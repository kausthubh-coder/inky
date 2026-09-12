import { WorkspaceDialog } from "./WorkspaceDialog.js";
import { SchoolCheck } from "./SchoolCheck.js";
import { HomeworkFiles } from "./HomeworkFiles.js";
import { Icon } from "./Icon.js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  Assignment,
  AssignmentReference,
  ConversationState,
  LifecycleState,
  SchoolOnboardingState,
  SchoolPageBounds,
  StudiWorkspaceState,
  TaskSummary,
} from "../../shared/index.js";
import { Inky, type InkyState } from "./Inky.js";
import { PreviewSchoolPage } from "./PreviewSchoolPage.js";
import { readDevPreviewConfig } from "./devPreview.js";
import { chatTimeline, type ChatCardEntry } from "./chatTimeline.js";
import { formatDateTime } from "./Ui.js";

export type ChatView = "home" | "compact" | "expanded";
interface ChatProps {
  schoolCheck?: boolean;
  onAssignment?: (id:string) => void;
  view: ChatView;
  onView: (view: ChatView) => void;
  storageKey: string;
  onboarding: SchoolOnboardingState;
  lifecycle: LifecycleState;
  workspace: StudiWorkspaceState | null;
  assignment: Assignment | null;
  task: TaskSummary | null;
  mood: InkyState;
  actionError: string | null;
  scanBusy: string | null;
  onStart: (id: string) => void;
  onOpenWork: () => void;
  onTakeover: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onOpenArtifact: (id: string) => void;
  onVerifySubmission: (id: string, text: string) => void;
  onSchoolSlot: (bounds: SchoolPageBounds | null) => void;
  onResumeScan: () => void;
  onStopAndScan: (taskId: string) => void;
}
type Draft = {
  text: string;
  refs: AssignmentReference[];
  clientMessageId?: string;
};
function readDraft(key: string, legacyKey?:string): Draft {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? (legacyKey ? localStorage.getItem(legacyKey) : null) ?? "{}");
    return {
      ...(typeof saved.clientMessageId === "string" &&
      /^[0-9a-f-]{36}$/i.test(saved.clientMessageId)
        ? { clientMessageId: saved.clientMessageId }
        : {}),
      text: typeof saved.text === "string" ? saved.text : "",
      refs: Array.isArray(saved.refs)
        ? saved.refs.filter(
            (r: AssignmentReference) =>
              typeof r.assignmentId === "string" && typeof r.title === "string",
          )
        : [],
    };
  } catch {
    return { text: "", refs: [] };
  }
}

export function ChatWorkspace(props: ChatProps) {
  const { view, onView, onboarding, lifecycle, workspace, assignment, task } =
    props;
  const target = assignment ? {kind:"assignment" as const, assignmentId:assignment.assignmentId} : {kind:"home" as const};
  const school = Boolean(props.schoolCheck);
  const scope = school ? "school" : assignment?.assignmentId ?? "home";
  const key = `studi-chat-draft:${props.storageKey}:${scope}`;
  const [draft, setDraftState] = useState(() => readDraft(key, scope === "home" ? `studi-chat-draft:${props.storageKey}` : undefined));
  const [chat, setChat] = useState<ConversationState | null>(null);
  const [sending, setSending] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [browser, setBrowser] = useState(false);
  const [scanDetails, setScanDetails] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [option, setOption] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const sendLock = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const mounted = useRef(true);
  const active = (chat?.activity !== "idle" && Boolean(chat)) || sending;
  const execution = !school && assignment ? task?.execution ?? (lifecycle.execution?.assignmentId === assignment.assignmentId ? lifecycle.execution : null) : null;
  const reviewEndsAt = execution?.handoffDeadline ?? execution?.reviewDeadline;
  const activeExecution = lifecycle.execution;
  const workingAnywhere =
    activeExecution &&
    ["working", "needs_user", "ready_review", "submitting"].includes(
      activeExecution.phase,
    );
  const work =
    execution &&
    ["working", "needs_user", "ready_review", "submitting"].includes(
      execution.phase,
    );
  const cards: ChatCardEntry[] = [];
  if (assignment || execution) {
    cards.push({
      kind: "assignment",
      key: `assignment:${assignment?.assignmentId ?? execution!.assignmentId}`,
      createdAt: execution?.updatedAt ?? assignment!.discoveredAt,
    });
  }
  if (execution?.phase === "ready_review") {
    cards.push({ kind: "review", key: `review:${execution.taskId}`, createdAt: execution.updatedAt });
  }
  const messages = school ? (onboarding.scan?.messages ?? []).map((message,index) => ({...message,turnIndex:index})) : chat?.job.messages ?? [];
  const timeline = chatTimeline(school ? [] : messages, cards);
  const scanActive = school && ["running", "needs_user"].includes(onboarding.scan?.state ?? "");
  useEffect(() => { setScanDetails(false); }, [onboarding.scan?.scanId]);
  const mood: InkyState =
    chat?.activity === "typing"
      ? "thinking"
      : active
        ? "thinking"
        : workingAnywhere
          ? props.mood
          : "idle";
  const status =
    chat?.activity === "typing"
      ? "Inky is typing…"
      : active
        ? "Thinking it through…"
        : workingAnywhere
          ? activeExecution.phase === "needs_user"
            ? "I could use your help."
            : activeExecution.phase === "ready_review"
              ? "Ready for your review."
              : "Working on it…"
          : "I’m here.";
  const matches = onboarding.assignments
    .filter((a) =>
      `${a.title} ${onboarding.courses.find((c) => c.courseId === a.courseId)?.label ?? ""}`
        .toLowerCase()
        .includes(query?.toLowerCase() ?? ""),
    )
    .slice(0, 8);
  const saveDraft = (next: Draft) => {
    if (
      next.text !== draftRef.current.text ||
      JSON.stringify(next.refs) !== JSON.stringify(draftRef.current.refs)
    ) {
      const { clientMessageId: _, ...changed } = next;
      next = changed;
    }
    draftRef.current = next;
    setDraftState(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      setError("Your draft could not be saved. Keep this window open.");
    }
  };
  useEffect(() => {
    mounted.current = true;
    let reading = false;
    const read = async () => {
      if (reading || !window.studi || school) return;
      reading = true;
      try {
        const next = await window.studi.getScopedConversation(target);
        if (mounted.current) setChat(next);
      } catch (cause) {
        if (mounted.current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Couldn’t load your conversation.",
          );
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 650);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (error)
      void window.studi
        ?.captureUiTelemetry({ event: "ui_error", message: error })
        .catch(() => undefined);
  }, [error]);
  useLayoutEffect(() => {
    const el = input.current;
    if (el) {
      el.style.height = "26px";
      el.style.height = `${Math.max(26, Math.min(130, el.scrollHeight))}px`;
    }
  }, [draft.text, view]);
  useEffect(() => {
    if (!school && log.current && messages.length) log.current.scrollTop = log.current.scrollHeight;
  }, [chat?.job.messages.length, timeline.length, active, view]);
  useEffect(() => {
    const persist = (event: Event) => {
      try {
        localStorage.setItem(key, JSON.stringify(draftRef.current));
      } catch {
        event.preventDefault();
        setError("Your draft could not be saved.");
      }
    };
    window.addEventListener("studi:before-update", persist);
    return () => window.removeEventListener("studi:before-update", persist);
  }, [key]);
  useEffect(() => {
    if (view !== "expanded") setBrowser(false);
  }, [view]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) {
        if (query !== null) {
          setQuery(null);
          return;
        }
        if (browser) setBrowser(false);
        else onView("home");
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [browser, onView, query]);
  const send = async (text = draft.text, refs = draft.refs) => {
    if (!window.studi || sendLock.current || !text.trim()) return;
    const sameDraft =
      text === draftRef.current.text &&
      JSON.stringify(refs) === JSON.stringify(draftRef.current.refs);
    const clientMessageId = sameDraft
      ? (draftRef.current.clientMessageId ?? crypto.randomUUID())
      : crypto.randomUUID();
    if (sameDraft) saveDraft({ ...draftRef.current, clientMessageId });
    sendLock.current = true;
    setSending(true);
    setError("");
    setQuery(null);
    if (view === "home") onView("compact");
    try {
      if (school) {
        if (!onboarding.scan) throw new Error("Start a school check first.");
        await window.studi.sendScanMessage({scanId:onboarding.scan.scanId,text,clientMessageId});
        if (mounted.current && draftRef.current.clientMessageId === clientMessageId) saveDraft({text:"",refs:[]});
        return;
      }
      const result = await window.studi.send({
        target,
        text,
        assignmentRefs: refs,
        clientMessageId,
      });
      if (mounted.current) {
        setChat({ job: result.job, activity: "idle" });
        if (
          draftRef.current.text === text &&
          JSON.stringify(draftRef.current.refs) === JSON.stringify(refs)
        )
          saveDraft({ text: "", refs: [] });
      }
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Your reply could not finish. Try again.",
        );
    } finally {
      sendLock.current = false;
      if (mounted.current) setSending(false);
    }
  };
  const stop = async () => {
    try {
      const result = await window.studi?.stopScopedConversation(target);
      if (result) setChat(result);
    } catch {
      setError("Couldn’t stop the reply yet. Try again.");
    }
  };
  const choose = (a: Assignment) => {
    const el = input.current;
    if (!el) return;
    const before = draft.text.slice(0, el.selectionStart);
    const start = before.lastIndexOf("@");
    const text =
      draft.text.slice(0, start) + draft.text.slice(el.selectionStart);
    saveDraft({
      text,
      refs:
        draft.refs.length >= 20 ||
        draft.refs.some((r) => r.assignmentId === a.assignmentId)
          ? draft.refs
          : [...draft.refs, { assignmentId: a.assignmentId, title: a.title }],
    });
    setQuery(null);
    el.focus();
  };
  const openBrowser = () => {
    setAnswer(null);
    setFilesOpen(false);
    void window.studi?.selectBrowserPage(school ? {kind:"school"} : target).then(state => {
      if (mounted.current) { onView("expanded"); setBrowser(true); }
      const url = assignment?.sourceTarget ?? onboarding.profile?.schoolRoot;
      if (url && (!state.browser.url || state.browser.url === "about:blank") && state.browser.driver !== "inky") {
        void window.studi?.navigateBrowser({url,target:school ? {kind:"school"} : target}).catch(cause => { if(mounted.current) setError(String(cause)); });
      }
    }).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
  };
  const content = (
    <section
      className={`chat-workspace chat-view-${view} ${browser || filesOpen || answer !== null ? "chat-with-browser" : ""}`}
      aria-label="Your conversation with Inky"
    >
      {view !== "home" && (
        <section className="conversation-paper" aria-label="Chat with Inky">
          <header className="conversation-header">
            <div
              className={`chat-presence ${chat?.activity === "typing" ? "is-typing" : ""}`}
            >
              <Inky
                state={mood}
                size={54}
                label={status}
              />
              <strong>{school ? "School check" : assignment?.title ?? "Chat with Inky"}</strong>
              <small role="status">{school ? "Your school" : assignment ? onboarding.courses.find(course => course.courseId === assignment.courseId)?.label : status}</small>
            </div>
            <div className="conversation-actions">
              {(school || assignment) && (
                <button
                  className="chat-icon"
                  aria-label={browser ? "Close school browser" : "Open school browser"}
                  aria-expanded={browser}
                  onClick={() => browser ? setBrowser(false) : openBrowser()}
                >
                  <Icon name="browser" />
                </button>
              )}
              {assignment && <button className="quiet-button" onClick={() => { setBrowser(false); setAnswer(null); setFilesOpen(true); }}>Files</button>}
              <button
                className="chat-icon"
                aria-label={school ? "Close school check" : assignment ? "Close assignment" : "Close chat"}
                onClick={() => onView("home")}
              >
                ×
              </button>
            </div>
          </header>
          <div
            className="conversation-log"
            ref={log}
            role={school ? "region" : "log"}
            aria-label={school ? "School check report" : "Messages"}
            aria-live={school ? "off" : "polite"}
          >
            {school && <SchoolCheck state={onboarding} lifecycle={lifecycle} onStopAndScan={props.onStopAndScan} onWait={() => onView("home")} onOpenWork={props.onOpenWork} browserOpen={browser} onAssignment={props.onAssignment ?? (() => {})} onCheck={props.onResumeScan} onPause={() => { void window.studi?.pauseSchoolScan().catch(cause => setError(String(cause))); }} onBrowser={() => browser ? setBrowser(false) : openBrowser()} busy={props.scanBusy} detailsOpen={scanDetails} onDetails={setScanDetails} />}
            {assignment && <details className="homework-instructions"><summary>Assignment instructions</summary><p>{assignment.instructions ?? "Open the assignment source so Inky can read its instructions."}</p><small>{assignment.dueAt ? new Date(assignment.dueAt).toLocaleString() : assignment.dueText ?? "No due date listed"}</small></details>}
            {!school && !assignment && !messages.length && (
              <article className="chat-bubble inky-bubble">
                <strong>
                  {assignment ? "Let’s work on this." : `Hey ${onboarding.profile?.studentName ?? "there"}.`}
                </strong>
                <p>
                  {assignment ? "Ask me a question or start the assignment. Our conversation and saved work stay together here." : "What’s on your mind? We can talk through your week, or start with one assignment."}
                </p>
              </article>
            )}
            {timeline.map((entry) => {
              if (entry.kind === "message") {
                const { message, index } = entry;
                return (
                  <article
                    key={message.messageId}
                    className={`chat-bubble ${message.role === "user" ? "student-bubble" : "inky-bubble"}`}
                  >
                    <small>{message.role === "user" ? "You" : "Inky"}</small>
                    {Boolean(message.assignmentRefs?.length) && (
                      <div className="chat-refs">
                        {message.assignmentRefs?.map((ref) => (
                          <span key={ref.assignmentId}>@ {ref.title}</span>
                        ))}
                      </div>
                    )}
                    <p>{message.text}</p>
                    {message.recovery === "failed" && (
                      <button
                        className="button button--yellow"
                        disabled={Boolean(active)}
                        onClick={() => {
                          const original = chat?.job.messages
                            .slice(0, index)
                            .reverse()
                            .find((m) => m.role === "user");
                          if (original)
                            void send(original.text, original.assignmentRefs ?? []);
                        }}
                      >
                        Try again
                      </button>
                    )}
                  </article>
                );
              }
              if (entry.kind === "assignment") return (
                <article key={entry.key} className="chat-task-card">
                  <small>
                    {assignment
                      ? onboarding.courses.find(
                          (c) => c.courseId === assignment.courseId,
                        )?.label
                      : "Your work"}
                  </small>
                  <h3>
                    {assignment?.title ??
                      onboarding.assignments.find(
                        (a) => a.assignmentId === execution?.assignmentId,
                      )?.title ??
                      "Current assignment"}
                  </h3>
                  <p>
                    {(execution?.phase === "needs_user" ? execution.lastError : undefined) ??
                      (task?.task.state === "discovered"
                        ? "Ready when you want to start."
                        : execution?.phase === "ready_review"
                          ? "Your work is ready. Review it before you hand it in."
                          : execution?.phase === "needs_user"
                            ? "Your school page needs you. I’ve kept your place."
                            : "Ask me about this assignment, or open its school page.")}
                  </p>
                  <div className="chat-card-actions">
                    {task &&
                      !work && task.permission.mayAttempt &&
                      ["discovered", "queued", "failed", "cancelled"].includes(
                        task.task.state,
                      ) && (
                        <button
                          className="button button--yellow"
                          onClick={() => props.onStart(task.task.taskId)}
                        >
                          {["failed", "cancelled"].includes(task.task.state) ? "Try assignment again" : "Start assignment"}
                        </button>
                      )}
                    <button
                      className="button button--paper"
                      onClick={openBrowser}
                    >
                      View assignment source
                    </button>
                    {execution?.answerArtifactId && (
                      <button
                        className="button button--paper"
                        onClick={() => {
                          void window.studi?.readArtifact({kind:"answer",artifactId:execution.answerArtifactId!}).then(document => { if (!document) throw new Error("This saved answer is no longer available."); setBrowser(false); setAnswer(document.content); }).catch(cause => setError(String(cause)));
                        }}
                      >
                        Open saved answer ↗
                      </button>
                    )}
                    {execution &&
                      ["working", "submitting"].includes(execution.phase) && (
                        <button
                          className="quiet-button"
                          disabled={execution.phase === "submitting"}
                          onClick={() => props.onTakeover(execution.taskId)}
                        >
                          Pause & take over
                        </button>
                      )}
                    {execution?.phase === "needs_user" && (
                      <button
                        className="button button--yellow"
                        onClick={() => props.onResume(execution.taskId)}
                      >
                        I’m done — check
                      </button>
                    )}
                    {execution && work && (
                      <button
                        className="quiet-button"
                        onClick={() => props.onCancel(execution.taskId)}
                      >
                        Cancel work
                      </button>
                    )}
                  </div>
                </article>
              );
              if (entry.kind === "review" && execution) return (
                <form
                  key={entry.key}
                  className="chat-task-card"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (confirmation.trim())
                      props.onVerifySubmission(
                        execution.taskId,
                        confirmation.trim(),
                      );
                  }}
                >
                  <h3>Take a look before you hand it in.</h3>
                  {reviewEndsAt && <p>Open for review until <time dateTime={reviewEndsAt}>{formatDateTime(reviewEndsAt)}</time>. When time runs out, I save your answers without submitting.</p>}
                  <p>
                    Open the school page and review your answer. After you submit
                    it yourself, tell me the confirmation you see.
                  </p>
                  <label>
                    Words shown after submission
                    <input
                      value={confirmation}
                      onChange={(e) => setConfirmation(e.target.value)}
                      placeholder="For example: Submitted successfully"
                      maxLength={1000}
                    />
                  </label>
                  <button
                    className="button button--yellow"
                    disabled={!confirmation.trim()}
                  >
                    I submitted it — check
                  </button>
                </form>
              );
              return null;
            })}
            {(error || props.actionError) && (
              <p className="chat-error" role="alert">
                {error || props.actionError}
              </p>
            )}
          </div>
        </section>
      )}
      {view === "home" && error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      {view === "home" && (workingAnywhere || active) && (
        <div className="chat-work-slip">
          <button onClick={() => { if (workingAnywhere) props.onOpenWork(); onView("expanded"); }}>
            <Inky state={mood} size={42} label={status} />
            <span>
              <strong>
                {active ? "I’m thinking about your message." : status}
              </strong>
              <small>
                {onboarding.assignments.find(
                  (a) => a.assignmentId === activeExecution?.assignmentId,
                )?.title ?? "Your conversation with Inky"}
              </small>
            </span>
            <span>↗</span>
          </button>
          {activeExecution?.phase === "working" && (
            <button
              className="chat-icon"
              aria-label="Pause assignment work"
              onClick={() => props.onTakeover(activeExecution.taskId)}
            >
              Ⅱ
            </button>
          )}
        </div>
      )}
      {(!school || (scanActive && !scanDetails)) && <form
        className={`inky-composer ${view === "home" && !workingAnywhere && !active ? "has-perched-inky" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          void (active ? stop() : send());
        }}
      >
        {view === "home" && !workingAnywhere && !active && (
          <button
            type="button"
            className="composer-mascot"
            aria-label="Open your conversation with Inky"
            onClick={() => onView("compact")}
          >
            <Inky state="hello" size={54} label="Inky waves hello" />
          </button>
        )}
        {draft.refs.length > 0 && (
          <div className="chat-refs">
            {draft.refs.map((ref) => (
              <span key={ref.assignmentId}>
                @ {ref.title}
                <button
                  type="button"
                  aria-label={`Remove ${ref.title}`}
                  onClick={() =>
                    saveDraft({
                      ...draft,
                      refs: draft.refs.filter(
                        (r) => r.assignmentId !== ref.assignmentId,
                      ),
                    })
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {query !== null && (
          <div className="assignment-picker">
            <header>
              Assignments <small>↑ ↓ to choose · Enter to add</small>
            </header>
            <div role="listbox" id="chat-assignments">
              {matches.length === 0 ? (
                <p>No assignments match.</p>
              ) : (
                matches.map((a, i) => (
                  <button
                    key={a.assignmentId}
                    type="button"
                    role="option"
                    id={`chat-option-${i}`}
                    aria-selected={i === option}
                    onClick={() => choose(a)}
                  >
                    <strong>{a.title}</strong>
                    <small>
                      {
                        onboarding.courses.find(
                          (c) => c.courseId === a.courseId,
                        )?.label
                      }{" "}
                      ·{" "}
                      {a.dueAt
                        ? new Date(a.dueAt).toLocaleDateString()
                        : a.dueText ?? "No due date"}
                    </small>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
        <div className="inky-composer-line">
          <textarea
            ref={input}
            aria-label="Message Inky"
            placeholder={school ? "Tell Inky something about this check…" : assignment ? "Ask about this assignment…" : "Hey Inky…"}
            disabled={school && !["running","needs_user"].includes(onboarding.scan?.state ?? "")}
            value={draft.text}
            rows={1}
            maxLength={20_000}
            aria-autocomplete="list"
            aria-controls="chat-assignments"
            aria-expanded={query !== null}
            {...(query !== null && matches[option]
              ? { "aria-activedescendant": `chat-option-${option}` }
              : {})}
            onChange={(e) => {
              saveDraft({ ...draft, text: e.target.value });
              const match = e.target.value
                .slice(0, e.target.selectionStart)
                .match(/(?:^|\s)@([^@\n]*)$/);
              setQuery(school ? null : match?.[1] ?? null);
              setOption(0);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (query !== null) {
                if (e.key === "Tab" || e.key === "Escape") {
                  if (e.key === "Escape") e.preventDefault();
                  setQuery(null);
                  e.stopPropagation();
                  return;
                }
                if (["Enter", "ArrowDown", "ArrowUp"].includes(e.key)) {
                  e.preventDefault();
                  if (e.key === "Enter") {
                    if (matches[option]) choose(matches[option]);
                  } else
                    setOption(
                      (i) =>
                        (i +
                          (e.key === "ArrowDown" ? 1 : -1) +
                          matches.length) %
                        Math.max(1, matches.length),
                    );
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!active) void send();
              }
            }}
          />
          <button
            className="chat-send"
            aria-label={active ? "Stop reply" : "Send message"}
            disabled={(!active && !draft.text.trim()) || (school && !["running","needs_user"].includes(onboarding.scan?.state ?? ""))}
          >
            <Icon name={active ? "stop" : "send"} size={20} />
          </button>
        </div>
      </form>}
      {(browser || filesOpen || answer !== null) && (error || props.actionError) && <p className="chat-error" role="alert">{error || props.actionError}</p>}
      {filesOpen && assignment && <HomeworkFiles assignmentId={assignment.assignmentId} onClose={() => setFilesOpen(false)} />}
      {answer !== null && <aside className="homework-answer"><header><strong>Saved answer</strong><button className="chat-icon" aria-label="Close saved answer" onClick={() => setAnswer(null)}>×</button></header><pre>{answer}</pre>{execution && <button className="quiet-button" onClick={() => props.onOpenArtifact(execution.taskId)}>Open file</button>}</aside>}
      {browser && view === "expanded" && (
        <SchoolBrowser
          onClose={() => setBrowser(false)}
          onSlot={props.onSchoolSlot}
          workspace={workspace}
          status={school ? onboarding.scan?.currentStep : execution?.lastError}
          onContinue={school && onboarding.scan?.state === "needs_user" ? props.onResumeScan : undefined}
          busy={props.scanBusy !== null}
          onPause={school && onboarding.scan?.state === "running" ? () => { void window.studi?.pauseSchoolScan().catch(cause => setError(String(cause))); } : execution?.phase === "working" ? () => props.onTakeover(execution.taskId) : undefined}
        />
      )}
    </section>
  );
  return view === "home" ? content : <WorkspaceDialog label={school ? "School check" : assignment?.title ?? "Chat with Inky"} onClose={() => onView("home")}>{content}</WorkspaceDialog>;
}

function SchoolBrowser({
  onClose,
  onSlot,
  workspace,
  status,
  onPause,
  onContinue,
  busy,
}: {
  onClose: () => void;
  onSlot: (bounds: SchoolPageBounds | null) => void;
  workspace: StudiWorkspaceState | null;
  status: string | undefined;
  onPause: (() => void) | undefined;
  onContinue?: () => void;
  busy?: boolean;
}) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    let frame = 0;
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = slot.current?.getBoundingClientRect();
        if (!rect || document.querySelector("dialog[open]:not(.workspace-dialog), .account-menu")) {
          onSlot(null);
          return;
        }
        onSlot({
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      });
    };
    const resize = new ResizeObserver(report);
    if (slot.current) resize.observe(slot.current);
    const mutations = new MutationObserver(report);
    mutations.observe(document.body, {
      attributes: true,
      attributeFilter: ["open"],
      subtree: true,
      childList: true,
    });
    window.addEventListener("resize", report);
    report();
    return () => {
      resize.disconnect();
      mutations.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", report);
      onSlot(null);
    };
  }, [onSlot]);
  return (
    <aside className="chat-browser">
      <header>
        <strong>School browser</strong>
        {onContinue && <button className="button button--yellow scan-browser-continue" disabled={busy} onClick={onContinue}>Continue scan<Icon name="right" size={16} /></button>}
        <button
          className="chat-icon"
          aria-label="Close browser"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <p className="chat-browser-owner">
        {status ?? (workspace?.browser.driver === "inky"
          ? "Inky is using the school page."
          : "Your school page. Take your time.")}
        {onPause && <button className="quiet-button" onClick={onPause}>Pause</button>}
      </p>
      <div className="chat-browser-slot" ref={slot}>
        {readDevPreviewConfig() && <PreviewSchoolPage mode="assignment" />}
      </div>
    </aside>
  );
}
