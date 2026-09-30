import { useEffect, useRef, useState } from "react";
import type { MemorySummary } from "../../shared/memory.js";
import type { NoteDocument } from "../../shared/note.js";
import type { SchoolOnboardingState } from "../../shared/index.js";
import { SavedNotice, SettingsGroup } from "./SettingsPrimitives.js";

// Everything Dot remembers, grouped by what it's about, each saying where it came from.
function groupFor(note: MemorySummary, onboarding: SchoolOnboardingState | null): string {
  if (note.scope === "student") return "You";
  if (note.scope === "school") return "Your school";
  if (note.scope === "course") return onboarding?.courses.find(course => course.courseId === note.subjectId)?.label ?? "A class";
  if (note.scope === "pattern") return "Kinds of work";
  return "Assignments";
}
function sourceFor(note: MemorySummary, onboarding: SchoolOnboardingState | null): string {
  if (note.scope === "student") return note.key.startsWith("remember-") ? "You added this" : "You told Dot in a chat";
  if (note.scope === "assignment") {
    const title = onboarding?.assignments.find(item => item.assignmentId === note.subjectId)?.title ?? "an assignment";
    return note.key === "run-log" ? `Dot's note after working on ${title}` : `Dot learned this doing ${title}`;
  }
  if (note.about === "scan") return "Dot noted this reading your school";
  return "Dot learned this doing homework";
}

export function MemorySettings({ onboarding = null }: { onboarding?: SchoolOnboardingState | null }) {
  const [notes, setNotes] = useState<MemorySummary[]>([]);
  const [opened, setOpened] = useState<NoteDocument | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState(""), [content, setContent] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false), [saved, setSaved] = useState(0);
  const running = useRef(false);
  const refresh = async () => { setNotes(await window.studi!.listMemories()); setLoaded(true); };
  useEffect(() => {
    let alive = true;
    void window.studi!.listMemories().then(next => { if (alive) { setNotes(next); setLoaded(true); } })
      .catch(cause => { if (alive) setError(String(cause)); });
    return () => { alive = false; };
  }, []);
  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(true); setError("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { running.current = false; setBusy(false); }
  };
  const read = async (noteId: string) => {
    const next = await window.studi!.readMemory({ noteId });
    if (!next) { await refresh(); throw new Error("That memory has been removed."); }
    setOpened(next); setCreating(false); setTitle(next.frontmatter.title); setContent(next.content);
  };
  const persist = (close = false) => {
    if (!title.trim() || !content.trim() || (!creating && !opened)) return;
    if (opened && title === opened.frontmatter.title && content === opened.content) { if (close) setOpened(null); return; }
    void run(async () => {
      const note = opened
        ? await window.studi!.updateMemory({ noteId: opened.frontmatter.noteId, expectedRevision: opened.frontmatter.revision, title, content })
        : await window.studi!.createMemory({ title, content });
      setOpened(close ? null : note); setCreating(false); setTitle(note.frontmatter.title); setContent(note.content);
      await refresh(); setSaved(value => value + 1);
    });
  };
  return <SettingsGroup title={`What Dot remembers${loaded ? ` · ${notes.length}` : ""}`}>
    {!loaded && !error && <p role="status">Opening your memories…</p>}
    {loaded && !notes.length && <p className="st-muted">Nothing yet. Dot saves what it learns as it works, and anything you ask it to remember.</p>}
    {[...new Set(notes.map(note => groupFor(note, onboarding)))].map(group => <div className="st-memory-group" key={group}>
    <h3>{group}</h3>
    {notes.filter(note => groupFor(note, onboarding) === group).map(note => <div className="st-memory" key={note.noteId}>
      <div><button className="st-text" disabled={busy} onClick={() => void run(() => read(note.noteId))}>{note.title}</button>
        <small>{sourceFor(note, onboarding)} · {new Date(note.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></div>
      <button className="st-text" disabled={busy} onClick={() => void run(() => read(note.noteId))}>Edit</button>
      <button className="st-text st-danger" disabled={busy} onClick={() => void run(async () => {
        await window.studi!.deleteMemory({ noteId: note.noteId, expectedRevision: note.revision });
        if (opened?.frontmatter.noteId === note.noteId) setOpened(null);
        await refresh(); setSaved(value => value + 1);
      })}>Forget</button>
    </div>)}
    </div>)}
    <button className="st-add" disabled={busy} onClick={() => { setCreating(true); setOpened(null); setTitle(""); setContent(""); setError(""); }}>+ Tell Dot something to remember</button>
    {(creating || opened) && <div className="st-form" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) persist(); }}>
      <label>Memory title<input aria-label="Memory title" maxLength={200} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></label>
      <label>What to remember<textarea aria-label="What to remember" rows={3} maxLength={100000} value={content} disabled={busy} onChange={event => setContent(event.target.value)} /></label>
      <small>Saved when you leave these fields.</small>
      <button className="st-text" disabled={busy} onClick={() => persist(true)}>Done</button>
    </div>}
    <SavedNotice revision={saved} />
    {error && <div role="alert"><p className="st-danger">{error}</p><button className="st-quiet" disabled={busy}
      onClick={() => void run(async () => { if (opened) await read(opened.frontmatter.noteId); await refresh(); })}>Reload latest</button></div>}
  </SettingsGroup>;
}
