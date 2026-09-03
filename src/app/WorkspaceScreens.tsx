import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  classifyAgentRuntimeAttention,
  type AgentReasoningEffort,
  type DiagnosticsExportReceipt,
  type LibraryState,
  type LifecycleState,
  type NotificationKind,
  type NotificationPreferences,
  type NotificationSoundId,
  type NotificationTestReceipt,
  type PermissionMode,
  type ProductSettingsState,
  type RuntimeInfo,
  type SchoolOnboardingState,
  type StudiWorkspaceState,
  type SchoolPageBounds,
  type TaskDetail,
  type TaskSummary,
  type TelemetryState,
} from "../../shared/index.js";
import { DeskDrawer, deskInkyState, type DeskPanel } from "./DeskScreen.js";
import { Inky } from "./Inky.js";
import { AppChrome, type AppScreen, Field, PaperCard, RuntimeAttentionBanner, StatusPill, TelemetryControls, formatDateTime } from "./Ui.js";

type SaveRuleInput =
  | { ruleId?: string; scope: "global"; mode: PermissionMode }
  | { ruleId?: string; scope: "course"; courseId: string; mode: PermissionMode }
  | { ruleId?: string; scope: "pattern"; courseId: string; patternId: string; mode: PermissionMode }
  | { ruleId?: string; scope: "assignment"; assignmentId: string; mode: PermissionMode };

export interface ChromeProps {
  screen: AppScreen;
  studentName: string;
  status: string;
  deskOpen: boolean;
  deskBusy: boolean;
  onNavigate: (screen: AppScreen) => void;
  onOpenDesk: () => void;
}

