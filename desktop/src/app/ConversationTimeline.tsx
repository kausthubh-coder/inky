import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Assignment } from "../../shared/index.js";
import type { ConversationTimeline as Timeline, TimelineContext, TimelineEntry } from "../../shared/conversation-timeline.js";
import { Character } from "./Character.js";
import { ChatMarkdown } from "./ChatMarkdown.js";
import { Icon } from "./Icon.js";
import { MemorySaved } from "./MemorySaved.js";
import { onEngineChange } from "./engineChanges.js";

// The chat box grows upward into this panel; the week stays behind it.
// One conversation across home, assignments, school checks and Learn. The context shows once, when it changes.
export function ConversationTimeline({ composer, onClose, error, onOpenContext, assignments = [], suggestions = [], onSuggest }: {
  composer: ReactNode;
  onClose: () => void;
  error?: string | null;
  onOpenContext: (context: TimelineContext) => void;
  assignments?: readonly Assignment[];
  suggestions?: readonly string[];
  onSuggest?: (text: string) => void;
}) {
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [loadError, setLoadError] = useState("");
  const [limit, setLimit] = useState(200);
  const bottom = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const dock = useRef<HTMLElement>(null);
  useEffect(() => {
    let alive = true;
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const next = await window.studi!.getConversationTimeline({ limit });
        if (alive) { setTimeline(next); setLoadError(""); }
      } catch (cause) {
        if (alive) setLoadError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        reading = false;
      }
    };
    void read();
    const stop = onEngineChange(["conversation", "homework", "school"], () => void read());
    return () => { alive = false; stop(); };
  }, [limit]);
  useEffect(() => {
    if (nearBottom.current) bottom.current?.scrollIntoView({ block: "nearest" });
  }, [timeline?.entries.length]);
  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (!dock.current?.contains(event.target as Node) && !(event.target as Element).closest?.("dialog, .account-menu")) onClose();
    };
    window.addEventListener("mousedown", outside);
    return () => window.removeEventListener("mousedown", outside);
  }, [onClose]);

  const open = (context: TimelineContext) => { onClose(); onOpenContext(context); };
  const entries = visibleEntries(timeline?.entries ?? []);
  return (
    <section className="hw-dock" ref={dock} aria-label="Chat with Dot">
      <button className="hw-dock-close" aria-label="Close chat" onClick={onClose}><Icon name="close" size={17} /></button>
      <div className="hw-dock-log" role="log" aria-label="Conversation" onScroll={(event) => {
        const el = event.currentTarget;
        nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      }}>
        {!timeline && !loadError && <p className="hw-dock-quiet" role="status">Opening our conversation…</p>}
        {timeline?.hasMore && (limit < 500
          ? <button className="rd-link hw-dock-earlier" onClick={() => setLimit(500)}>Show earlier messages</button>
          : <p className="hw-dock-quiet">Showing the most recent 500 entries.</p>)}
        {entries.map((entry, index) => {
          const previous = entries[index - 1];
          const changed = !previous || contextName(previous) !== contextName(entry) || previous.context.kind !== entry.context.kind;
          return (
            <div key={entry.id} className="hw-dock-entry">
              {changed && (index > 0 || entry.context.kind !== "home") && (
                <button className="hw-dock-context" onClick={() => open(entry.context)}>{contextName(entry)}</button>
              )}
              <Entry entry={entry} face={changed || previous?.kind !== "message" || previous.role !== "assistant"} assignments={assignments} onOpen={open} />
            </div>
          );
        })}
        {timeline && !entries.length && (
          <div className="hw-dock-empty">
            <p><Character state="hello" size={34} label="Dot" />What's on your mind? Ask about your week, or tell me about homework I don't have yet.</p>
            <div className="ag-tips">{suggestions.map((text) => <button key={text} onClick={() => onSuggest?.(text)}><Icon name="right" size={14} />{text}</button>)}</div>
          </div>
        )}
        <div ref={bottom} />
      </div>
      {(loadError || error) && <p className="rd-error" role="alert">{loadError || error}</p>}
      {composer}
    </section>
  );
}

function Entry({ entry, face, assignments, onOpen }: { entry: TimelineEntry; face: boolean; assignments: readonly Assignment[]; onOpen: (context: TimelineContext) => void }) {
  if (entry.kind === "event") {
    if (entry.event === "memory_saved") return <MemorySaved title={entry.title ?? "a preference"} noteId={entry.id.split(":")[1] ?? ""} />;
    return (
      <p className="hw-dock-event">
        <span>{eventLine(entry)}</span>
        <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
        <button className="rd-link" onClick={() => onOpen(entry.context)}>{entry.event === "submitted" ? "Receipt" : "Open"}</button>
      </p>
    );
  }
  if (entry.role === "user") return <div className="ag-you">{entry.text}</div>;
  const mentioned = mentionedAssignments(entry.text, assignments);
  // Chalky teaches; Dot does the homework.
  const chalky = entry.context.kind === "learn" || entry.context.kind === "tutor";
  return (
    <div className={`ag-turn${face ? "" : " is-cont"} is-still`}>
      <div className="ag-who">{chalky ? <><Character kind="chalky" state="idle" size={34} label="Chalky" />Chalky</> : <><Character state="idle" size={34} label="Dot" />Dot</>}</div>
      <div className="ag-text"><ChatMarkdown text={entry.text} /></div>
      {mentioned.length > 0 && (
        <div className="hw-dock-rows">
          {mentioned.map((item) => (
            <button key={item.assignmentId} onClick={() => onOpen({ kind: "assignment", assignmentId: item.assignmentId })}>
              <strong>{item.title}</strong><span>Open <Icon name="forward" size={14} /></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Dot's own updates are one quiet line; back-to-back updates for one assignment fold into the latest. */
function visibleEntries(entries: readonly TimelineEntry[]): TimelineEntry[] {
  return entries.filter((entry, index) => {
    const next = entries[index + 1];
    const same = next && (contextKey(next.context) === contextKey(entry.context) || (next.kind === "event" && entry.kind === "event" && next.event === entry.event && next.title === entry.title));
    return !(entry.kind === "event" && entry.event !== "memory_saved" && next?.kind === "event" && next.event !== "memory_saved" && same);
  });
}

/** Assignments Dot names in a reply, so the student can act from the answer. */
function mentionedAssignments(text: string, assignments: readonly Assignment[]): Assignment[] {
  const lower = text.toLocaleLowerCase();
  return assignments.filter((item) => item.title.length >= 4 && lower.includes(item.title.toLocaleLowerCase())).slice(0, 4);
}

const contextKey = (context: TimelineContext) => JSON.stringify(context);

function contextName(entry: TimelineEntry): string {
  return entry.title ?? { home: "Home", learn: "Learn", assignment: "Assignment", scan: "School check", tutor: "Learning" }[entry.context.kind];
}

function eventLine(entry: Extract<TimelineEntry, { kind: "event" }>): string {
  const title = entry.title ?? "the assignment";
  switch (entry.event) {
    case "started": return `Started ${title}`;
    case "needs_user": return `${title} needs you`;
    case "ready_review": return `${title} is ready to check`;
    case "submitted": return `Handed in ${title}`;
    case "failed": return `Stopped on ${title}`;
    case "scan_finished": return "Finished reading your school";
    case "session_finished": return `Finished a study session`;
    default: return entry.text;
  }
}
