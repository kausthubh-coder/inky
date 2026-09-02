import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  classifyAgentRuntimeAttention,
  type AgentReasoningEffort,
  type ArtifactDocument,
  type DiagnosticsExportReceipt,
  type LibraryState,
  type PermissionMode,
  type ProductSettingsState,
  type RuntimeInfo,
  type SchoolOnboardingState,
  type StudiWorkspaceState,
  type TaskDetail,
  type TaskSummary,
  type TelemetryState,
} from "../../shared/index.js";
import { Inky, type InkyState } from "./Inky.js";
import { AppChrome, type AppScreen, Field, PaperCard, RuntimeAttentionBanner, StatusPill, TelemetryControls, executionLabel, formatDateTime, formatDue } from "./Ui.js";

type SaveRuleInput =
  | { ruleId?: string; scope: "global"; mode: PermissionMode }
  | { ruleId?: string; scope: "course"; courseId: string; mode: PermissionMode }
  | { ruleId?: string; scope: "pattern"; courseId: string; patternId: string; mode: PermissionMode }
  | { ruleId?: string; scope: "assignment"; assignmentId: string; mode: PermissionMode };

interface ChromeProps {
  screen: AppScreen;
  studentName: string;
  status: string;
  onNavigate: (screen: AppScreen) => void;
}

