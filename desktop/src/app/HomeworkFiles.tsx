import { useEffect, useState } from "react";

export function HomeworkFiles({ assignmentId, onClose }: { assignmentId: string; onClose: () => void }) {
  const [files, setFiles] = useState<Array<{ path: string; kind: "file" | "directory" }>>([]);
  const [opened, setOpened] = useState<{ path: string; content: string } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    void window.studi?.getAssignmentFiles({ assignmentId }).then(items => {
      if (mounted) setFiles(items.filter(item => !item.path.split("/").some(part => part.startsWith(".studi-"))));
    }).catch(cause => { if (mounted) setError(String(cause)); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [assignmentId]);
  const read = async (path: string) => {
    setError("");
    try {
      const file = await window.studi?.readAssignmentFile({ assignmentId, path });
      if (file) setOpened(file);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <aside className="homework-answer" aria-label="Assignment files">
    <header><strong>{opened?.path ?? "Assignment files"}</strong><button className="chat-icon" aria-label="Close assignment files" onClick={onClose}>×</button></header>
    <div className="chat-card-actions">
      {opened && <button className="quiet-button" onClick={() => setOpened(null)}>All files</button>}
      <button className="quiet-button" onClick={() => { void window.studi?.openAssignmentFolder({ assignmentId }).catch(cause => setError(String(cause))); }}>Open folder</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {opened ? <pre>{opened.content}</pre> : loading ? <p role="status">Loading files…</p> : files.filter(file => file.kind === "file").length ? <ul className="homework-file-list">{files.filter(file => file.kind === "file").map(file => <li key={file.path}><button className="quiet-button" onClick={() => void read(file.path)}>{file.path}</button></li>)}</ul> : <p>Files saved for this assignment will appear here. You can also add materials through its folder.</p>}
  </aside>;
}