export function DashboardScreen({
  chrome,
  onboarding,
  workspace,
  lifecycle,
  library,
  detail,
  panel,
  showingLiveDesk,
  talk,
  managerReply,
  busy,
  error,
  onCommand,
  onAssignment,
  onOpenDesk,
  onClosePanel,
  onStart,
  onTalk,
  onTakeover,
  onResume,
  onCancel,
  onVerifySubmission,
  onOpenArtifact,
  onScanAgain,
  onConnectRuntime,
  onFeedback,
  onSchoolSlot,
}: {
  chrome: ChromeProps;
  onboarding: SchoolOnboardingState;
  workspace: StudiWorkspaceState | null;
  lifecycle: LifecycleState;
  library: LibraryState | null;
  detail: TaskDetail | null;
  panel: DeskPanel;
  showingLiveDesk: boolean;
  talk: readonly { who: "you" | "inky"; text: string }[];
  managerReply: string;
  busy: string | null;
  error: string | null;
  onCommand: (prompt: string) => void;
  onAssignment: (assignmentId: string) => void;
  onOpenDesk: () => void;
  onClosePanel: () => void;
  onStart: (taskId: string) => void;
  onTalk: (prompt: string) => void;
  onTakeover: (taskId: string) => void;
  onResume: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  onVerifySubmission: (taskId: string, confirmation: string) => void;
  onOpenArtifact: (taskId: string) => void;
  onScanAgain: () => void;
  onConnectRuntime: () => void;
  onFeedback: (context: string, message: string) => void;
  onSchoolSlot: (bounds: SchoolPageBounds | null) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [feedback, setFeedback] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const verified = onboarding.assignments.filter((assignment) => assignment.lastVerifiedScanId && assignment.evidence.length > 0);
  const taskByAssignment = new Map((library?.tasks ?? []).map((item) => [item.assignment.assignmentId, item]));
  const days = useMemo(() => fiveDays(), []);
  const scan = onboarding.scan;
  const dueToday = verified.filter((assignment) => assignment.dueAt && localDateKey(new Date(assignment.dueAt)) === days[0]?.key).length;
  const runtimeAttention = classifyAgentRuntimeAttention(workspace?.provider, scan?.state === "failed" ? scan.failures[0] ?? scan.currentStep : null);
  const inkyState = deskInkyState({
    ...(lifecycle.execution ? { execution: lifecycle.execution } : {}),
    ...(workspace ? { driver: workspace.browser.driver } : {}),
    ...(scan ? { scanState: scan.state } : {}),
    runtimeAttention,
  });
  const selectedAssignment = panel.kind === "assignment"
    ? onboarding.assignments.find((item) => item.assignmentId === panel.assignmentId) ?? null
    : panel.kind === "desk"
      ? onboarding.assignments.find((item) => item.assignmentId === (detail?.assignment.assignmentId ?? lifecycle.execution?.assignmentId)) ?? null
      : null;
  const selectedTask = selectedAssignment ? taskByAssignment.get(selectedAssignment.assignmentId) ?? (detail && detail.assignment.assignmentId === selectedAssignment.assignmentId ? detail : null) : (panel.kind === "desk" && detail ? detail : null);

  const submitCommand = (event: FormEvent) => {
    event.preventDefault();
    if (!prompt.trim()) return;
    onCommand(prompt.trim());
    setPrompt("");
  };

  return (
    <main className={`app-shell ${panel.kind !== "closed" ? "is-drawer-open" : ""} ${showingLiveDesk ? "is-desk-open" : ""}`} data-studi-app-ready="true">
      <AppChrome {...chrome} />
      <div className="page dashboard-page">
        <header className="page-hero dashboard-hero">
          <div className="dashboard-greeting">
            <button className="inky-trigger" type="button" onClick={onOpenDesk} aria-label="Open Inky’s desk">
              <Inky state={inkyState} size={74} label={`Inky is ${inkyState}`} />
            </button>
            <div>
              <p className="eyebrow">Your week</p>
              <h1>Hey {chrome.studentName} — {dueToday === 0 ? "you’re clear today." : `${dueToday} ${dueToday === 1 ? "thing" : "things"} due today.`}</h1>
              <p>Everything here comes from school pages Studi actually checked.</p>
            </div>
          </div>
          <div className="freshness">
            <div className="sync-status">
              <StatusPill tone={scan?.state === "succeeded" ? "mint" : "yellow"}>{scan?.state ?? "not scanned"}</StatusPill>
              <span>{scan?.completedAt ? `checked ${formatDateTime(scan.completedAt)}` : "first scan incomplete"}</span>
              <button className="sync-now" onClick={onScanAgain} disabled={busy !== null} aria-label="Scan school again">↻</button>
            </div>
          </div>
        </header>

        <RuntimeAttentionBanner attention={runtimeAttention} workspace={workspace} busy={busy !== null} onConnect={onConnectRuntime} />
        {scan?.state === "partial" && runtimeAttention === "none" && <div className="truth-banner truth-banner--partial"><strong>This view is partial.</strong><span>{scan.failures[0] ?? "Some school coverage could not be verified."}</span><button onClick={onScanAgain}>Retry visible scan</button></div>}
        {scan?.state === "failed" && runtimeAttention === "none" && <div className="truth-banner truth-banner--error"><strong>The latest scan failed.</strong><span>Prior verified assignments remain; nothing new is marked complete.</span><button onClick={onScanAgain}>Retry</button></div>}

        <form className="manager-bar" onSubmit={submitCommand}>
          <span className="manager-pen" aria-hidden="true">✎</span>
          <input aria-label="Tell Studi what to do" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Tell Studi what to do — plan my night, start my essay…" maxLength={20_000} />
          <button className="manager-send" disabled={busy !== null || !prompt.trim()}>{busy === "manager" ? "thinking…" : "enter ↵"}</button>
        </form>
        {managerReply && panel.kind === "closed" && <PaperCard tone="lavender" className="manager-reply"><p className="eyebrow">Inky</p><p>{managerReply}</p></PaperCard>}

        <section className="week-section">
          <div className="section-title">
            <div><h2>This week</h2></div>
            <div className="week-tools">
              <span>{verified.length} verified assignment{verified.length === 1 ? "" : "s"}</span>
              <button className="quiet-button" type="button" onClick={() => setNoteOpen((open) => !open)}>{noteOpen ? "Hide note" : "Something look wrong?"}</button>
            </div>
          </div>
          {noteOpen && (
            <form className="week-note" onSubmit={(event) => { event.preventDefault(); if (!feedback.trim()) return; onFeedback("dashboard", feedback.trim()); setFeedback(""); setNoteOpen(false); }}>
              <input value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Tell Studi what this view missed" maxLength={1000} />
              <button className="button button--yellow" disabled={!feedback.trim() || busy !== null}>Send note</button>
            </form>
          )}
          <div className="week-grid">
            {days.map((day, index) => {
              const items = verified.filter((assignment) => assignment.dueAt && localDateKey(new Date(assignment.dueAt)) === day.key);
              return (
                <section className={`day-column ${index === 0 ? "is-today" : ""}`} key={day.key}>
                  <header><strong>{day.label}</strong><small>{index === 0 ? "today" : day.date}</small></header>
                  <div className="day-stack">
                    {items.length === 0 ? <p className="empty-day"><span aria-hidden="true">〰</span>No verified deadlines</p> : items.map((assignment) => {
                      const task = taskByAssignment.get(assignment.assignmentId);
                      const course = courseLabel(onboarding, assignment.courseId);
                      const selected = (panel.kind === "assignment" && panel.assignmentId === assignment.assignmentId)
                        || (showingLiveDesk && lifecycle.execution?.assignmentId === assignment.assignmentId);
                      return <AssignmentCard key={assignment.assignmentId} assignmentId={assignment.assignmentId} selected={selected} {...(task ? { item: task } : {})} title={assignment.title} {...(assignment.dueAt ? { dueAt: assignment.dueAt } : {})} course={course} tone={courseTone(course)} onAssignment={onAssignment} />;
                    })}
                  </div>
                </section>
              );
            })}
          </div>
          {verified.length === 0 && <PaperCard tone="yellow" className="empty-state"><p className="eyebrow">Nothing checked yet</p><h3>No verified assignments yet.</h3><p>{scan?.state === "succeeded" ? "The completed scan did not find assignment evidence. Check your school page or tell Studi what may be missing." : "Finish the visible school scan before Studi can populate your week."}</p></PaperCard>}
        </section>
        {error && panel.kind === "closed" && <p className="error-note" role="alert">{error}</p>}
      </div>
      {panel.kind !== "closed" && (
        <DeskDrawer
          panel={panel}
          onboarding={onboarding}
          workspace={workspace}
          lifecycle={lifecycle}
          detail={detail}
          assignment={selectedAssignment}
          task={selectedTask}
          showingLiveDesk={showingLiveDesk}
          busy={busy}
          error={error}
          talk={talk}
          onClose={onClosePanel}
          onStart={onStart}
          onTalk={onTalk}
          onTakeover={onTakeover}
          onResume={onResume}
          onCancel={onCancel}
          onVerifySubmission={onVerifySubmission}
          onOpenArtifact={onOpenArtifact}
          onConnectRuntime={onConnectRuntime}
          onSchoolSlot={onSchoolSlot}
        />
      )}
    </main>
  );
}

function AssignmentCard({ assignmentId, item, title, dueAt, course, tone, selected, onAssignment }: { assignmentId: string; item?: TaskSummary; title: string; dueAt?: string; course: string; tone: number; selected: boolean; onAssignment: (assignmentId: string) => void }) {
  return (
    <button className={`assignment-card course-accent-${tone} ${selected ? "is-selected" : ""}`} onClick={() => onAssignment(assignmentId)}>
      <small>{course}</small>
      <strong>{title}</strong>
      <span>{dueAt ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(dueAt)) : "No time"}</span>
      {item && <StatusPill tone={item.task.state === "submitted" || item.task.state === "preserved" ? "mint" : item.task.state === "needs_user" || item.task.state === "ready_review" ? "coral" : "plain"}>{item.task.state.replace("_", " ")}</StatusPill>}
    </button>
  );
}

