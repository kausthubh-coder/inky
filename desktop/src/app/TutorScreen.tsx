import type { TimelineContext } from "../../shared/conversation-timeline.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PublicTutorBlock,
  PublicTutorSession,
  TutorBlockAnswer,
} from "../../shared/tutor.js";
import { TutorModel } from "./TutorModels.js";
import { ChatMarkdown } from "./ChatMarkdown.js";
import { Inky } from "./Inky.js";
import { ConversationTimeline } from "./ConversationTimeline.js";
import { WorkspaceDialog } from "./WorkspaceDialog.js";

const blockName = {
  tutor_say: "Inky",
  tutor_ask_choice: "Multiple choice",
  tutor_ask_typed: "Typed answer",
  tutor_ask_explain: "Explain it back",
  tutor_show_model: "Interactive model",
  tutor_finish: "Session finished",
};
export function TutorScreen({
  initial,
  onLeave,
  onOpenContext,
}: {
  initial: PublicTutorSession;
  onLeave: () => void;
  onOpenContext: (context: TimelineContext) => void;
}) {
  const [session, setSession] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [clock, setClock] = useState(Date.now()),
    [sheet, setSheet] = useState(false);
  const [message, setMessage] = useState(
    () =>
      localStorage.getItem("studi-tutor-message:" + initial.sessionId) ?? "",
  );
  const lock = useRef(false),
    mounted = useRef(true),
    revision = useRef(initial.updatedAt),
    messageId = useRef<string | null>(null);
  const flushDraft = useRef<() => Promise<void>>(async () => {});
  const registerFlush = useCallback((flush: () => Promise<void>) => {
    flushDraft.current = flush;
    return () => {
      if (flushDraft.current === flush) flushDraft.current = async () => {};
    };
  }, []);
  const apply = useCallback((next: PublicTutorSession) => {
    if (next.updatedAt >= revision.current) {
      revision.current = next.updatedAt;
      setSession(next);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    let reading = false;
    const read = async () => {
      if (reading || lock.current) return;
      reading = true;
      try {
        const next = await window.studi!.getTutorSession({
          sessionId: initial.sessionId,
        });
        if (mounted.current) apply(next);
      } catch (cause) {
        if (mounted.current) setError(String(cause));
      } finally {
        reading = false;
      }
    };
    const timer = setInterval(() => {
      setClock(Date.now());
      void read();
    }, 1200);
    void read();
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [initial.sessionId, apply]);
  const run = async (action: () => Promise<PublicTutorSession>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await flushDraft.current();
      const next = await action();
      if (mounted.current) apply(next);
      return next;
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const answer = (block: PublicTutorBlock, answer: TutorBlockAnswer) =>
    run(() =>
      window.studi!.answerTutorBlock({
        sessionId: session.sessionId,
        blockId: block.blockId,
        answer,
      }),
    );
  const remaining = Math.max(
    0,
    session.budgetSeconds -
      session.elapsedSeconds -
      (session.activeSince
        ? Math.max(0, (clock - Date.parse(session.activeSince)) / 1000)
        : 0),
  );
  const activeBlock = session.blocks.find((block) => block.status === "open");
  const previous = session.blocks.filter(
    (block) => block !== activeBlock && block.tool !== "tutor_finish",
  );
  const closed = !["active", "paused"].includes(session.status);
  const leave = async () => {
    if (session.status === "active") {
      const next = await run(() =>
        window.studi!.pauseTutorSession({ sessionId: session.sessionId }),
      );
      if (!next) return;
    }
    onLeave();
  };
  const send = async () => {
    const text = message.trim();
    if (!text) return;
    const id = messageId.current ?? crypto.randomUUID();
    messageId.current = id;
    const next = await run(() =>
      window.studi!.sendTutorMessage({
        sessionId: session.sessionId,
        text,
        messageId: id,
      }),
    );
    if (next) {
      setMessage("");
      messageId.current = null;
      localStorage.removeItem("studi-tutor-message:" + session.sessionId);
    }
  };
  const composer = (
    <form
      className="rd-composer inky-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void (message.trim()
          ? send()
          : run(() =>
              window.studi!.pauseTutorSession({ sessionId: session.sessionId }),
            ));
      }}
    >
      <button
        className="composer-mascot"
        type="button"
        aria-label="Open conversation"
        onClick={() => setSheet(true)}
      >
        <Inky size={28} state={busy ? "thinking" : "idle"} />
      </button>
      <span className="rd-composer-context">This session · {session.goal}</span>
      <div className="inky-composer-line">
        <textarea
          rows={1}
          aria-label="Message Inky about this session"
          placeholder="Hey Inky…"
          maxLength={10000}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value);
            messageId.current = null;
            localStorage.setItem(
              "studi-tutor-message:" + session.sessionId,
              event.target.value,
            );
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button
          className="chat-send"
          disabled={
            busy || closed || (!message.trim() && session.status !== "active")
          }
          aria-label={message.trim() ? "Send message" : "Pause session"}
        >
          {message.trim() ? "↑" : "■"}
        </button>
      </div>
    </form>
  );
  return (
    <main className="app-shell rd-learn rd-tutor" data-studi-app-ready="true">
      <header className="rd-tutor-heading">
        <button
          className="rd-link"
          disabled={busy}
          onClick={() => void leave()}
        >
          Leave
        </button>
        <strong>{session.goal}</strong>
        <span>
          {Math.ceil(remaining / 60)} min left of{" "}
          {Math.round(session.budgetSeconds / 60)}
        </span>
        {session.status === "active" && (
          <button
            className="rd-link"
            disabled={busy}
            onClick={() =>
              void run(() =>
                window.studi!.pauseTutorSession({
                  sessionId: session.sessionId,
                }),
              )
            }
          >
            Pause
          </button>
        )}
      </header>
      <div className="rd-tutor-scroll">
        <div className="rd-tutor-column">
          {previous.map((block) => (
            <details className="rd-past" key={block.blockId}>
              <summary>
                <b>{blockName[block.tool]}</b>
                <span>
                  {block.tool === "tutor_say"
                    ? block.args.text
                    : block.tool === "tutor_ask_explain"
                      ? block.args.prompt
                      : block.tool === "tutor_show_model"
                        ? block.args.model.replaceAll("_", " ")
                        : block.tool === "tutor_finish"
                          ? block.args.summary
                          : block.args.question}
                </span>
                <em>
                  {block.result?.correct === true
                    ? "Right"
                    : block.result?.correct === false
                      ? "Not yet"
                      : block.status === "answered"
                        ? "Explored"
                        : ""}
                </em>
              </summary>
              {block.result && (
                <p>
                  {block.result.answer.kind === "typed"
                    ? block.result.answer.answer
                    : block.result.answer.kind === "explain"
                      ? block.result.answer.text
                      : block.result.answer.kind === "choice" &&
                          block.tool === "tutor_ask_choice"
                        ? block.args.options[block.result.answer.picked]
                        : block.result.answer.kind === "model"
                          ? block.result.answer.explored.join(" · ")
                          : ""}
                </p>
              )}
            </details>
          ))}
          {session.status === "paused" && (
            <div className="rd-session-notice">
              <Inky size={52} state="idle" />
              <h1>Right where we left off.</h1>
              <p>Your answers and drafts are saved.</p>
              <button
                className="rd-button primary"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    window.studi!.resumeTutorSession({
                      sessionId: session.sessionId,
                    }),
                  )
                }
              >
                Resume session
              </button>
              <button
                className="rd-link"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    window.studi!.cancelTutorSession({
                      sessionId: session.sessionId,
                    }),
                  )
                }
              >
                End this session
              </button>
            </div>
          )}
          {activeBlock && !closed && (
            <TutorBlockView
              key={activeBlock.blockId}
              block={activeBlock}
              sessionId={session.sessionId}
              disabled={busy || session.status !== "active"}
              onAnswer={answer}
              onHint={() =>
                void run(() =>
                  window.studi!.hintTutorBlock({
                    sessionId: session.sessionId,
                    blockId: activeBlock.blockId,
                  }),
                )
              }
              onError={setError}
              registerFlush={registerFlush}
            />
          )}
          {!activeBlock && session.status === "active" && (
            <div className="rd-tutor-says" role="status">
              <Inky size={52} state="thinking" />
              <p>I’m thinking about what comes next.</p>
            </div>
          )}
          {closed && (
            <section className="rd-session-result">
              <div className="rd-tutor-says">
                <Inky size={52} state="idle" />
                <h1>
                  {session.status === "completed"
                    ? "That’s today’s session."
                    : session.status === "expired"
                      ? "Time for a pause."
                      : "We’ve stopped here."}
                </h1>
              </div>
              <ChatMarkdown
                text={
                  session.result?.summary ??
                  session.error ??
                  "Your completed answers are saved."
                }
              />
              {session.result?.level !== null &&
                session.result?.level !== undefined && (
                  <p>
                    Level {session.result.previousLevel ?? "not checked"} →{" "}
                    {session.result.level}
                  </p>
                )}
              {session.result?.evidence.map((item, index) => (
                <p key={index}>✓ {item.rationale}</p>
              ))}
              {Boolean(session.result?.missing.length) && (
                <>
                  <h2>Still to practise</h2>
                  <ul>
                    {session.result?.missing.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
              {session.result?.next && <p>Next: {session.result.next}</p>}
              <button className="rd-button primary" onClick={onLeave}>
                Back to Learn
              </button>
            </section>
          )}
          {(error || session.error) && (
            <p className="rd-error" role="alert">
              {error || session.error}
            </p>
          )}
        </div>
      </div>
      <div className="rd-tutor-composer">{composer}</div>
      {sheet && (
        <WorkspaceDialog
          className="rd-sheet-dialog"
          label="You and Inky"
          onClose={() => setSheet(false)}
        >
          <ConversationTimeline
            onOpenContext={(context) => {
              void (async () => {
                await flushDraft.current();
                if (session.status === "active") {
                  const next = await run(() =>
                    window.studi!.pauseTutorSession({
                      sessionId: session.sessionId,
                    }),
                  );
                  if (!next) return;
                }
                onOpenContext(context);
              })().catch((cause) => setError(String(cause)));
            }}
            composer={composer}
            error={error}
            onClose={() => setSheet(false)}
          />
        </WorkspaceDialog>
      )}
    </main>
  );
}
function TutorBlockView({
  block,
  sessionId,
  disabled,
  onAnswer,
  onHint,
  onError,
  registerFlush,
}: {
  block: PublicTutorBlock;
  sessionId: string;
  disabled: boolean;
  onAnswer: (
    block: PublicTutorBlock,
    answer: TutorBlockAnswer,
  ) => Promise<unknown>;
  onHint: () => void;
  onError: (message: string) => void;
  registerFlush: (flush: () => Promise<void>) => () => void;
}) {
  const draftKey = "studi-tutor-draft:" + sessionId + ":" + block.blockId;
  const [draft, setDraft] = useState(
    () => localStorage.getItem(draftKey) ?? block.draft,
  );
  const [explored, setExplored] = useState<string[]>([]);
  const explore = useCallback(
    (action: string) =>
      setExplored((previous) =>
        [...previous.filter((item) => item !== action), action].slice(-50),
      ),
    [],
  );
  const latest = useRef(draft);
  latest.current = draft;
  const saved = useRef(block.draft),
    saving = useRef<Promise<void>>(Promise.resolve());
  const flush = useCallback(() => {
    const value = latest.current;
    saving.current = saving.current
      .catch(() => {})
      .then(async () => {
        if (saved.current === value) return;
        await window.studi!.saveTutorDraft({
          sessionId,
          blockId: block.blockId,
          draft: value,
        });
        saved.current = value;
      });
    return saving.current;
  }, [sessionId, block.blockId]);
  useEffect(() => registerFlush(flush), [registerFlush, flush]);
  useEffect(() => {
    if (draft === saved.current) return;
    const timer = setTimeout(() => {
      void flush().catch((cause) =>
        onError("Your draft is saved on this device. " + String(cause)),
      );
    }, 500);
    return () => clearTimeout(timer);
  }, [draft, flush]);
  const edit = (value: string) => {
    latest.current = value;
    setDraft(value);
    try {
      localStorage.setItem(draftKey, value);
    } catch {
      onError("Your draft could not be saved. Keep this window open.");
    }
  };
  const submit = async (answer: TutorBlockAnswer) => {
    const next = await onAnswer(block, answer);
    if (next) localStorage.removeItem(draftKey);
  };
  if (block.tool === "tutor_say")
    return (
      <div className="rd-tutor-says">
        <Inky size={52} state="idle" />
        <ChatMarkdown text={block.args.text} />
      </div>
    );
  if (block.tool === "tutor_finish")
    return <ChatMarkdown text={block.args.summary} />;
  return (
    <section className="rd-tutor-block" aria-label={blockName[block.tool]}>
      <div className="rd-tutor-says">
        <Inky size={52} state="idle" />
        <p>
          {block.tool === "tutor_ask_choice"
            ? "Go with your gut."
            : block.tool === "tutor_ask_typed"
              ? "Your turn."
              : block.tool === "tutor_ask_explain"
                ? "In your own words."
                : "Try it and see what changes."}
        </p>
      </div>
      {block.tool === "tutor_ask_choice" && (
        <>
          <h1>{block.args.question}</h1>
          <div className="rd-options">
            {block.args.options.map((option, index) => (
              <button
                key={index}
                className="rd-option"
                disabled={disabled}
                onClick={() => void submit({ kind: "choice", picked: index })}
              >
                {option}
              </button>
            ))}
          </div>
        </>
      )}
      {(block.tool === "tutor_ask_typed" ||
        block.tool === "tutor_ask_explain") && (
        <>
          <h1>
            {block.tool === "tutor_ask_typed"
              ? block.args.question
              : block.args.prompt}
          </h1>
          <form
            className={
              block.tool === "tutor_ask_typed"
                ? "rd-typed-form"
                : "rd-explain-form"
            }
            onSubmit={(event) => {
              event.preventDefault();
              if (draft.trim())
                void submit(
                  block.tool === "tutor_ask_typed"
                    ? { kind: "typed", answer: draft }
                    : { kind: "explain", text: draft },
                );
            }}
          >
            {block.tool === "tutor_ask_typed" ? (
              <input
                autoComplete="off"
                aria-label="Your answer"
                value={draft}
                maxLength={10000}
                disabled={disabled}
                onChange={(event) => edit(event.target.value)}
                placeholder="Your answer"
              />
            ) : (
              <textarea
                aria-label="Your explanation"
                value={draft}
                maxLength={10000}
                disabled={disabled}
                onChange={(event) => edit(event.target.value)}
                placeholder="Type it the way you’d say it out loud. Messy is fine."
              />
            )}
            <button
              className="rd-button primary"
              disabled={disabled || !draft.trim()}
            >
              {block.tool === "tutor_ask_typed" ? "Check" : "Send"}
            </button>
          </form>
        </>
      )}
      {block.tool === "tutor_ask_typed" && (
        <div className="rd-hints">
          {block.args.hints.map((hint, index) => (
            <div key={index}>
              <ChatMarkdown text={hint} />
            </div>
          ))}
          {block.args.hasMoreHints && (
            <button className="rd-link" disabled={disabled} onClick={onHint}>
              {block.hintsUsed === 0
                ? "Nudge me"
                : block.hintsUsed === 1
                  ? "Show one step"
                  : "Walk me through it"}
            </button>
          )}
        </div>
      )}
      {block.tool === "tutor_show_model" && (
        <>
          <TutorModel
            model={block.args}
            onExplore={explore}
            disabled={disabled}
          />
          <button
            className="rd-button primary"
            disabled={disabled || !explored.length}
            onClick={() => void submit({ kind: "model", explored })}
          >
            Try one myself →
          </button>
        </>
      )}
    </section>
  );
}
