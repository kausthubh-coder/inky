import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  ConversationTimeline as Timeline,
  TimelineContext,
} from "../../shared/conversation-timeline.js";
import { ChatMarkdown } from "./ChatMarkdown.js";
import { Inky } from "./Inky.js";

export function ConversationTimeline({
  composer,
  onClose,
  error,
  onOpenContext,
}: {
  composer: ReactNode;
  onClose: () => void;
  error?: string | null;
  onOpenContext: (context: TimelineContext) => void;
}) {
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [eventsOnly, setEventsOnly] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [limit, setLimit] = useState(200);
  const bottom = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  useEffect(() => {
    let alive = true,
      reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const next = await window.studi!.getConversationTimeline({ limit });
        if (alive) {
          setTimeline(next);
          setLoadError("");
        }
      } catch (cause) {
        if (alive)
          setLoadError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 1200);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [limit]);
  useEffect(() => {
    if (nearBottom.current)
      bottom.current?.scrollIntoView({ block: "nearest" });
  }, [timeline?.entries.length, eventsOnly]);
  return (
    <section className="rd-conversation">
      <header className="rd-conversation-heading">
        <Inky size={34} state="idle" />
        <h1>You & Inky</h1>
        <button
          className="rd-link"
          aria-label="Close conversation"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <nav className="rd-conversation-tabs" aria-label="Conversation filter">
        <button aria-pressed={!eventsOnly} onClick={() => setEventsOnly(false)}>
          Everything
        </button>
        <button aria-pressed={eventsOnly} onClick={() => setEventsOnly(true)}>
          What Inky did
        </button>
      </nav>
      <div
        className="rd-conversation-log"
        role="log"
        aria-label="Conversation"
        onScroll={(event) => {
          const el = event.currentTarget;
          nearBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        }}
      >
        {!timeline && !loadError && (
          <p role="status">Opening our conversation…</p>
        )}
        {timeline?.hasMore &&
          (limit < 500 ? (
            <button className="rd-link" onClick={() => setLimit(500)}>
              Show earlier messages
            </button>
          ) : (
            <p className="rd-muted">Showing the most recent 500 entries.</p>
          ))}
        {timeline?.entries
          .filter((entry) => !eventsOnly || entry.kind === "event")
          .map((entry) => (
            <article
              key={entry.id}
              className={
                entry.kind === "event"
                  ? "rd-log-event"
                  : `rd-log-message ${entry.role}`
              }
            >
              <small>
                <button
                  className="rd-context-tag"
                  onClick={() => {
                    onClose();
                    onOpenContext(entry.context);
                  }}
                >
                  {entry.title ??
                    {
                      home: "Home",
                      learn: "Learn",
                      assignment: "Assignment",
                      scan: "School check",
                      tutor: "Learning",
                    }[entry.context.kind]}
                </button>{" "}
                ·{" "}
                <time dateTime={entry.createdAt}>
                  {new Date(entry.createdAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
              </small>
              {entry.kind === "message" && (
                <strong>{entry.role === "user" ? "You" : "Inky"}</strong>
              )}
              <ChatMarkdown text={entry.text} />
              {entry.kind === "event" && (
                <button
                  className="rd-link"
                  onClick={() => {
                    onClose();
                    onOpenContext(entry.context);
                  }}
                >
                  {entry.event === "submitted"
                    ? "View receipt →"
                    : entry.event === "session_finished"
                      ? "View session →"
                      : "Open →"}
                </button>
              )}
            </article>
          ))}
        {timeline &&
          !timeline.entries.some(
            (entry) => !eventsOnly || entry.kind === "event",
          ) && (
            <p>
              {eventsOnly
                ? "When I do something, I’ll keep a note here."
                : "Hey. What’s on your mind?"}
            </p>
          )}
        <div ref={bottom} />
      </div>
      {(loadError || error) && (
        <p className="rd-error" role="alert">
          {loadError || error}
        </p>
      )}
      {composer}
    </section>
  );
}
