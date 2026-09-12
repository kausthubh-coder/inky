import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon.js";

type FileEntry = { path: string; kind: "file" | "directory"; size: number; modifiedAt: string };
const textExtensions = /\.(txt|md|csv|tsv|json|js|jsx|ts|tsx|py|java|c|cpp|h|css|html|xml|yaml|yml|tex|sql|r|m|log)$/i;
function fileSize(size: number) { return size < 1000 ? `${size} B` : size < 1_000_000 ? `${Math.ceil(size / 1000)} KB` : `${(size / 1_000_000).toFixed(1)} MB`; }

export function FileMark({ path }: { path: string }) {
  return <span className="assignment-file-mark" aria-hidden="true"><svg viewBox="0 0 32 40" fill="currentColor"><path d="M3 1h18l9 9v29H3z" stroke="#9d8a70" /><path d="M21 1v10h9" fill="none" stroke="#9d8a70" /></svg><b>{path.includes(".") ? path.split(".").pop()?.slice(0, 4).toUpperCase() : "FILE"}</b></span>;
}

export function HomeworkFiles({ assignmentId, active, onCount }: { assignmentId: string; active: boolean; onCount: (count: number) => void }) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [opened, setOpened] = useState<FileEntry | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [retryOperation, setRetryOperation] = useState<"read" | "add" | null>(null);
  const mounted = useRef(false);
  const addingLock = useRef(false);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    try {
      if (!window.studi) throw new Error("Open Studi to load assignment files.");
      const items = await window.studi.getAssignmentFiles({ assignmentId });
      const visible = items.filter(item => item.kind === "file" && !item.path.split("/").some(part => part.startsWith(".studi-")));
      if (mounted.current) { setFiles(visible); onCount(visible.length); setListError(""); }
    } catch (cause) { if (mounted.current) setListError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (mounted.current) setLoading(false); }
  }, [assignmentId, onCount]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; request.current++; };
  }, [refresh]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void refresh(), 4000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => { clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [active, refresh]);
  const read = async (file: FileEntry) => {
    setRetryOperation("read");
    const id = ++request.current;
    setOpened(file); setContent(null); setError(""); setReading(false);
    if (!textExtensions.test(file.path) || file.size > 250_000) return;
    setReading(true);
    try {
      const result = await window.studi?.readAssignmentFile({ assignmentId, path: file.path });
      if (mounted.current && id === request.current && result) setContent(result.content);
    } catch (cause) { if (mounted.current && id === request.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (mounted.current && id === request.current) setReading(false); }
  };
  const add = async () => {
    if (addingLock.current || !window.studi) return;
    addingLock.current = true;
    setRetryOperation("add");
    setAdding(true); setError(""); setNotice("");
    try {
      const result = await window.studi.importAssignmentFiles({ assignmentId });
      if (!mounted.current) return;
      if (result.imported.length) setNotice(`${result.imported.length === 1 ? "1 file" : `${result.imported.length} files`} added to this assignment.`);
      setError(result.errors.map(item => `${item.name}: ${item.message}`).join("\n"));
      await refresh();
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { addingLock.current = false; if (mounted.current) setAdding(false); }
  };
  const reveal = async (path?: string) => {
    setRetryOperation(null);
    setError("");
    try { await window.studi?.openAssignmentFolder({ assignmentId, ...(path ? { path } : {}) }); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  return <div className="assignment-files" aria-label="Assignment files">
    {opened ? <>
      <div className="assignment-reader-nav"><button className="assignment-text-action" onClick={() => { request.current++; setOpened(null); setError(""); }}>← All files</button><button className="assignment-text-action" onClick={() => void reveal(opened.path)}>Show in folder ↗</button></div>
      <div className="assignment-reader-title"><FileMark path={opened.path} /><div><h2>{opened.path.split("/").pop()}</h2><small>{opened.path} · {fileSize(opened.size)}</small></div></div>
      {reading ? <p role="status">Opening file…</p> : content !== null ? <article className="assignment-document" aria-label="File preview"><pre>{content}</pre></article>
        : !error && <div className="assignment-file-empty"><FileMark path={opened.path} /><h3>{opened.size > 250_000 ? "This file is too large to preview here." : "This file opens in its own app."}</h3><p>Find it in your assignment folder to open it.</p><button className="assignment-text-action" onClick={() => void reveal(opened.path)}>Show in folder ↗</button></div>}
    </> : <>
      <div className="assignment-section-heading"><h2>Files <span>{loading ? "" : files.length}</span></h2><button className="assignment-text-action" disabled={adding} onClick={() => void add()}>{adding ? "Adding files…" : "+ Add files"}</button></div>
      {loading ? <p role="status">Loading files…</p> : !listError && (files.length ? files.map(file => <button key={file.path} className="assignment-file-row" onClick={() => void read(file)}>
        <FileMark path={file.path} />
        <span><strong>{file.path.split("/").pop()}</strong><small>{file.path.startsWith("materials/") ? "Materials" : file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "Assignment folder"} · {fileSize(file.size)} · {new Date(file.modifiedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></span>
        <Icon name="right" size={15} />
      </button>) : <div className="assignment-file-empty"><FileMark path="notes.pdf" /><h3>A place for your materials.</h3><p>Add notes, a rubric, or files for this assignment.</p><button className="assignment-text-action" disabled={adding} onClick={() => void add()}>Choose files</button></div>)}
      <button className="assignment-text-action assignment-folder-link" onClick={() => void reveal()}>Open assignment folder ↗</button>
    </>}
    {listError && !opened && <div className="assignment-file-error" role="alert"><p>{listError}</p><button className="assignment-text-action" onClick={() => void refresh()}>Try loading files again</button></div>}
    {error && <div className="assignment-file-error" role="alert"><p>{error}</p>{retryOperation && <button className="assignment-text-action" disabled={adding || reading} onClick={() => void (retryOperation === "read" && opened ? read(opened) : add())}>Try again</button>}</div>}
    {notice && <p className="assignment-file-notice" role="status"><Icon name="check" size={14} />{notice}</p>}
  </div>;
}
