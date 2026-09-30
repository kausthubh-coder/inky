import "./homework-files.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OPENABLE_FILE, type AssignmentCommandOutput } from "../../shared/index.js";
import { ChatMarkdown } from "./ChatMarkdown.js";
import { Icon, type IconName } from "./Icon.js";
import { parseDelimited } from "./homeworkFile.js";

// The assignment's folder as a small workspace, like an editor: files on the left, the open file
// with line numbers on the right, and Dot's terminal underneath with each command and its result.

type FileEntry = { path: string; kind: "file" | "directory"; size: number; modifiedAt: string };

const TEXT = /\.(txt|md|csv|tsv|json|js|jsx|ts|tsx|py|java|c|cc|cpp|h|hpp|cs|go|rs|rb|php|css|html|xml|yaml|yml|tex|sql|r|m|sh|ps1|log|makefile)$/i;
const CODE = /\.(js|jsx|ts|tsx|py|java|c|cc|cpp|h|hpp|cs|go|rs|rb|php|sh|ps1|sql|r|m|json|css|html|xml|yaml|yml|tex)$/i;
const BINARY = /\.(exe|o|obj|out|class|pyc|dll|so|dylib)$/i;
const PDF = /\.pdf$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;

/** Where the app can load a file from the assignment's folder (see the engine's studi-file protocol). */
const fileUrl = (assignmentId: string, path: string) => `studi-file://${assignmentId}/${path.split("/").map(encodeURIComponent).join("/")}`;

function fileSize(size: number) {
  return size < 1000 ? `${size} B` : size < 1_000_000 ? `${Math.ceil(size / 1000)} KB` : `${(size / 1_000_000).toFixed(1)} MB`;
}

function iconFor(path: string): { icon: IconName; tone: string } {
  if (CODE.test(path)) return { icon: "code", tone: "is-code" };
  if (/\.pdf$/i.test(path)) return { icon: "file", tone: "is-pdf" };
  if (/\.md$/i.test(path)) return { icon: "note", tone: "is-doc" };
  if (/\.(csv|tsv)$/i.test(path)) return { icon: "list", tone: "" };
  if (BINARY.test(path)) return { icon: "term", tone: "is-binary" };
  return { icon: "file", tone: "" };
}

/** What to open first: the newest code file Dot wrote at the top of the folder, else the newest top-level file. */
function mainFile(files: readonly FileEntry[]): FileEntry | null {
  const top = files.filter((file) => !file.path.includes("/") && !BINARY.test(file.path) && file.path !== "studi-answer.md");
  const newest = (list: FileEntry[]) => [...list].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))[0] ?? null;
  return newest(top.filter((file) => CODE.test(file.path))) ?? newest(top.filter((file) => TEXT.test(file.path))) ?? newest(top);
}