const NOTIFICATION_ROWS: ReadonlyArray<{ kind: NotificationKind; label: string; hint: string }> = [
  { kind: "handoff", label: "Needs you", hint: "Inky is waiting in the page." },
  { kind: "review_ready", label: "Ready to look over", hint: "An assignment is sitting for you." },
  { kind: "scan_result", label: "Scan finished", hint: "A class look-through finished." },
  { kind: "failure", label: "Something went wrong", hint: "Inky had to stop." },
];

const SOUND_OPTIONS: ReadonlyArray<{ id: NotificationSoundId; label: string }> = [
  { id: "silent", label: "Silent" },
  { id: "os", label: "Windows sound" },
  { id: "inky_nudge", label: "Inky nudge" },
  { id: "inky_done", label: "Inky done" },
  { id: "inky_soft", label: "Inky soft" },
  { id: "inky_uh_oh", label: "Inky uh-oh" },
];

function NotificationSettings({
  preferences,
  busy,
  onSave,
  onPreview,
}: {
  preferences: NotificationPreferences | undefined;
  busy: boolean;
  onSave: (notifications: NotificationPreferences) => void;
  onPreview: (kind: NotificationKind) => Promise<NotificationTestReceipt | undefined>;
}) {
  const [receipt, setReceipt] = useState<NotificationTestReceipt | null>(null);
  const [previewing, setPreviewing] = useState<NotificationKind | null>(null);
  if (!preferences) return null;

  const update = (next: NotificationPreferences) => {
    onSave(next);
  };

  return (
    <PaperCard tone="pink" className="settings-card settings-card--wide">
      <p className="eyebrow">Inky pings</p>
      <h2>Let Inky ping you</h2>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={preferences.enabled}
          disabled={busy}
          onChange={(event) => update({ ...preferences, enabled: event.target.checked })}
        />
        <span>
          <strong>Let Inky ping you</strong>
          <small>Banners can pop up even while Studi is already open.</small>
        </span>
      </label>
      <div className="notification-rows">
        {NOTIFICATION_ROWS.map((row) => {
          const kind = preferences.kinds[row.kind];
          return (
            <div className="notification-row" key={row.kind}>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={kind.banner}
                  disabled={busy || !preferences.enabled}
                  onChange={(event) => update({
                    ...preferences,
                    kinds: { ...preferences.kinds, [row.kind]: { ...kind, banner: event.target.checked } },
                  })}
                />
                <span>
                  <strong>{row.label}</strong>
                  <small>{row.hint}</small>
                </span>
              </label>
              <Field label="Sound">
                <select
                  value={kind.sound}
                  disabled={busy || !preferences.enabled}
                  onChange={(event) => update({
                    ...preferences,
                    kinds: { ...preferences.kinds, [row.kind]: { ...kind, sound: event.target.value as NotificationSoundId } },
                  })}
                >
                  {SOUND_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </Field>
              <button
                className="button button--paper"
                type="button"
                disabled={busy || previewing !== null}
                onClick={() => {
                  setPreviewing(row.kind);
                  void onPreview(row.kind).then((next) => {
                    if (next) setReceipt(next);
                    setPreviewing(null);
                  });
                }}
              >
                {previewing === row.kind ? "Pinging…" : "Preview"}
              </button>
            </div>
          );
        })}
      </div>
      <small>Inky sounds use the Windows ping until the Inky files are added.</small>
      {receipt && !receipt.shown && (
        <small>If nothing popped up, Windows may be hiding Studi. Check Settings → System → Notifications.</small>
      )}
    </PaperCard>
  );
}

export function SettingsScreen({
  chrome,
  settings,
  onboarding,
  workspace,
  telemetry,
  runtime,
  diagnosticsReceipt,
  busy,
  error,
  onSavePreferences,
  onSaveNotifications,
  onTestNotification,
  onSaveRule,
  onDeleteRule,
  onSchedule,
  onSelectAgentRuntime,
  onConnectRuntime,
  onTelemetry,
  onTelemetryDebug,
  onExportDiagnostics,
  onSignOut,
  onFeedback,
}: {
  chrome: ChromeProps;
  settings: ProductSettingsState | null;
  onboarding: SchoolOnboardingState;
  workspace: StudiWorkspaceState | null;
  telemetry: TelemetryState | null;
  runtime: RuntimeInfo | null;
  diagnosticsReceipt: DiagnosticsExportReceipt | null;
  busy: string | null;
  error: string | null;
  onSavePreferences: (reviewMinutes: number, handoffMinutes: number, memoryVisibility: "none" | "selected" | "all") => void;
  onSaveNotifications: (notifications: NotificationPreferences) => void;
  onTestNotification: (kind: NotificationKind) => Promise<NotificationTestReceipt | undefined>;
  onSaveRule: (input: SaveRuleInput) => void;
  onDeleteRule: (ruleId: string) => void;
  onSchedule: (cadence: "manual" | "daily" | "weekly", localTime: string, weekday?: number) => void;
  onSelectAgentRuntime: (modelId: string, reasoningEffort: AgentReasoningEffort) => void;
  onConnectRuntime: () => void;
  onTelemetry: (enabled: boolean, replayEnabled: boolean) => void;
  onTelemetryDebug: (minutes: 0 | 30) => void;
  onExportDiagnostics: () => void;
  onSignOut: () => void;
  onFeedback: (context: string, message: string) => void;
}) {
  const preferences = settings?.preferences;
  const schedule = settings?.schedule;
  const [section, setSection] = useState<"inky" | "school" | "privacy" | "account">("inky");
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
  const [note, setNote] = useState("");
  useEffect(() => { if (preferences) { setReview(preferences.reviewMinutes); setHandoff(preferences.handoffMinutes); setMemory(preferences.memoryVisibility); } }, [preferences]);
  useEffect(() => { if (schedule) { setCadence(schedule.cadence); setLocalTime(schedule.localTime); setWeekday(schedule.weekday ?? 1); } }, [schedule]);
  const saveRule = (event: FormEvent) => {
    event.preventDefault();
    if (scope === "global") onSaveRule({ scope, mode });
    else if (scope === "course" && courseId) onSaveRule({ scope, courseId, mode });
    else if (scope === "assignment" && assignmentId) onSaveRule({ scope, assignmentId, mode });
    else if (scope === "pattern" && courseId && patternId.trim()) onSaveRule({ scope, courseId, patternId: patternId.trim(), mode });
  };

  return (
    <main className="app-shell" data-studi-app-ready="true">
      <AppChrome {...chrome} />
      <div className="page settings-page">
        <header className="page-hero compact settings-hero">
          <div>
            <p className="eyebrow">Your Studi</p>
            <h1>Settings</h1>
            <p>How Inky works for you. School passwords stay in the page you signed into.</p>
          </div>
        </header>
        <nav className="settings-tabs" aria-label="Settings sections">
          {([["inky", "Inky"], ["school", "School"], ["privacy", "Privacy"], ["account", "Account"]] as const).map(([id, label]) => (
            <button className={section === id ? "is-active" : ""} type="button" key={id} onClick={() => setSection(id)}>{label}</button>
          ))}
        </nav>

        {section === "inky" && (
          <div className="settings-stack">
            <PaperCard tone="mint" className="settings-card">
              <p className="eyebrow">ChatGPT</p>
              <h2>{workspace?.provider.providerName ?? "Inky’s brain"}</h2>
              <p>{workspace?.provider.reason}</p>
              <RuntimeAttentionBanner attention={classifyAgentRuntimeAttention(workspace?.provider)} workspace={workspace} busy={busy !== null} onConnect={onConnectRuntime} />
              <button className="button button--yellow" type="button" onClick={onConnectRuntime} disabled={busy !== null}>{workspace?.provider.state === "ready" ? "Use another ChatGPT" : "Connect ChatGPT"}</button>
              <div className="form-grid form-grid--two">
                <Field label="Model"><select value={workspace?.selectedModelId ?? ""} onChange={(event) => onSelectAgentRuntime(event.target.value, workspace?.selectedReasoningEffort ?? "high")} disabled={!workspace || busy !== null}>{workspace?.models.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</select></Field>
                <Field label="How hard Inky thinks"><select value={workspace?.selectedReasoningEffort ?? "high"} onChange={(event) => workspace && onSelectAgentRuntime(workspace.selectedModelId, event.target.value as AgentReasoningEffort)} disabled={!workspace || busy !== null}><option value="off">Off</option><option value="minimal">Minimal</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="xhigh">Extra high</option></select></Field>
              </div>
              <small>New chats use the pair you save here.</small>
            </PaperCard>
            <PaperCard tone="yellow" className="settings-card">
              <p className="eyebrow">When Inky finishes</p>
              <h2>Review and memory</h2>
              <div className="form-grid form-grid--two">
                <Field label="Minutes to look over answers"><input type="number" min={1} max={120} value={review} onChange={(event) => setReview(Number(event.target.value))} /></Field>
                <Field label="Minutes Inky waits on the page"><input type="number" min={1} max={240} value={handoff} onChange={(event) => setHandoff(Number(event.target.value))} /></Field>
                <Field label="What Inky may remember"><select value={memory} onChange={(event) => setMemory(event.target.value as typeof memory)}><option value="none">Nothing</option><option value="selected">Things you pick</option><option value="all">Everything saved</option></select></Field>
              </div>
              <button className="button button--yellow" disabled={busy !== null} onClick={() => onSavePreferences(review, handoff, memory)}>Save</button>
            </PaperCard>
            <NotificationSettings preferences={preferences?.notifications} busy={busy !== null} onSave={onSaveNotifications} onPreview={onTestNotification} />
          </div>
        )}

        {section === "school" && (
          <div className="settings-stack">
            <PaperCard tone="sky" className="settings-card">
              <p className="eyebrow">Check school</p>
              <h2>Automatic look</h2>
              <div className="form-grid form-grid--two">
                <Field label="How often"><select value={cadence} onChange={(event) => setCadence(event.target.value as typeof cadence)}><option value="manual">Only when I ask</option><option value="daily">Every day</option><option value="weekly">Every week</option></select></Field>
                <Field label="Local time"><input type="time" value={localTime} onChange={(event) => setLocalTime(event.target.value)} /></Field>
                {cadence === "weekly" && <Field label="Weekday"><select value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((label, index) => <option value={index} key={label}>{label}</option>)}</select></Field>}
              </div>
              <button className="button button--mint" disabled={busy !== null} onClick={() => onSchedule(cadence, localTime, cadence === "weekly" ? weekday : undefined)}>Save schedule</button>
              {schedule && <small>Next look: {schedule.nextRunAt ? formatDateTime(schedule.nextRunAt) : "only when you ask"}</small>}
            </PaperCard>
            <PaperCard tone="coral" className="settings-card">
              <p className="eyebrow">What Inky may try</p>
              <h2>Homework rules</h2>
              <form className="rule-form rule-form--stack" onSubmit={saveRule}>
                <Field label="For"><select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="global">Everything</option><option value="course">A class</option><option value="pattern">A pattern</option><option value="assignment">One assignment</option></select></Field>
                {(scope === "course" || scope === "pattern") && <Field label="Class"><select value={courseId} onChange={(event) => setCourseId(event.target.value)}>{onboarding.courses.map((course) => <option key={course.courseId} value={course.courseId}>{course.label}</option>)}</select></Field>}
                {scope === "assignment" && <Field label="Assignment"><select value={assignmentId} onChange={(event) => setAssignmentId(event.target.value)}>{onboarding.assignments.map((assignment) => <option key={assignment.assignmentId} value={assignment.assignmentId}>{assignment.title}</option>)}</select></Field>}
                {scope === "pattern" && <Field label="Pattern"><input value={patternId} onChange={(event) => setPatternId(event.target.value)} placeholder="weekly-problem-set" /></Field>}
                <Field label="Inky may"><select value={mode} onChange={(event) => setMode(event.target.value as PermissionMode)}><option value="do_not_attempt">Don’t try it</option><option value="attempt">Try it, don’t submit</option><option value="auto_submit">Submit if that’s allowed</option></select></Field>
                <button className="button button--coral" disabled={busy !== null}>Add rule</button>
              </form>
              <div className="rules-list">
                {settings?.permissionRules.map((rule) => (
                  <div key={rule.ruleId}>
                    <span>
                      <strong>{rule.scope === "global" ? "Everything" : rule.scope}</strong>
                      <small>{rule.mode.replaceAll("_", " ")} · {"courseId" in rule ? rule.courseId : "assignmentId" in rule ? rule.assignmentId : "all homework"}{"patternId" in rule ? ` · ${rule.patternId}` : ""}</small>
                    </span>
                    <button className="quiet-button" onClick={() => onDeleteRule(rule.ruleId)}>Remove</button>
                  </div>
                ))}
                {(settings?.permissionRules.length ?? 0) === 0 && <small>No rules yet. Inky won’t start homework without one.</small>}
              </div>
            </PaperCard>
          </div>
        )}

        {section === "privacy" && (
          <div className="settings-stack">
            <TelemetryControls telemetry={telemetry} busy={busy === "telemetry"} onChange={onTelemetry} onDebug={onTelemetryDebug} />
            <PaperCard tone="lavender" className="settings-card">
              <p className="eyebrow">If something broke</p>
              <h2>Safe diagnostics</h2>
              <p>Saves a short JSON file with versions and recent product events. Secrets stay out. It never copies your school folder.</p>
              <button className="button button--lavender" onClick={onExportDiagnostics} disabled={busy !== null}>{busy === "diagnostics" ? "Preparing…" : "Export diagnostics"}</button>
              {diagnosticsReceipt?.status === "saved" && <small>Saved {diagnosticsReceipt.fileName}</small>}
              {diagnosticsReceipt?.status === "cancelled" && <small>Nothing was written.</small>}
              <small>Studi {runtime?.app ?? "—"}</small>
            </PaperCard>
            <PaperCard className="settings-card">
              <p className="eyebrow">A note for us</p>
              <h2>Something look wrong?</h2>
              <form className="settings-note" onSubmit={(event) => { event.preventDefault(); if (!note.trim()) return; onFeedback("settings", note.trim()); setNote(""); }}>
                <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="Tell Studi what to fix" />
                <button className="button button--yellow" disabled={!note.trim() || busy !== null}>Send note</button>
              </form>
            </PaperCard>
          </div>
        )}

        {section === "account" && (
          <div className="settings-stack">
            <PaperCard tone="paper" className="settings-card">
              <p className="eyebrow">Signed in</p>
              <h2>{chrome.studentName}</h2>
              <p>Signing out leaves your school pages and saved work on this laptop.</p>
              <button className="button button--coral" onClick={onSignOut} disabled={busy !== null}>Sign out</button>
            </PaperCard>
          </div>
        )}
        {error && <p className="error-note">{error}</p>}
      </div>
    </main>
  );
}

function courseLabel(onboarding: SchoolOnboardingState, courseId: string): string { return onboarding.courses.find((course) => course.courseId === courseId)?.label ?? courseId; }
function courseTone(course: string): number { return [...course].reduce((total, character) => total + character.charCodeAt(0), 0) % 6; }
function localDateKey(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function fiveDays(): Array<{ key: string; label: string; date: string }> { const formatter = new Intl.DateTimeFormat(undefined, { weekday: "long" }); const dateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }); const start = new Date(); start.setHours(0, 0, 0, 0); return Array.from({ length: 5 }, (_, offset) => { const date = new Date(start); date.setDate(start.getDate() + offset); return { key: localDateKey(date), label: offset === 0 ? "Today" : formatter.format(date), date: dateFormatter.format(date) }; }); }
