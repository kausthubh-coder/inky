import { useCallback, useEffect, useRef, useState } from "react";
import type { AssignmentCommandOutput } from "../../shared/index.js";
import { ChatMarkdown } from "./ChatMarkdown.js";
import { Icon } from "./Icon.js";

type FileEntry = {
  path: string;
  kind: "file" | "directory";
  size: number;
  modifiedAt: string;
};
const textExtensions =
  /\.(txt|md|csv|tsv|json|js|jsx|ts|tsx|py|java|c|cpp|h|css|html|xml|yaml|yml|tex|sql|r|m|log)$/i;
function fileSize(size: number) {
  return size < 1000
    ? `${size} B`
    : size < 1_000_000
      ? `${Math.ceil(size / 1000)} KB`
      : `${(size / 1_000_000).toFixed(1)} MB`;
}

export function FileMark({ path }: { path: string }) {
  return (
    <span className="assignment-file-mark" aria-hidden="true">
      <svg viewBox="0 0 32 40" fill="currentColor">
        <path d="M3 1h18l9 9v29H3z" stroke="#9d8a70" />
        <path d="M21 1v10h9" fill="none" stroke="#9d8a70" />
      </svg>
      <b>
        {path.includes(".")
          ? path.split(".").pop()?.slice(0, 4).toUpperCase()
          : "FILE"}
      </b>
    </span>
  );
}