export function DashboardScreen({
  chrome,
  onboarding,
  workspace,
  library,
  managerReply,
  busy,
  error,
  onCommand,
  onTask,
  onStartNext,
  onScanAgain,
  onConnectRuntime,
  onFeedback,
}: {
  chrome: ChromeProps;
  onboarding: SchoolOnboardingState;
  workspace: StudiWorkspaceState | null;
  library: LibraryState | null;
  managerReply: string;
  busy: string | null;
  error: string | null;
  onCommand: (prompt: string) => void;
  onTask: (taskId: string) => void;
  onStartNext: () => void;
  onScanAgain: () => void;
  onConnectRuntime: () => void;
  onFeedback: (context: string, message: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [feedback, setFeedback] = useState("");
  const verified = onboarding.assignments.filter((assignment) => assignment.lastVerifiedScanId && assignment.evidence.length > 0);
  const taskByAssignment = new Map((library?.tasks ?? []).map((item) => [item.assignment.assignmentId, item]));
  const days = useMemo(() => fiveDays(), []);
  const scan = onboarding.scan;
  const queue = library?.tasks.filter((item) => ["queued", "working", "needs_user", "ready_review"].includes(item.task.state)) ?? [];
  const dueToday = verified.filter((assignment) => assignment.dueAt && localDateKey(new Date(assignment.dueAt)) === days[0]?.key).length;
  const runtimeAttention = classifyAgentRuntimeAttention(workspace?.provider, scan?.state === "failed" ? scan.failures[0] ?? scan.currentStep : null);
  const inkyState: InkyState = runtimeAttention !== "none" || scan?.state === "partial" || scan?.state === "failed" || scan?.state === "needs_user" ? "needs" : scan?.state === "running" ? "scanning" : scan?.state === "succeeded" ? "done" : "idle";

  const submitCommand = (event: FormEvent) => {
    event.preventDefault();
    if (!prompt.trim()) return;
    onCommand(prompt.trim());
    setPrompt("");
  };

  return (
    <main className="app-shell" data-studi-app-ready="true">
      <AppChrome {...chrome} />
      <div className="page dashboard-page">
        <header className="page-hero dashboard-hero"><div className="dashboard-greeting"><Inky state={inkyState} size={74} label={`Inky is ${inkyState}`} /><div><p className="eyebrow">Your week</p><h1>Hey {chrome.studentName} — {dueToday === 0 ? "you’re clear today." : `${dueToday} ${dueToday === 1 ? "thing" : "things"} due today.`}</h1><p>Everything here comes from school pages Studi actually checked.</p></div></div><div className="freshness"><div className="sync-status"><StatusPill tone={scan?.state === "succeeded" ? "mint" : "yellow"}>{scan?.state ?? "not scanned"}</StatusPill><span>{scan?.completedAt ? `checked ${formatDateTime(scan.completedAt)}` : "first scan incomplete"}</span><button className="sync-now" onClick={onScanAgain} disabled={busy !== null} aria-label="Scan school again">↻</button></div></div></header>

        <RuntimeAttentionBanner attention={runtimeAttention} workspace={workspace} busy={busy !== null} onConnect={onConnectRuntime} />
        {scan?.state === "partial" && runtimeAttention === "none" && <div className="truth-banner truth-banner--partial"><strong>This view is partial.</strong><span>{scan.failures[0] ?? "Some school coverage could not be verified."}</span><button onClick={onScanAgain}>Retry visible scan</button></div>}
        {scan?.state === "failed" && runtimeAttention === "none" && <div className="truth-banner truth-banner--error"><strong>The latest scan failed.</strong><span>Prior verified assignments remain; nothing new is marked complete.</span><button onClick={onScanAgain}>Retry</button></div>}

        <form className="manager-bar" onSubmit={submitCommand}>
          <span className="manager-pen" aria-hidden="true">✎</span>
          <input aria-label="Tell Studi what to do" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Tell Studi what to do — plan my night, start my essay…" maxLength={20_000} />
          <button className="manager-send" disabled={busy !== null || !prompt.trim()}>{busy === "manager" ? "thinking…" : "enter ↵"}</button>
        </form>
        {managerReply && <PaperCard tone="lavender" className="manager-reply"><p className="eyebrow">Manager reply</p><p>{managerReply}</p></PaperCard>}

        <section className="week-section">
          <div className="section-title"><div><p className="eyebrow">Five-day view</p><h2>This week</h2></div><span>{verified.length} verified assignment{verified.length === 1 ? "" : "s"}</span></div>
          <div className="week-grid">
            {days.map((day, index) => {
              const items = verified.filter((assignment) => assignment.dueAt && localDateKey(new Date(assignment.dueAt)) === day.key);
              return <section className={`day-column ${index === 0 ? "is-today" : ""}`} key={day.key}><header><strong>{day.label}</strong><small>{index === 0 ? "today" : day.date}</small></header><div className="day-stack">{items.length === 0 ? <p className="empty-day"><span aria-hidden="true">〰</span>No verified deadlines</p> : items.map((assignment) => { const task = taskByAssignment.get(assignment.assignmentId); const course = courseLabel(onboarding, assignment.courseId); return <AssignmentCard key={assignment.assignmentId} {...(task ? { item: task } : {})} title={assignment.title} {...(assignment.dueAt ? { dueAt: assignment.dueAt } : {})} course={course} tone={courseTone(course)} onTask={onTask} />; })}</div></section>;
            })}
          </div>
          {verified.length === 0 && <PaperCard tone="yellow" className="empty-state"><p className="eyebrow">Truthful empty state</p><h3>No verified assignments yet.</h3><p>{scan?.state === "succeeded" ? "The completed scan did not find assignment evidence. Check your school page or tell Studi what may be missing." : "Finish the visible school scan before Studi can populate your week."}</p></PaperCard>}
        </section>

        {queue.length > 0 && <section className="desk-board">
          <div className="section-title desk-title"><div><h2>Studi’s desk <span>{queue.length}</span></h2><p>Queued work and anything waiting for you.</p></div><button className="button button--mint" onClick={onStartNext} disabled={busy !== null || queue.length === 0}>Start next</button></div>
          <div className="desk-cards">{(["queued", "working", "ready_review", "done"] as const).map((lane) => { const items = laneItems(library?.tasks ?? [], lane); return <section className={`desk-lane desk-lane--${lane}`} key={lane}><div><strong>{lane.replace("_", " ")}</strong><span>{items.length}</span></div>{items.slice(0, 2).map((item) => <button className="task-row" key={item.task.taskId} onClick={() => onTask(item.task.taskId)}><strong>{item.assignment.title}</strong><small>{formatDue(item.assignment.dueAt)}</small></button>)}{items.length === 0 && <small>Nothing here.</small>}</section>; })}</div>
        </section>}

        <form className="context-feedback" onSubmit={(event) => { event.preventDefault(); if (!feedback.trim()) return; onFeedback("dashboard", feedback.trim()); setFeedback(""); }}><label><span>Something look wrong?</span><input value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Tell Studi what this view missed" maxLength={1000} /></label><button className="quiet-button" disabled={!feedback.trim() || busy !== null}>Send feedback</button></form>
        {error && <p className="error-note" role="alert">{error}</p>}
      </div>
    </main>
  );
}

function AssignmentCard({ item, title, dueAt, course, tone, onTask }: { item?: TaskSummary; title: string; dueAt?: string; course: string; tone: number; onTask: (taskId: string) => void }) {
  const content = <><small>{course}</small><strong>{title}</strong><span>{dueAt ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(dueAt)) : "No time"}</span>{item && <StatusPill tone={item.task.state === "submitted" || item.task.state === "preserved" ? "mint" : item.task.state === "needs_user" || item.task.state === "ready_review" ? "coral" : "plain"}>{item.task.state.replace("_", " ")}</StatusPill>}</>;
  return item ? <button className={`assignment-card course-accent-${tone}`} onClick={() => onTask(item.task.taskId)}>{content}</button> : <article className={`assignment-card course-accent-${tone}`}>{content}</article>;
}

export function LibraryScreen({ chrome, library, detail, artifact, busy, error, onTask, onArtifact, onOpenArtifact, onFeedback }: { chrome: ChromeProps; library: LibraryState | null; detail: TaskDetail | null; artifact: ArtifactDocument | null; busy: string | null; error: string | null; onTask: (taskId: string) => void; onArtifact: (kind: "preference" | "memory" | "workflow" | "answer", artifactId: string) => void; onOpenArtifact: (taskId: string) => void; onFeedback: (context: string, message: string) => void }) {
  const [feedback, setFeedback] = useState("");
  return <main className="app-shell"><AppChrome {...chrome} /><div className="page library-page"><header className="page-hero compact"><div><p className="eyebrow">Local records, on request</p><h1>Library</h1><p>Task provenance, state history, receipts, and Markdown artifacts stay on this computer.</p></div></header><div className="library-layout"><aside className="library-index"><h2>Tasks</h2>{(library?.tasks ?? []).map((item) => <button className={detail?.task.taskId === item.task.taskId ? "is-selected" : ""} key={item.task.taskId} onClick={() => onTask(item.task.taskId)}><strong>{item.assignment.title}</strong><small>{item.task.state.replace("_", " ")} · {formatDue(item.assignment.dueAt)}</small></button>)}{(library?.tasks.length ?? 0) === 0 && <p>No task history yet.</p>}<h2>Artifacts</h2>{(library?.artifacts ?? []).map(({ frontmatter }) => <button className={artifact?.frontmatter.artifactId === frontmatter.artifactId ? "is-selected" : ""} key={`${frontmatter.kind}-${frontmatter.artifactId}`} onClick={() => onArtifact(frontmatter.kind, frontmatter.artifactId)}><strong>{frontmatter.artifactId}</strong><small>{frontmatter.kind} · {formatDateTime(frontmatter.updatedAt)}</small></button>)}</aside><section className="library-detail">{detail ? <TaskDetailView detail={detail} onOpenArtifact={onOpenArtifact} /> : artifact ? <ArtifactView artifact={artifact} /> : <PaperCard tone="yellow" className="empty-state"><h3>Choose a task or artifact.</h3><p>Studi reads artifact content only when you select it.</p></PaperCard>}{(detail || artifact) && <form className="context-feedback" onSubmit={(event) => { event.preventDefault(); if (!feedback.trim()) return; onFeedback(detail ? `task:${detail.task.taskId}` : `artifact:${artifact!.frontmatter.artifactId}`, feedback.trim()); setFeedback(""); }}><label><span>Feedback on this record</span><input value={feedback} onChange={(event) => setFeedback(event.target.value)} maxLength={1000} placeholder="What should Studi learn or fix?" /></label><button className="quiet-button" disabled={!feedback.trim() || busy !== null}>Send feedback</button></form>}</section></div>{error && <p className="error-note">{error}</p>}</div></main>;
}

function TaskDetailView({ detail, onOpenArtifact }: { detail: TaskDetail; onOpenArtifact: (taskId: string) => void }) {
  return <div className="detail-stack"><PaperCard tone="sky"><div className="card-heading"><div><p className="eyebrow">Task provenance</p><h2>{detail.assignment.title}</h2></div><StatusPill tone={detail.task.state === "submitted" || detail.task.state === "preserved" ? "mint" : "yellow"}>{detail.task.state.replace("_", " ")}</StatusPill></div><dl className="detail-grid"><div><dt>Due</dt><dd>{formatDue(detail.assignment.dueAt)}</dd></div><div><dt>Source</dt><dd>{detail.assignment.sourceTarget}</dd></div><div><dt>Permission</dt><dd>{detail.permission.mode.replaceAll("_", " ")}</dd></div><div><dt>Evidence</dt><dd>{detail.assignment.evidence.length} retained reference{detail.assignment.evidence.length === 1 ? "" : "s"}</dd></div></dl><p>{detail.permission.rationale}</p></PaperCard>{detail.submissionReceipt && <PaperCard tone="mint"><p className="eyebrow">Submission receipt</p><h3>{detail.submissionReceipt.verifiedStatus}</h3><p>Verified from the visible page at {formatDateTime(detail.submissionReceipt.submittedAt)}.</p></PaperCard>}{detail.execution?.answerArtifactId && <PaperCard tone="yellow"><p className="eyebrow">Local answer fallback</p><h3>{detail.execution.answerArtifactId}</h3><button className="button button--mint" onClick={() => onOpenArtifact(detail.task.taskId)}>Open Markdown file</button></PaperCard>}<PaperCard><p className="eyebrow">State history</p><div className="timeline">{detail.events.map((event) => <div key={event.eventId}><span>{formatDateTime(event.occurredAt)}</span><strong>{event.type === "task_created" ? "Discovered" : `${event.payload.from} → ${event.payload.to}`}</strong>{event.type === "task_state_changed" && event.payload.reason && <small>{event.payload.reason}</small>}</div>)}</div></PaperCard></div>;
}

function ArtifactView({ artifact }: { artifact: ArtifactDocument }) {
  return <PaperCard tone={artifact.frontmatter.kind === "answer" ? "yellow" : artifact.frontmatter.kind === "memory" ? "lavender" : "paper"} className="artifact-view"><div className="card-heading"><div><p className="eyebrow">{artifact.frontmatter.kind} artifact</p><h2>{artifact.frontmatter.artifactId}</h2></div><StatusPill>{formatDateTime(artifact.frontmatter.updatedAt)}</StatusPill></div><pre>{artifact.content}</pre></PaperCard>;
}

export function SettingsScreen({ chrome, settings, onboarding, workspace, telemetry, runtime, diagnosticsReceipt, busy, error, onSavePreferences, onSaveRule, onDeleteRule, onSchedule, onSelectAgentRuntime, onConnectRuntime, onTelemetry, onTelemetryDebug, onExportDiagnostics, onSignOut }: { chrome: ChromeProps; settings: ProductSettingsState | null; onboarding: SchoolOnboardingState; workspace: StudiWorkspaceState | null; telemetry: TelemetryState | null; runtime: RuntimeInfo | null; diagnosticsReceipt: DiagnosticsExportReceipt | null; busy: string | null; error: string | null; onSavePreferences: (reviewMinutes: number, handoffMinutes: number, memoryVisibility: "none" | "selected" | "all") => void; onSaveRule: (input: SaveRuleInput) => void; onDeleteRule: (ruleId: string) => void; onSchedule: (cadence: "manual" | "daily" | "weekly", localTime: string, weekday?: number) => void; onSelectAgentRuntime: (modelId: string, reasoningEffort: AgentReasoningEffort) => void; onConnectRuntime: () => void; onTelemetry: (enabled: boolean, replayEnabled: boolean) => void; onTelemetryDebug: (minutes: 0 | 30) => void; onExportDiagnostics: () => void; onSignOut: () => void }) {
  const preferences = settings?.preferences;
  const schedule = settings?.schedule;
  const [review, setReview] = useState(15);
  const [handoff, setHandoff] = useState(30);
  const [memory, setMemory] = useState<"none" | "selected" | "all">("selected");
  const [cadence, setCadence] = useState<"manual" | "daily" | "weekly">("daily");
  const [localTime, setLocalTime] = useState("09:00");
  const [weekday, setWeekday] = useState(1);
  const [scope, setScope] = useState<"global" | "course" | "pattern" | "assignment">("course");
  const [mode, setMode] = useState<PermissionMode>("attempt");
  const [courseId, setCourseId] = useState(onboarding.courses[0]?.courseId ?? "");
  const [assignmentId, setAssignmentId] = useState(onboarding.assignments[0]?.assignmentId ?? "");
  const [patternId, setPatternId] = useState("");
  useEffect(() => { if (preferences) { setReview(preferences.reviewMinutes); setHandoff(preferences.handoffMinutes); setMemory(preferences.memoryVisibility); } }, [preferences]);
  useEffect(() => { if (schedule) { setCadence(schedule.cadence); setLocalTime(schedule.localTime); setWeekday(schedule.weekday ?? 1); } }, [schedule]);
  const saveRule = (event: FormEvent) => { event.preventDefault(); if (scope === "global") onSaveRule({ scope, mode }); else if (scope === "course" && courseId) onSaveRule({ scope, courseId, mode }); else if (scope === "assignment" && assignmentId) onSaveRule({ scope, assignmentId, mode }); else if (scope === "pattern" && courseId && patternId.trim()) onSaveRule({ scope, courseId, patternId: patternId.trim(), mode }); };
  return <main className="app-shell"><AppChrome {...chrome} /><div className="page settings-page"><header className="page-hero compact"><div><p className="eyebrow">Electron-owned policy</p><h1>Settings</h1><p>These controls change local records and domain owners. The renderer never decides whether an assignment may run or submit.</p></div></header><div className="settings-grid"><PaperCard tone="yellow" className="settings-card"><p className="eyebrow">Work defaults</p><h2>Review, handoff, and memory</h2><div className="form-grid"><Field label="Review timer (minutes)"><input type="number" min={1} max={120} value={review} onChange={(event) => setReview(Number(event.target.value))} /></Field><Field label="Browser handoff limit (minutes)"><input type="number" min={1} max={240} value={handoff} onChange={(event) => setHandoff(Number(event.target.value))} /></Field><Field label="Memory visibility"><select value={memory} onChange={(event) => setMemory(event.target.value as typeof memory)}><option value="none">No memories</option><option value="selected">Selected memories</option><option value="all">All local memories</option></select></Field></div><button className="button button--yellow" disabled={busy !== null} onClick={() => onSavePreferences(review, handoff, memory)}>Save work defaults</button></PaperCard><PaperCard tone="sky" className="settings-card"><p className="eyebrow">School scan</p><h2>Automatic schedule</h2><div className="form-grid"><Field label="Cadence"><select value={cadence} onChange={(event) => setCadence(event.target.value as typeof cadence)}><option value="manual">Manual</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></Field><Field label="Local time"><input type="time" value={localTime} onChange={(event) => setLocalTime(event.target.value)} /></Field>{cadence === "weekly" && <Field label="Weekday"><select value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((label, index) => <option value={index} key={label}>{label}</option>)}</select></Field>}</div><button className="button button--mint" disabled={busy !== null} onClick={() => onSchedule(cadence, localTime, cadence === "weekly" ? weekday : undefined)}>Save schedule</button>{schedule && <small>Next run: {schedule.nextRunAt ? formatDateTime(schedule.nextRunAt) : "manual"} · {schedule.state}</small>}</PaperCard><PaperCard tone="coral" className="settings-card settings-card--wide"><p className="eyebrow">Permission resolver</p><h2>Global, course, pattern, and assignment rules</h2><form className="rule-form" onSubmit={saveRule}><Field label="Scope"><select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="global">Global</option><option value="course">Course</option><option value="pattern">Pattern</option><option value="assignment">Assignment</option></select></Field>{(scope === "course" || scope === "pattern") && <Field label="Course"><select value={courseId} onChange={(event) => setCourseId(event.target.value)}>{onboarding.courses.map((course) => <option key={course.courseId} value={course.courseId}>{course.label}</option>)}</select></Field>}{scope === "assignment" && <Field label="Assignment"><select value={assignmentId} onChange={(event) => setAssignmentId(event.target.value)}>{onboarding.assignments.map((assignment) => <option key={assignment.assignmentId} value={assignment.assignmentId}>{assignment.title}</option>)}</select></Field>}{scope === "pattern" && <Field label="Confirmed pattern ID"><input value={patternId} onChange={(event) => setPatternId(event.target.value)} placeholder="weekly-problem-set" /></Field>}<Field label="Permission"><select value={mode} onChange={(event) => setMode(event.target.value as PermissionMode)}><option value="do_not_attempt">Do not attempt</option><option value="attempt">Attempt, never submit</option><option value="auto_submit">Auto-submit allowed</option></select></Field><button className="button button--coral" disabled={busy !== null}>Add rule</button></form><div className="rules-list">{settings?.permissionRules.map((rule) => <div key={rule.ruleId}><span><strong>{rule.scope}</strong><small>{rule.mode.replaceAll("_", " ")} · {"courseId" in rule ? rule.courseId : "assignmentId" in rule ? rule.assignmentId : "all assignments"}{"patternId" in rule ? ` · ${rule.patternId}` : ""}</small></span><button className="quiet-button" onClick={() => onDeleteRule(rule.ruleId)}>Remove</button></div>)}{(settings?.permissionRules.length ?? 0) === 0 && <small>No rules saved. Studi will not attempt work without a matching permission.</small>}</div></PaperCard><PaperCard tone="mint" className="settings-card"><p className="eyebrow">Agent runtime</p><h2>{workspace?.provider.providerName ?? "Local runtime"}</h2><p>{workspace?.provider.reason}</p><RuntimeAttentionBanner attention={classifyAgentRuntimeAttention(workspace?.provider)} workspace={workspace} busy={busy !== null} onConnect={onConnectRuntime} /><button className="button button--yellow" type="button" onClick={onConnectRuntime} disabled={busy !== null}>{workspace?.provider.state === "ready" ? "Connect another ChatGPT" : "Reconnect Codex"}</button><div className="form-grid"><Field label="Active model"><select value={workspace?.selectedModelId ?? ""} onChange={(event) => onSelectAgentRuntime(event.target.value, workspace?.selectedReasoningEffort ?? "high")} disabled={!workspace || busy !== null}>{workspace?.models.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</select></Field><Field label="Reasoning effort"><select value={workspace?.selectedReasoningEffort ?? "high"} onChange={(event) => workspace && onSelectAgentRuntime(workspace.selectedModelId, event.target.value as AgentReasoningEffort)} disabled={!workspace || busy !== null}><option value="off">Off</option><option value="minimal">Minimal</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="xhigh">Extra high</option></select></Field></div><small>Default is gpt-5.6-sol on high reasoning. New sessions use the saved pair.</small></PaperCard><TelemetryControls telemetry={telemetry} busy={busy === "telemetry"} onChange={onTelemetry} onDebug={onTelemetryDebug} /><PaperCard tone="lavender" className="settings-card"><p className="eyebrow">Private beta support</p><h2>Studi {runtime?.app ?? "—"}</h2><p>Export an allowlisted JSON bundle with runtime versions, storage health, and redacted recent diagnostics. It never copies your local data folder.</p><button className="button button--lavender" onClick={onExportDiagnostics} disabled={busy !== null}>{busy === "diagnostics" ? "Preparing…" : "Export safe diagnostics"}</button>{diagnosticsReceipt?.status === "saved" && <small>Saved {diagnosticsReceipt.fileName}</small>}{diagnosticsReceipt?.status === "cancelled" && <small>Export cancelled. Nothing was written.</small>}</PaperCard><PaperCard tone="paper" className="settings-card"><p className="eyebrow">Account</p><h2>{chrome.studentName}</h2><p>Signing out clears the cloud account session. Local school data remains on this computer.</p><button className="button button--coral" onClick={onSignOut} disabled={busy !== null}>Sign out of Studi</button></PaperCard></div>{error && <p className="error-note">{error}</p>}</div></main>;
}

function laneItems(tasks: readonly TaskSummary[], lane: "queued" | "working" | "ready_review" | "done"): TaskSummary[] { if (lane === "done") return tasks.filter((item) => ["submitted", "preserved"].includes(item.task.state)); if (lane === "working") return tasks.filter((item) => ["working", "needs_user"].includes(item.task.state)); return tasks.filter((item) => item.task.state === lane); }
function courseLabel(onboarding: SchoolOnboardingState, courseId: string): string { return onboarding.courses.find((course) => course.courseId === courseId)?.label ?? courseId; }
function courseTone(course: string): number { return [...course].reduce((total, character) => total + character.charCodeAt(0), 0) % 6; }
function localDateKey(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function fiveDays(): Array<{ key: string; label: string; date: string }> { const formatter = new Intl.DateTimeFormat(undefined, { weekday: "long" }); const dateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }); const start = new Date(); start.setHours(0, 0, 0, 0); return Array.from({ length: 5 }, (_, offset) => { const date = new Date(start); date.setDate(start.getDate() + offset); return { key: localDateKey(date), label: offset === 0 ? "Today" : formatter.format(date), date: dateFormatter.format(date) }; }); }
