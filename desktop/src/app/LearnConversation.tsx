import { useEffect, useRef, useState } from "react";
import type { TimelineContext } from "../../shared/conversation-timeline.js";
import type { ConversationState } from "../../shared/index.js";
import { ConversationTimeline } from "./ConversationTimeline.js";
import { WorkspaceDialog } from "./WorkspaceDialog.js";
import { Icon } from "./Icon.js";
import { Inky } from "./Inky.js";

export function LearnConversation({
  storageKey,
  onOpenContext,
}: {
  storageKey: string;
  onOpenContext: (context: TimelineContext) => void;
}) {
  const key = "studi-chat-draft:" + storageKey + ":learn";
  const [draft, setDraft] = useState(() => localStorage.getItem(key) ?? ""),
    [chat, setChat] = useState<ConversationState | null>(null),
    [sheet, setSheet] = useState(false),
    [error, setError] = useState(""),
    [sending, setSending] = useState(false);
  const draftRef = useRef(draft),
    lock = useRef(false),
    alive = useRef(true),
    messageId = useRef<string | null>(null);
  useEffect(() => {
    alive.current = true;
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const next = await window.studi!.getScopedConversation({
          kind: "learn",
        });
        if (alive.current) setChat(next);
      } catch (cause) {
        if (alive.current) setError(String(cause));
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 1000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, []);
  const save = (text: string) => {
    draftRef.current = text;
    setDraft(text);
    messageId.current = null;
    try {
      localStorage.setItem(key, text);
    } catch {
      setError("Your draft could not be saved. Keep this window open.");
    }
  };
  const send = async () => {
    const text = draftRef.current.trim();
    if (lock.current || !text) return;
    lock.current = true;
    setSending(true);
    setError("");
    const id = messageId.current ?? crypto.randomUUID();
    messageId.current = id;
    try {
      const result = await window.studi!.send({
        target: { kind: "learn" },
        text,
        clientMessageId: id,
      });
      if (alive.current) {
        setChat({ job: result.job, activity: "idle" });
        if (draftRef.current.trim() === text) save("");
      }
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      lock.current = false;
      if (alive.current) setSending(false);
    }
  };
  const active = sending || Boolean(chat && chat.activity !== "idle");
  const stop = async () => {
    try {
      setChat(await window.studi!.stopScopedConversation({ kind: "learn" }));
    } catch (cause) {
      setError(String(cause));
    }
  };
  const last = chat?.job.messages
    .filter((message) => message.role === "assistant")
    .at(-1);
  const composer = (
    <div className="rd-learn-chatbox">
      {last && !sheet && (
        <button className="rd-conversation-peek" onClick={() => setSheet(true)}>
          <span>Inky</span>
          <span>{last.text}</span>
        </button>
      )}
      <form
        className="inky-composer rd-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void (draft.trim() ? send() : stop());
        }}
      >
        <button
          type="button"
          className="composer-mascot"
          aria-label="Open your conversation with Inky"
          onClick={() => setSheet(true)}
        >
          <Inky size={28} state={active ? "thinking" : "idle"} />
        </button>
        <span className="rd-composer-context">Learn</span>
        <div className="inky-composer-line">
          <textarea
            rows={1}
            aria-label="Message Inky about learning"
            placeholder="Hey Inky…"
            value={draft}
            maxLength={20000}
            onChange={(event) => save(event.target.value)}
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
            disabled={sending || (!draft.trim() && !active)}
            aria-label={draft.trim() ? "Send message" : "Stop reply"}
          >
            {draft.trim() ? <Icon name="send" size={17} /> : <Icon name="stop" size={15} />}
          </button>
        </div>
        <div className="rd-composer-suggestions">
          {[
            "When is my midterm?",
            "Quiz me on heaps",
            "Find my syllabus in Drive",
          ].map((text) => (
            <button
              key={text}
              type="button"
              className="rd-link"
              onClick={() => save(text)}
            >
              {text}
            </button>
          ))}
        </div>
      </form>
      {error && (
        <p className="rd-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
  return (
    <>
      <div className="rd-tutor-composer">{composer}</div>
      {sheet && (
        <WorkspaceDialog
          className="rd-sheet-dialog"
          label="You and Inky"
          onClose={() => setSheet(false)}
        >
          <ConversationTimeline
            onOpenContext={onOpenContext}
            composer={composer}
            error={error}
            onClose={() => setSheet(false)}
          />
        </WorkspaceDialog>
      )}
    </>
  );
}
