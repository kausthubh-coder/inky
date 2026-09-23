import { useEffect, useRef, useState } from "react";
import type { MemorySummary } from "../../shared/memory.js";
import type { NoteDocument } from "../../shared/note.js";
import { SavedNotice, SettingsGroup } from "./SettingsPrimitives.js";

export function MemorySettings() {
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
  return <SettingsGroup title={`What Inky remembers${loaded ? ` · ${notes.length}` : ""}`}>
    {!loaded && !error && <p role="status">Opening your memories…</p>}
    {loaded && !notes.length && <p className="st-muted">No saved preferences yet.</p>}
    {notes.map(note => <div className="st-memory" key={note.noteId}>
      <div><button className="st-text" disabled={busy} onClick={() => void run(() => read(note.noteId))}>{note.title}</button>
        <small>Remembered {new Date(note.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></div>
      <button className="st-text st-danger" disabled={busy} onClick={() => void run(async () => {
        await window.studi!.deleteMemory({ noteId: note.noteId, expectedRevision: note.revision });
        if (opened?.frontmatter.noteId === note.noteId) setOpened(null);
        await refresh(); setSaved(value => value + 1);
      })}>Forget</button>
    </div>)}
    <button className="st-add" disabled={busy} onClick={() => { setCreating(true); setOpened(null); setTitle(""); setContent(""); setError(""); }}>+ Tell Inky something to remember</button>
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