export function HomeworkFiles({ assignmentId, active, commandOutputs = [], commands }: {
  assignmentId: string;
  active: boolean;
  commandOutputs?: readonly AssignmentCommandOutput[];
  /** What each shell call ran, by tool call id, so the terminal shows the command, not just "PowerShell". */
  commands?: ReadonlyMap<string, string>;
}) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [opened, setOpened] = useState<FileEntry | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [closedFolders, setClosedFolders] = useState<ReadonlySet<string>>(new Set(["materials"]));
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [opening, setOpening] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const mounted = useRef(false);
  const request = useRef(0);
  const picked = useRef(false);

  const refresh = useCallback(async () => {
    try {
      if (!window.studi) throw new Error("Open Studi to load assignment files.");
      const items = await window.studi.getAssignmentFiles({ assignmentId });
      const visible = items.filter((item) => item.kind === "file" && !item.path.split("/").some((part) => part.startsWith(".studi-")));
      if (mounted.current) { setFiles(visible); setLoadError(""); }
    } catch {
      if (mounted.current) setLoadError("Couldn't load the files. Try again.");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; request.current++; };
  }, [refresh]);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [active, refresh]);

  const read = useCallback(async (file: FileEntry) => {
    const id = ++request.current;
    setOpened(file);
    setContent(null);
    setError("");
    setReading(false);
    if (PDF.test(file.path) || IMAGE.test(file.path) || !TEXT.test(file.path) && !/^makefile$/i.test(file.path.split("/").pop() ?? "") || file.size > 250_000) return;
    setReading(true);
    try {
      const result = await window.studi?.readAssignmentFile({ assignmentId, path: file.path });
      if (mounted.current && id === request.current && result) setContent(result.content);
    } catch {
      if (mounted.current && id === request.current) setError("Couldn't preview this file. Try again or use Show in folder.");
    } finally {
      if (mounted.current && id === request.current) setReading(false);
    }
  }, [assignmentId]);

  // Open Dot's main file by itself, once; after that the student's choice stays.
  useEffect(() => {
    if (picked.current || opened || !files.length) return;
    const first = mainFile(files);
    if (first) { picked.current = true; void read(first); }
  }, [files, opened, read]);

  const add = async () => {
    if (adding || !window.studi) return;
    setAdding(true);
    setError("");
    try {
      const result = await window.studi.importAssignmentFiles({ assignmentId });
      if (result.errors.length) setError(`Couldn't add ${result.errors.map((item) => item.name).join(", ")}. Try adding those files again.`);
      await refresh();
    } catch {
      if (mounted.current) setError("Couldn't add the files. Try again.");
    } finally {
      if (mounted.current) setAdding(false);
    }
  };
  const reveal = (path?: string) => void window.studi?.openAssignmentFolder({ assignmentId, ...(path ? { path } : {}) }).catch(() => {
    if (mounted.current) setError("Couldn't open the folder. Try again.");
  });
  const open = async (path: string) => {
    if (opening || !window.studi) return;
    setOpening(true);
    setError("");
    try { await window.studi.openAssignmentFile({ assignmentId, path }); }
    catch { if (mounted.current) setError("Couldn't open this file. Check that an app for this file type is installed, then try again."); }
    finally { if (mounted.current) setOpening(false); }
  };

  // Files at the top of the folder first, then folders; each folder can fold.
  const tree = useMemo(() => {
    const top = files.filter((file) => !file.path.includes("/")).sort((a, b) => a.path.localeCompare(b.path));
    const folders = new Map<string, FileEntry[]>();
    for (const file of files.filter((item) => item.path.includes("/"))) {
      const folder = file.path.split("/")[0]!;
      folders.set(folder, [...(folders.get(folder) ?? []), file]);
    }
    return { top, folders: [...folders].sort(([a], [b]) => a.localeCompare(b)) };
  }, [files]);

  const runs = commandOutputs;
  const latestRun = runs.at(-1)?.toolCallId ?? null;
  const shownRun = openRun ?? latestRun;
  const lines = content?.replace(/\r\n/g, "\n").split("\n") ?? [];
  const table = useMemo(() => content !== null && opened && /\.(csv|tsv)$/i.test(opened.path)
    ? parseDelimited(content, /\.tsv$/i.test(opened.path) ? "\t" : ",") : null, [content, opened]);

  const fileButton = (file: FileEntry, indent = false) => {
    const { icon, tone } = iconFor(file.path);
    const name = indent ? file.path.slice(file.path.indexOf("/") + 1) : file.path;
    return (
      <button key={file.path} className={`wf-file ${tone}${opened?.path === file.path ? " is-open" : ""}${indent ? " is-nested" : ""}`}
        aria-current={opened?.path === file.path ? "true" : undefined} title={file.path} onClick={() => void read(file)}>
        <Icon name={icon} size={14} /><span>{name}</span>
      </button>
    );
  };

  return (
    <div className={`wf${files.length <= 3 && !tree.folders.length ? " is-small-tree" : ""}`} aria-label="Assignment files">
      <nav className="wf-tree" aria-label="Files">
        <div className="wf-tree-head">
          <strong>Files</strong>
          <button className="wf-icon-button" aria-label="Add files" title="Add files" disabled={adding} onClick={() => void add()}><Icon name="plus" size={15} /></button>
        </div>
        <div className="wf-tree-list">
          {loading && <p className="wf-muted">Loading…</p>}
          {loadError && <p className="wf-error" role="alert">{loadError} <button className="wf-link" onClick={() => void refresh()}>Try again</button></p>}
          {tree.top.map((file) => fileButton(file))}
          {tree.folders.map(([folder, list]) => {
            const closed = closedFolders.has(folder);
            return (
              <div key={folder}>
                <button className="wf-folder" aria-expanded={!closed} onClick={() => setClosedFolders((current) => {
                  const next = new Set(current);
                  if (next.has(folder)) next.delete(folder); else next.add(folder);
                  return next;
                })}>
                  <span className="wf-caret" aria-hidden="true"><Icon name={closed ? "right" : "down"} size={12} /></span>
                  <Icon name="folder" size={14} /><span>{folder}</span><small>{list.length}</small>
                </button>
                {!closed && list.sort((a, b) => a.path.localeCompare(b.path)).map((file) => fileButton(file, true))}
              </div>
            );
          })}
          {!loading && !files.length && <p className="wf-muted">No files yet. Dot's work lands here, and so does anything you add.</p>}
        </div>
        <button className="wf-tree-foot" onClick={() => reveal()}><Icon name="external" size={13} /> Open folder</button>
      </nav>

      <section className="wf-main">
        <div className={`wf-editor${terminalOpen && runs.length ? " with-terminal" : ""}`}>
          {opened ? (
            <>
              <header className="wf-editor-head">
                <span className={`wf-tab ${iconFor(opened.path).tone}`} title={opened.path}><Icon name={iconFor(opened.path).icon} size={14} /><span>{opened.path.split("/").pop()}</span></span>
                <small>{fileSize(opened.size)}</small>
                {OPENABLE_FILE.test(opened.path) && <button className="wf-link" disabled={opening} onClick={() => void open(opened.path)}>{opening ? "Opening…" : "Open"}<Icon name="external" size={13} /></button>}
                <button className="wf-link" onClick={() => reveal(opened.path)}>Show in folder</button>
              </header>
              {reading ? <p className="wf-muted wf-pad">Opening…</p>
                : PDF.test(opened.path) && window.studi ? <iframe className="wf-pdf" title={opened.path} src={`${fileUrl(assignmentId, opened.path)}#view=FitH`} />
                : IMAGE.test(opened.path) && window.studi ? <div className="wf-image"><img key={opened.path} src={fileUrl(assignmentId, opened.path)} alt={opened.path} onError={() => setError("Couldn't preview this image. Try again or open it in its app.")} /></div>
                : content !== null ? (/\.md$/i.test(opened.path)
                  ? <article className="wf-doc" aria-label="File preview"><ChatMarkdown text={content} /></article>
                  : table ? <DelimitedPreview rows={table} />
                  : CODE.test(opened.path) || /^makefile$/i.test(opened.path.split("/").pop() ?? "")
                    ? <pre className="wf-code" aria-label="File preview">{lines.map((line, index) => <span key={index} className="wf-line"><i aria-hidden="true">{index + 1}</i>{line || " "}</span>)}</pre>
                    : <pre className="wf-text" aria-label="File preview">{content || "This file is empty."}</pre>)
                : !error && (
                  <div className="wf-empty">
                    <Icon name={iconFor(opened.path).icon} size={28} />
                    <p>{opened.size > 250_000 ? "Too large to preview here." : OPENABLE_FILE.test(opened.path) ? "This file opens in its own app." : "Find this file in the assignment folder."}</p>
                    {OPENABLE_FILE.test(opened.path)
                      ? <button className="rd-button" disabled={opening} onClick={() => void open(opened.path)}>{opening ? "Opening…" : "Open"}<Icon name="external" size={15} /></button>
                      : <button className="rd-button" onClick={() => reveal(opened.path)}>Show in folder<Icon name="external" size={15} /></button>}
                  </div>
                )}
            </>
          ) : (
            <div className="wf-empty">
              <Icon name="folder" size={28} />
              <p>{files.length ? "Pick a file on the left." : "Nothing here yet."}</p>
              <button className="rd-button" disabled={adding} onClick={() => void add()}>{adding ? "Adding…" : "Add notes, a rubric or files"}</button>
            </div>
          )}
          {error && <p className="wf-error" role="alert">{error}{opened && <button className="wf-link" onClick={() => void read(opened)}>Try again</button>}</p>}
        </div>

        {runs.length > 0 && (
          <section className={`wf-terminal${terminalOpen ? "" : " is-closed"}`} aria-label="Command output">
            <button className="wf-terminal-head" aria-expanded={terminalOpen} onClick={() => setTerminalOpen(!terminalOpen)}>
              <Icon name="term" size={14} /><strong>Terminal</strong>
              <small>{runs.length} {runs.length === 1 ? "command" : "commands"}{runs.some((run) => run.outcome === "failed") ? ` · ${runs.filter((run) => run.outcome === "failed").length} failed` : ""}</small>
              <span className="wf-caret" aria-hidden="true"><Icon name={terminalOpen ? "down" : "right"} size={12} /></span>
            </button>
            {terminalOpen && (
              <div className="wf-runs">
                {runs.map((run) => {
                  const shown = run.toolCallId === shownRun;
                  const command = commands?.get(run.toolCallId);
                  return (
                    <div key={run.toolCallId} className={`wf-run${run.outcome === "failed" ? " is-failed" : ""}`}>
                      <button className="wf-run-head" aria-expanded={shown} onClick={() => setOpenRun(shown ? "" : run.toolCallId)}>
                        <span className="wf-prompt">$</span>
                        <code title={command}>{command ?? (run.shell === "powershell" ? "PowerShell command" : "Shell command")}</code>
                        <span className="wf-status">{run.outcome === "failed" ? "failed" : "ok"}{run.durationMs !== undefined ? ` · ${(run.durationMs / 1000).toFixed(1)}s` : ""}</span>
                      </button>
                      {shown && <pre className="wf-run-out">{run.truncated ? "Earlier output omitted.\n" : ""}{run.text.trim() || "No output."}</pre>}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </section>
    </div>
  );
}

function DelimitedPreview({ rows }: { rows: readonly string[][] }) {
  const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const shownColumns = Math.min(columns, 50);
  const shownRows = rows.slice(0, 1000);
  return (
    <div className="wf-table" role="region" aria-label="File preview" tabIndex={0}>
      <table><tbody>{shownRows.map((row, index) => (
        <tr key={index}>{Array.from({ length: shownColumns }, (_, column) => index === 0
          ? <th key={column} scope="col">{row[column] ?? ""}</th>
          : <td key={column}>{row[column] ?? ""}</td>)}</tr>
      ))}</tbody></table>
      {!rows.length && <p className="wf-muted">This file is empty.</p>}
      {(rows.length > shownRows.length || columns > shownColumns) && (
        <p className="wf-muted">Showing {shownRows.length} of {rows.length} rows and {shownColumns} of {columns} columns. Open the file to see it all.</p>
      )}
    </div>
  );
}
