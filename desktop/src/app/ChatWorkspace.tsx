import type { TimelineContext } from "../../shared/conversation-timeline.js";
import { plainError } from "./homeworkText.js";
import { onEngineChange } from "./engineChanges.js";
import { ConversationTimeline } from "./ConversationTimeline.js";
import { WorkspaceDialog } from "./WorkspaceDialog.js";
import { ChatMarkdown } from "./ChatMarkdown.js";
import { AssignmentWorkspace, composerPlaceholder } from "./AssignmentWorkspace.js";
import { SchoolCheck } from "./SchoolCheck.js";
import { Icon } from "./Icon.js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { homeworkRecord } from "../../shared/index.js";
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
import { Character } from "./Character.js";
import type { DotState } from "../../shared/characters/states.js";
import { PreviewSchoolPage } from "./PreviewSchoolPage.js";
import { readDevPreviewConfig } from "./devPreview.js";
import { chatTimeline } from "./chatTimeline.js";
import { useSchoolSlot } from "./schoolSlot.js";

export type ChatView = "home" | "compact" | "expanded";
interface ChatProps {
  onOpenContext: (context: TimelineContext) => void;
  schoolCheck?: boolean;
  contextAssignment?: Assignment | null;
  onAssignment?: (id: string) => void;
  view: ChatView;
  onView: (view: ChatView) => void;
  storageKey: string;
  onboarding: SchoolOnboardingState;
  lifecycle: LifecycleState;
  workspace: StudiWorkspaceState | null;
  assignment: Assignment | null;
  task: TaskSummary | null;
  mood: DotState;
  actionError: string | null;
  scanBusy: string | null;
  onStart: (id: string) => void;
  onOpenWork: () => void;
  onOpenSchoolCheck: () => void;
  onOpenRules: () => void;
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
function readDraft(key: string, legacyKey?: string): Draft {
  try {
    const saved = JSON.parse(
      localStorage.getItem(key) ??
        (legacyKey ? localStorage.getItem(legacyKey) : null) ??
        "{}",
    );
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
  const contextAssignment = assignment ?? props.contextAssignment;
  const target = contextAssignment
    ? {
        kind: "assignment" as const,
        assignmentId: contextAssignment.assignmentId,
      }
    : { kind: "home" as const };
  const school = Boolean(props.schoolCheck);
  const scope = school ? "school" : (contextAssignment?.assignmentId ?? "home");
  const key = `studi-chat-draft:${props.storageKey}:${scope}`;
  const [draft, setDraftState] = useState(() =>
    readDraft(
      key,
      scope === "home" ? `studi-chat-draft:${props.storageKey}` : undefined,
    ),
  );
  const [chat, setChat] = useState<ConversationState | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setErrorText] = useState("");
  const setError = (cause: unknown) => setErrorText(plainError(cause));
  const actionError = plainError(props.actionError ?? "");
  const [browser, setBrowser] = useState(
    Boolean(assignment || props.schoolCheck),
  );
  const [scanDetails, setScanDetails] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [option, setOption] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const sendLock = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const mounted = useRef(true);
  const initialBrowserOpened = useRef(false);
  const active = (chat?.activity !== "idle" && Boolean(chat)) || sending;
  const execution =
    !school && assignment
      ? lifecycle.execution?.assignmentId === assignment.assignmentId
        ? lifecycle.execution
        : (task?.execution ?? null)
      : null;
  const record = assignment
    ? homeworkRecord({ assignment, task: task?.task ?? null, execution, mayAttempt: task?.permission.mayAttempt ?? false })
    : null;
  const activeExecution = lifecycle.execution;
  const workingAnywhere =
    activeExecution &&
    ["working", "needs_user", "ready_review", "submitting"].includes(
      activeExecution.phase,
    );
  // The send button turns into Stop only while Dot is working; pauses and reviews have their own Stop.
  const stoppableAssignment =
    execution?.phase === "working"
      ? execution
      : !assignment && activeExecution?.phase === "working"
        ? activeExecution
        : null;
  const messages = school
    ? (onboarding.scan?.messages ?? []).map((message, index) => ({
        ...message,
        turnIndex: index,
      }))
    : (chat?.job.messages ?? []);
  const scanActive = school && onboarding.scan?.state === "running";
  const scanOpen = school && ["running", "needs_user"].includes(onboarding.scan?.state ?? "");
  const timeline = chatTimeline(
    school && !(scanOpen && !scanDetails) ? [] : messages,
    [],
  );
  useEffect(() => {
    setScanDetails(false);
  }, [onboarding.scan?.scanId]);
  const mood: DotState =
    chat?.activity === "typing"
      ? "thinking"
      : active
        ? "thinking"
        : workingAnywhere
          ? props.mood
          : "idle";
  const status =
    chat?.activity === "typing"
      ? "Dot is typing…"
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
        const next = await window.studi!.getScopedConversation(target);
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
    const stop = onEngineChange(["conversation"], () => void read());
    return () => {
      mounted.current = false;
      stop();
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
    if (
      !log.current ||
      !messages.length ||
      (school && !(scanOpen && !scanDetails))
    )
      return;
    if (school || assignment)
      log.current.lastElementChild?.scrollIntoView({ block: "nearest" });
    else log.current.scrollTop = log.current.scrollHeight;
  }, [
    chat?.job.messages.length,
    timeline.length,
    active,
    view,
    school,
    scanActive,
    scanDetails,
    assignment,
  ]);
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
    if (view === "expanded" && (assignment || school)) setBrowser(true);
    else if (view === "home") setBrowser(false);
  }, [view]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) {
        if (query !== null) {
          setQuery(null);
          return;
        }
        onView("home");
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
        await window.studi!.sendScanMessage({
          scanId: onboarding.scan.scanId,
          text,
          clientMessageId,
        });
        if (
          mounted.current &&
          draftRef.current.clientMessageId === clientMessageId
        )
          saveDraft({ text: "", refs: [] });
        return;
      }
      const result = await window.studi!.send({
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
      if (school) {
        await window.studi!.pauseSchoolScan();
        return;
      }
      if (stoppableAssignment) {
        props.onCancel(stoppableAssignment.taskId);
        return;
      }
      const result = await window.studi?.stopScopedConversation(target);
      if (result) setChat(result);
    } catch {
      setError(
        stoppableAssignment
          ? "Couldn’t stop the assignment yet. Try again."
          : "Couldn’t stop the reply yet. Try again.",
      );
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
  const [addingFiles, setAddingFiles] = useState(false);
  // Notes, a rubric or starter files the student has, straight into the assignment's folder.
  const addFiles = async () => {
    if (!assignment || !window.studi || addingFiles) return;
    setAddingFiles(true);
    try {
      const result = await window.studi.importAssignmentFiles({ assignmentId: assignment.assignmentId });
      if (result.errors.length) setError(result.errors.map((item) => `${item.name}: ${item.message}`).join("\n"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAddingFiles(false);
    }
  };
  const suggest = (text: string) => {
    saveDraft({ ...draftRef.current, text });
    input.current?.focus();
  };
  const suggestions = homeSuggestions(onboarding, lifecycle);
  const openBrowser = () => {
    void window.studi
      ?.selectBrowserPage(school ? { kind: "school" } : target)
      .then((state) => {
        if (!mounted.current) return;
        onView("expanded");
        setBrowser(true);
        const url = assignment?.sourceTarget ?? onboarding.profile?.schoolRoot;
        if (
          url &&
          (!state.browser.url || state.browser.url === "about:blank") &&
          state.browser.driver !== "inky"
        ) {
          void window.studi
            ?.navigateBrowser({
              url,
              target: school ? { kind: "school" } : target,
            })
            .catch((cause) => {
              if (mounted.current) setError(String(cause));
            });
        }
      })
      .catch((cause) => {
        if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
      });
  };
  useEffect(() => {
    if (initialBrowserOpened.current || (!school && !assignment)) return;
    initialBrowserOpened.current = true;
    openBrowser();
  }, [school, assignment?.assignmentId]);
  const conversation = (
    <div
      className="conversation-log"
      ref={log}
      role={school ? "region" : "log"}
      aria-label={school ? "School check report" : "Messages"}
      aria-live={school ? "off" : "polite"}
    >
      {school && (
        <SchoolCheck
          state={onboarding}
          lifecycle={lifecycle}
          onStopAndScan={props.onStopAndScan}
          onWait={() => onView("home")}
          onOpenWork={props.onOpenWork}
          browserOpen={browser}
          onAssignment={props.onAssignment ?? (() => {})}
          onCheck={props.onResumeScan}
          onPause={() => {
            void window.studi
              ?.finishSchoolScan()
              .catch((cause) => setError(String(cause)));
          }}
          onBrowser={openBrowser}
          busy={props.scanBusy}
          detailsOpen={scanDetails}
          onDetails={setScanDetails}
        />
      )}
      {!school && !assignment && !messages.length && (
        <article className="chat-bubble inky-bubble">
          <strong>
            {`Hey ${onboarding.profile?.studentName ?? "there"}.`}
          </strong>
          <p>
            What’s on your mind? We can talk through your week, or start with
            one assignment.
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
              <small>{message.role === "user" ? "You" : "Dot"}</small>
              {Boolean(message.assignmentRefs?.length) && (
                <div className="chat-refs">
                  {message.assignmentRefs?.map((ref) => (
                    <span key={ref.assignmentId}>@ {ref.title}</span>
                  ))}
                </div>
              )}
              {message.role === "user" ? (
                <p>{message.text}</p>
              ) : (
                <ChatMarkdown text={message.text} />
              )}
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
        return null;
      })}
    </div>
  );
  const composer =
    !school || (scanOpen && !scanDetails) ? (
      <form
        className="inky-composer rd-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void (draft.text.trim() ? send() : stop());
        }}
      >
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
                        : (a.dueText ?? "No due date")}
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
            aria-label="Message Dot"
            placeholder={
              school
                ? "Steer this check…"
                : assignment
                  ? composerPlaceholder(record?.state, record?.needs)
                  : contextAssignment
                    ? `Ask about ${contextAssignment.title}…`
                    : "Ask Dot anything, or paste a homework link…"
            }
            disabled={
              school &&
              !["running", "needs_user"].includes(onboarding.scan?.state ?? "")
            }
            value={draft.text}
            rows={1}
            maxLength={20_000}
            aria-autocomplete="list"
            aria-controls="chat-assignments"
            aria-expanded={query !== null}
            {...(query !== null && matches[option]
              ? { "aria-activedescendant": `chat-option-${option}` }
              : {})}
            onFocus={() => {
              if (view === "home" && !assignment && !school) onView("compact");
            }}
            onChange={(e) => {
              saveDraft({ ...draft, text: e.target.value });
              const match = e.target.value
                .slice(0, e.target.selectionStart)
                .match(/(?:^|\s)@([^@\n]*)$/);
              setQuery(school ? null : (match?.[1] ?? null));
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
                if (!sending) void send();
              }
            }}
          />
        </div>
        {/* A toolbar under the text, like T3 Code: extras on the left, send or stop on the right. */}
        <div className="rd-composer-foot">
          {assignment ? (
            <button type="button" className="rd-composer-tool" disabled={addingFiles} onClick={() => void addFiles()}>
              <Icon name="folder" size={15} /> {addingFiles ? "Adding…" : "Add files"}
            </button>
          ) : school ? <span /> : (
            <span className="rd-composer-hint">Type @ to ask about an assignment</span>
          )}
          <button
            className="chat-send"
            aria-label={
              !draft.text.trim() && (active || stoppableAssignment || scanActive)
                ? stoppableAssignment
                  ? "Stop assignment"
                  : school
                    ? "Stop school check"
                    : "Stop reply"
                : "Send message"
            }
            disabled={
              sending ||
              (!(active || stoppableAssignment || scanActive) &&
                !draft.text.trim()) ||
              (school &&
                !["running", "needs_user"].includes(
                  onboarding.scan?.state ?? "",
                ))
            }
          >
            <Icon
              name={
                !draft.text.trim() && (active || stoppableAssignment || scanActive)
                  ? "stop"
                  : "send"
              }
              size={20}
            />
          </button>
        </div>
      </form>
    ) : null;
  const schoolBrowser =
    browser && view === "expanded" ? (
      <SchoolBrowser
        onClose={() => setBrowser(false)}
        onSlot={props.onSchoolSlot}
        workspace={workspace}
        onPause={
          school && onboarding.scan?.state === "running"
            ? () => {
                void window.studi
                  ?.pauseSchoolScan()
                  .catch((cause) => setError(String(cause)));
              }
            : execution?.phase === "working"
              ? () => props.onTakeover(execution.taskId)
              : undefined
        }
      />
    ) : null;
  const content =
    !assignment && !school && view !== "home" ? (
      <ConversationTimeline
        onOpenContext={props.onOpenContext}
        composer={composer}
        onClose={() => onView("home")}
        error={error || actionError}
        assignments={onboarding.assignments}
        suggestions={suggestions}
        onSuggest={suggest}
      />
    ) : assignment && view !== "home" ? (
      <AssignmentWorkspace
        assignment={assignment}
        task={task}
        execution={execution}
        lifecycle={lifecycle}
        onboarding={onboarding}
        workspace={workspace}
        busy={props.scanBusy}
        messages={chat?.job.messages ?? []}
        thinking={active}
        composer={composer}
        error={
          (error || actionError) && (
            <p className="chat-error" role="alert">
              {error || actionError}
            </p>
          )
        }
        onClose={() => onView("home")}
        onBrowser={openBrowser}
        onSchoolSlot={props.onSchoolSlot}
        onStart={props.onStart}
        onResume={props.onResume}
        onPause={props.onTakeover}
        onCancel={props.onCancel}
        onOpenWork={props.onOpenWork}
        onOpenRules={props.onOpenRules}
        onOpenArtifact={props.onOpenArtifact}
        onRetry={(message) => {
          const messages = chat?.job.messages ?? [];
          const original = messages.slice(0, messages.indexOf(message)).reverse().find((m) => m.role === "user");
          if (original) void send(original.text, original.assignmentRefs ?? []);
        }}
        onSuggest={suggest}
      />
    ) : (
      <section
        className={`chat-workspace chat-view-${view} ${browser ? "chat-with-browser" : ""} ${school ? "rd-school-workspace" : ""}`}
        aria-label="Your conversation with Dot"
      >
        {view !== "home" && (
          <section className="conversation-paper" aria-label="Chat with Dot">
            <header className="conversation-header">
              <div
                className={`chat-presence ${chat?.activity === "typing" ? "is-typing" : ""}`}
              >
                <Character state={mood} size={54} label={status} />
                <strong>
                  {school
                    ? "School check"
                    : (assignment?.title ?? "Chat with Dot")}
                </strong>
                <small role="status">{school ? "Your school" : status}</small>
              </div>
              <div className="conversation-actions">
                {school || assignment ? (
                  <button
                    className="rd-quiet rd-work-back"
                    aria-label={school ? "Close school check" : "Close assignment"}
                    onClick={() => onView("home")}
                  >
                    <Icon name="back" size={16} /> Back to your week
                  </button>
                ) : (
                  <button
                    className="chat-icon"
                    aria-label="Close chat"
                    onClick={() => onView("home")}
                  >
                    <Icon name="close" size={18} />
                  </button>
                )}
              </div>
            </header>
            {(error || actionError) && (
              <p className="chat-error assignment-action-error" role="alert">
                {error || actionError}
              </p>
            )}
            {conversation}
          </section>
        )}
        {view === "home" && error && (
          <p className="chat-error" role="alert">
            {error}
          </p>
        )}
        {view === "home" && (workingAnywhere || active) && (
          <div className="chat-work-slip">
            <button
              onClick={() => {
                if (workingAnywhere) props.onOpenWork();
                onView("expanded");
              }}
            >
              <Character state={mood} size={42} label={status} />
              <span>
                <strong>
                  {active ? "I’m thinking about your message." : status}
                </strong>
                <small>
                  {onboarding.assignments.find(
                    (a) => a.assignmentId === activeExecution?.assignmentId,
                  )?.title ?? "Your conversation with Dot"}
                </small>
              </span>
              <span><Icon name="external" size={14} /></span>
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
        {composer}
        {schoolBrowser}
      </section>
    );
  return (
    <>
      {view === "home" || (!assignment && !school) ? (
        content
      ) : (
        <WorkspaceDialog
          className={
            assignment || school ? "rd-full-dialog" : "rd-sheet-dialog"
          }
          label={
            school ? "School check" : (assignment?.title ?? "Chat with Dot")
          }
          onClose={() => onView("home")}
        >
          {content}
        </WorkspaceDialog>
      )}
    </>
  );
}

function SchoolBrowser({
  onSlot,
  workspace,
  onPause,
}: {
  onClose: () => void;
  onSlot: (bounds: SchoolPageBounds | null) => void;
  workspace: StudiWorkspaceState | null;
  onPause: (() => void) | undefined;
}) {
  const slot = useRef<HTMLDivElement>(null);
  useSchoolSlot(slot, onSlot);
  return (
    <aside className="chat-browser">
      <div className="chat-browser-slot" ref={slot}>
        {readDevPreviewConfig() && <PreviewSchoolPage mode="assignment" />}
        {readDevPreviewConfig() &&
          onPause &&
          workspace?.browser.driver === "inky" && (
            <button className="rd-preview-takeover" onClick={onPause}>
              Takeover
            </button>
          )}
      </div>
    </aside>
  );
}

/** Things an empty chat offers, built from the student's real week. */
function homeSuggestions(onboarding: SchoolOnboardingState, lifecycle: LifecycleState): string[] {
  const now = Date.now();
  const title = (id: string | undefined) => onboarding.assignments.find((item) => item.assignmentId === id)?.title;
  const waiting = lifecycle.execution?.phase === "needs_user" ? title(lifecycle.execution.assignmentId) : undefined;
  const next = onboarding.assignments
    .filter((item) => (item.category ?? "work") === "work" && !item.ignoredReason && item.owner !== "student" && Date.parse(item.dueAt ?? "") > now
      && !["submitted", "graded"].includes(item.schoolStatus?.state ?? ""))
    .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!))[0];
  return [
    "What's left before Friday?",
    ...(waiting ? [`What does ${waiting} need from me?`] : []),
    ...(next ? [`Start ${next.title}`] : []),
    "Add homework from a link",
  ];
}
