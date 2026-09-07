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

export type ChatView = "home" | "compact" | "expanded";
interface ChatProps {
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
  scanBusy: boolean;
  onStart: (id: string) => void;
  onOpenWork: () => void;
  onTakeover: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onOpenArtifact: (id: string) => void;
  onVerifySubmission: (id: string, text: string) => void;
  onSchoolSlot: (bounds: SchoolPageBounds | null) => void;
  onResumeScan: () => void;
}
type Draft = {
  text: string;
  refs: AssignmentReference[];
  clientMessageId?: string;
};
function readDraft(key: string): Draft {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
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
  const key = `studi-chat-draft:${props.storageKey}`;
  const [draft, setDraftState] = useState(() => readDraft(key));
  const [chat, setChat] = useState<ConversationState | null>(null);
  const [sending, setSending] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [browser, setBrowser] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [option, setOption] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const sendLock = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const mounted = useRef(true);
  const active = (chat?.activity !== "idle" && Boolean(chat)) || sending;
  const execution =
    lifecycle.execution &&
    (!assignment ||
      lifecycle.execution.assignmentId === assignment.assignmentId)
      ? lifecycle.execution
      : null;
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
  if (onboarding.scan?.state === "needs_user") {
    cards.push({
      kind: "scan_handoff",
      key: `handoff:${onboarding.scan.scanId}`,
      createdAt: onboarding.scan.handoff?.requestedAt ?? onboarding.scan.updatedAt,
    });
  }
  const timeline = chatTimeline(chat?.job.messages ?? [], cards);
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
      if (reading || !window.studi) return;
      reading = true;
      try {
        const next = await window.studi.getConversationState();
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
      el.style.height = `${Math.min(130, el.scrollHeight)}px`;
    }
  }, [draft.text, view]);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
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
      const result = await window.studi.send({
        target: { kind: "home" },
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
      const result = await window.studi?.stopConversation();
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
    onView("expanded");
    setBrowser(true);
    if (
      assignment &&
      !lifecycle.execution &&
      workspace?.browser.driver !== "inky"
    ) {
      void window.studi
        ?.navigateBrowser({ url: assignment.sourceTarget })
        .catch((cause) =>
          setError(
            cause instanceof Error
              ? cause.message
              : "Couldn’t open the school page.",
          ),
        );
    }
  };
  return (
    <section
      className={`chat-workspace chat-view-${view} ${browser ? "chat-with-browser" : ""}`}
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
                size={view === "expanded" ? 100 : 72}
                label={status}
              />
              <strong>Inky</strong>
              <small role="status">{status}</small>
            </div>
            <div className="conversation-actions">
              {view === "expanded" && (
                <button
                  className="chat-icon"
                  aria-label="Open browser"
                  onClick={openBrowser}
                >
                  ▣
                </button>
              )}
              <button
                className="chat-icon chat-expand"
                aria-label={
                  view === "expanded" ? "Minimize chat" : "Expand chat"
                }
                onClick={() =>
                  onView(view === "expanded" ? "compact" : "expanded")
                }
              >
                ⤢
              </button>
              <button
                className="chat-icon"
                aria-label="Tuck chat away"
                onClick={() => onView("home")}
              >
                ×
              </button>
            </div>
          </header>
          <div
            className="conversation-log"
            ref={log}
            role="log"
            aria-label="Messages"
            aria-live="polite"
          >
            {!chat?.job.messages.length && (
              <article className="chat-bubble inky-bubble">
                <strong>
                  Hey {onboarding.profile?.studentName ?? "there"}.
                </strong>
                <p>
                  What’s on your mind? We can talk through your week, or start
                  with one assignment.
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
                    {execution?.returnPredicate ??
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
                      !work &&
                      ["discovered", "ready", "failed", "cancelled"].includes(
                        task.task.state,
                      ) && (
                        <button
                          className="button button--yellow"
                          onClick={() => props.onStart(task.task.taskId)}
                        >
                          Start assignment
                        </button>
                      )}
                    <button
                      className="button button--paper"
                      onClick={openBrowser}
                    >
                      Open school page ↗
                    </button>
                    {execution?.answerArtifactId && (
                      <button
                        className="button button--paper"
                        onClick={() => props.onOpenArtifact(execution.taskId)}
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
              if (entry.kind === "scan_handoff" && onboarding.scan) return (
                <article key={entry.key} className="chat-task-card">
                  <h3>Could you sign in for me?</h3>
                  <p>{onboarding.scan.currentStep}</p>
                  <button className="button button--yellow" onClick={openBrowser}>
                    Open school page ↗
                  </button>
                  <button className="quiet-button" onClick={props.onResumeScan} disabled={props.scanBusy}>
                    {props.scanBusy ? "Checking…" : "I’m done — check"}
                  </button>
                </article>
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
      <form
        className={`inky-composer ${view === "home" && !work && !active ? "has-perched-inky" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          void (active ? stop() : send());
        }}
      >
        {view === "home" && !work && !active && (
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
                        : "No due date"}
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
            placeholder="Hey Inky…"
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
              setQuery(match?.[1] ?? null);
              setOption(0);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (query !== null) {
                if (e.key === "Tab" || e.key === "Escape") {
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
            disabled={!active && !draft.text.trim()}
          >
            <Icon name={active ? "stop" : "send"} size={20} />
          </button>
        </div>
      </form>
      {browser && view === "expanded" && (
        <SchoolBrowser
          onClose={() => setBrowser(false)}
          onSlot={props.onSchoolSlot}
          workspace={workspace}
        />
      )}
    </section>
  );
}

function SchoolBrowser({
  onClose,
  onSlot,
  workspace,
}: {
  onClose: () => void;
  onSlot: (bounds: SchoolPageBounds | null) => void;
  workspace: StudiWorkspaceState | null;
}) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    let frame = 0;
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = slot.current?.getBoundingClientRect();
        if (!rect || document.querySelector("dialog[open], .account-menu")) {
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
        <button
          className="chat-icon"
          aria-label="Close browser"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <p className="chat-browser-owner">
        {workspace?.browser.driver === "inky"
          ? "Inky is using the school page."
          : "Your school page. Take your time."}
      </p>
      <div className="chat-browser-slot" ref={slot}>
        {readDevPreviewConfig() && <PreviewSchoolPage mode="assignment" />}
      </div>
    </aside>
  );
}
