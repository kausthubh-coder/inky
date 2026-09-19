import { useEffect, useState } from "react";
import type { MemorySummary } from "../../shared/memory.js";
import type { NoteDocument } from "../../shared/note.js";
import { ChatMarkdown } from "./ChatMarkdown.js";

export function MemorySettings() {
  const [notes, setNotes] = useState<MemorySummary[]>([]),
    [opened, setOpened] = useState<NoteDocument | null>(null),
    [title, setTitle] = useState(""),
    [content, setContent] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false);
  const refresh = async () => {
    const next = await window.studi!.listMemories();
    setNotes(next);
    setLoaded(true);
  };
  useEffect(() => {
    let alive = true;
    void window
      .studi!.listMemories()
      .then((next) => {
        if (alive) {
          setNotes(next);
          setLoaded(true);
        }
      })
      .catch((cause) => {
        if (alive) setError(String(cause));
      });
    return () => {
      alive = false;
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const read = (noteId: string) =>
    run(async () => {
      const next = await window.studi!.readMemory({ noteId });
      if (!next) {
        await refresh();
        throw new Error("That memory has been removed.");
      }
      setOpened(next);
      setTitle(next.frontmatter.title);
      setContent(next.content);
    });
  return (
    <section className="settings-card rd-memories">
      <h2>What I remember</h2>
      <p>Preferences you’ve shared with me. Edit anything, or let it go.</p>
      {!loaded && !error && <p role="status">Opening your memories…</p>}
      {loaded && !notes.length && <p>No saved preferences yet.</p>}
      {notes.map((note) => (
        <div className="rd-memory-row" key={note.noteId}>
          <button
            className="rd-link"
            disabled={busy}
            onClick={() => void read(note.noteId)}
          >
            {note.title}
          </button>
          <span>{new Date(note.updatedAt).toLocaleDateString()}</span>
          <button
            className="rd-link danger"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await window.studi!.deleteMemory({
                  noteId: note.noteId,
                  expectedRevision: note.revision,
                });
                if (opened?.frontmatter.noteId === note.noteId) setOpened(null);
                await refresh();
              })
            }
          >
            Forget
          </button>
        </div>
      ))}
      {opened && (
        <form
          className="rd-source-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const next = await window.studi!.updateMemory({
                noteId: opened.frontmatter.noteId,
                expectedRevision: opened.frontmatter.revision,
                title,
                content,
              });
              setOpened(next);
              await refresh();
            });
          }}
        >
          <label>
            Memory title
            <input
              maxLength={200}
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            What to remember
            <textarea
              rows={5}
              maxLength={100000}
              required
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </label>
          <details>
            <summary>Preview</summary>
            <ChatMarkdown text={content} />
          </details>
          <div className="rd-actions">
            <button
              className="rd-button primary"
              disabled={busy || !title.trim() || !content.trim()}
            >
              Save memory
            </button>
            <button
              type="button"
              className="rd-link"
              onClick={() => setOpened(null)}
            >
              Close
            </button>
          </div>
        </form>
      )}
      {error && (
        <div role="alert">
          <p className="rd-error">{error}</p>
          <button
            className="rd-link"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (opened) await read(opened.frontmatter.noteId);
                await refresh();
              })
            }
          >
            Reload latest
          </button>
        </div>
      )}
    </section>
  );
}