export function HomeworkFiles({
  assignmentId,
  active,
  onCount,
  commandOutputs = [],
}: {
  assignmentId: string;
  active: boolean;
  onCount: (count: number) => void;
  commandOutputs?: readonly AssignmentCommandOutput[];
}) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [opened, setOpened] = useState<FileEntry | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [retryOperation, setRetryOperation] = useState<"read" | "add" | null>(
    null,
  );
  const mounted = useRef(false);
  const addingLock = useRef(false);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    try {
      if (!window.studi)
        throw new Error("Open Studi to load assignment files.");
      const items = await window.studi.getAssignmentFiles({ assignmentId });
      const visible = items.filter(
        (item) =>
          item.kind === "file" &&
          !item.path.split("/").some((part) => part.startsWith(".studi-")),
      );
      if (mounted.current) {
        setFiles(visible);
        onCount(visible.length);
        setListError("");
      }
    } catch (cause) {
      if (mounted.current)
        setListError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [assignmentId, onCount]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, [refresh]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void refresh(), 4000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [active, refresh]);
  const read = async (file: FileEntry) => {
    setRetryOperation("read");
    const id = ++request.current;
    setOpened(file);
    setContent(null);
    setError("");
    setReading(false);
    if (!textExtensions.test(file.path) || file.size > 250_000) return;
    setReading(true);
    try {
      const result = await window.studi?.readAssignmentFile({
        assignmentId,
        path: file.path,
      });
      if (mounted.current && id === request.current && result)
        setContent(result.content);
    } catch (cause) {
      if (mounted.current && id === request.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current && id === request.current) setReading(false);
    }
  };
  const add = async () => {
    if (addingLock.current || !window.studi) return;
    addingLock.current = true;
    setRetryOperation("add");
    setAdding(true);
    setError("");
    setNotice("");
    try {
      const result = await window.studi.importAssignmentFiles({ assignmentId });
      if (!mounted.current) return;
      if (result.imported.length)
        setNotice(
          `${result.imported.length === 1 ? "1 file" : `${result.imported.length} files`} added to this assignment.`,
        );
      setError(
        result.errors.map((item) => `${item.name}: ${item.message}`).join("\n"),
      );
      await refresh();
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      addingLock.current = false;
      if (mounted.current) setAdding(false);
    }
  };
  const reveal = async (path?: string) => {
    setRetryOperation(null);
    setError("");
    try {
      await window.studi?.openAssignmentFolder({
        assignmentId,
        ...(path ? { path } : {}),
      });
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="assignment-files rd-files" aria-label="Assignment files">
      <nav className="rd-file-tree" aria-label="Files">
        <div className="rd-file-tree-heading">
          <strong>Files</strong>
          <button
            className="rd-link"
            disabled={adding}
            onClick={() => void add()}
            aria-label="Add files"
          >
            +
          </button>
        </div>
        {loading && <p role="status">Loading…</p>}
        {files.map((file) => (
          <button
            key={file.path}
            className={opened?.path === file.path ? "selected" : ""}
            aria-current={opened?.path === file.path ? "true" : undefined}
            onClick={() => void read(file)}
          >
            <span aria-hidden="true">▧</span>
            <span>{file.path}</span>
          </button>
        ))}
        {!loading && !files.length && <p>No files yet.</p>}
        <button className="rd-link rd-folder" onClick={() => void reveal()}>
          Open folder ↗
        </button>
      </nav>
      <section className="rd-file-reader">
        {opened ? (
          <>
            <header className="rd-file-reader-heading">
              <span>
                {opened.path} · {fileSize(opened.size)}
              </span>
              <button
                className="rd-link"
                onClick={() => void reveal(opened.path)}
              >
                Show in folder ↗
              </button>
            </header>
            {reading ? (
              <p role="status">Opening file…</p>
            ) : content !== null ? (
              <article
                className="assignment-document"
                aria-label="File preview"
              >
                {/\.md$/i.test(opened.path) ? (
                  <ChatMarkdown text={content} />
                ) : (
                  <pre>{content}</pre>
                )}
              </article>
            ) : (
              !error && (
                <div className="assignment-file-empty">
                  <FileMark path={opened.path} />
                  <h3>
                    {opened.size > 250_000
                      ? "This file is too large to preview here."
                      : "This file opens in its own app."}
                  </h3>
                  <p>Find it in your assignment folder to open it.</p>
                  <button
                    className="rd-button"
                    onClick={() => void reveal(opened.path)}
                  >
                    Show in folder ↗
                  </button>
                </div>
              )
            )}
          </>
        ) : (
          <div className="assignment-file-empty">
            <FileMark path="notes.pdf" />
            <h3>
              {files.length
                ? "Pick a file to open it."
                : "A place for your materials."}
            </h3>
            <p>Add notes, a rubric, or files for this assignment.</p>
            <button
              className="rd-button"
              disabled={adding}
              onClick={() => void add()}
            >
              {adding ? "Adding files…" : "Choose files"}
            </button>
          </div>
        )}
        {commandOutputs.length > 0 && (
          <section className="rd-command-output" aria-label="Command output">
            {commandOutputs.map((output, index) => (
              <details key={output.toolCallId} open={index === commandOutputs.length - 1}>
                <summary>
                  {output.shell === "powershell" ? "PowerShell" : "Terminal"}
                  {" · "}{output.outcome === "succeeded" ? "Finished" : "Failed"}
                  {output.durationMs !== undefined ? ` · ${(output.durationMs / 1000).toFixed(1)}s` : ""}
                </summary>
                <pre>
                  {output.truncated ? "Earlier output omitted.\n" : ""}
                  {output.text || "No output was recorded."}
                </pre>
              </details>
            ))}
          </section>
        )}
        {listError && (
          <div className="assignment-file-error" role="alert">
            <p>{listError}</p>
            <button className="rd-link" onClick={() => void refresh()}>
              Try loading files again
            </button>
          </div>
        )}
        {error && (
          <div className="assignment-file-error" role="alert">
            <p>{error}</p>
            {retryOperation && (
              <button
                className="rd-link"
                disabled={adding || reading}
                onClick={() =>
                  void (retryOperation === "read" && opened
                    ? read(opened)
                    : add())
                }
              >
                Try again
              </button>
            )}
          </div>
        )}
        {notice && (
          <p className="assignment-file-notice" role="status">
            <Icon name="check" size={14} />
            {notice}
          </p>
        )}
      </section>
    </div>
  );
}
