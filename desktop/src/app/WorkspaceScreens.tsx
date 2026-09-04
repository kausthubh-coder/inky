import { type CSSProperties, type FormEvent, useEffect, useMemo, useState } from "react";

import {
  classifyAgentRuntimeAttention,
  connectedAppCatalogEntry,
  type AgentReasoningEffort,
  connectedAppIsActive,
  type ConnectedAppConnection,
  type ConnectedAppsState,
  type DiagnosticsExportReceipt,
  type Entitlement,
  type LibraryState,
  type LifecycleState,
  type NotificationKind,
  type NotificationPreferences,
  type NotificationSoundId,
  type NotificationTestReceipt,
  type PermissionMode,
  type PermissionRule,
  type ProductSettingsState,
  type RuntimeInfo,
  type SchoolOnboardingState,
  type StudiWorkspaceState,
  type SchoolPageBounds,
  type TaskDetail,
  type TaskSummary,
  type TelemetryState,
  type UsageState,
} from "../../shared/index.js";
import { DeskDrawer, deskInkyState, taskStatusCopy, type DeskPanel } from "./DeskScreen.js";
import { Inky } from "./Inky.js";
import { readDevPreviewConfig } from "./devPreview.js";
import { AppChrome, type AppScreen, type SettingsLanding, Field, PaperCard, RuntimeAttentionBanner, StatusPill, TelemetryControls, formatDateTime } from "./Ui.js";

type SettingsGroup = "inky" | "school" | "you";

function settingsGroup(section?: "inky" | "school" | "privacy" | "account"): SettingsGroup {
  if (section === "privacy" || section === "account") return "you";
  if (section === "school") return "school";
  return "inky";
}

type SaveRuleInput =
  | { ruleId?: string; scope: "global"; mode: PermissionMode }
  | { ruleId?: string; scope: "course"; courseId: string; mode: PermissionMode }
  | { ruleId?: string; scope: "pattern"; courseId: string; patternId: string; mode: PermissionMode }
  | { ruleId?: string; scope: "assignment"; assignmentId: string; mode: PermissionMode };

export interface ChromeProps {
  screen: AppScreen;
  settingsLanding: SettingsLanding;
  studentName: string;
  deskOpen: boolean;
  deskBusy: boolean;
  onNavigate: (screen: AppScreen, landing?: SettingsLanding) => void;
  onOpenDesk: () => void;
  onSignOut: () => void;
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
              <p>I checked these on the school pages.</p>
            </div>
          </div>
          <div className="freshness">
            <div className="sync-status">
              <StatusPill tone={scan?.state === "succeeded" ? "mint" : scan?.state === "failed" ? "coral" : "yellow"}>{scanStatusCopy(scan?.state)}</StatusPill>
              <span>{scan?.completedAt ? `checked ${formatDateTime(scan.completedAt)}` : "haven’t looked yet"}</span>
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

        <section className="week-section" data-studi-week-board="true">
          <div className="section-title">
            <div><h2>This week</h2></div>
            <div className="week-tools">
              <span>{verified.length === 0 ? "Nothing from school yet" : `${verified.length} from school`}</span>
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
                    {items.length === 0 ? <p className="empty-day"><span aria-hidden="true">〰</span>Nothing due</p> : items.map((assignment) => {
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
          {verified.length === 0 && <PaperCard className="empty-state"><p className="eyebrow">Nothing here yet</p><h3>I haven’t found homework on the school pages.</h3><p>{scan?.state === "succeeded" ? "I looked, and nothing showed up. Check the school page or tell me what I missed." : "Let me look through school first."}</p></PaperCard>}
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
  const status = item ? taskStatusCopy(item.task.state) : null;
  return (
    <button className={`assignment-card course-accent-${tone} ${selected ? "is-selected" : ""}`} onClick={() => onAssignment(assignmentId)}>
      <small>{course}</small>
      <strong>{title}</strong>
      <span>{dueAt ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(dueAt)) : "No time"}</span>
      {status && <StatusPill tone={status.tone}>{status.label}</StatusPill>}
    </button>
  );
}

function scanStatusCopy(state?: string): string {
  if (state === "succeeded") return "Checked";
  if (state === "running") return "Looking";
  if (state === "partial") return "Some pages";
  if (state === "failed") return "Stuck";
  if (state === "needs_user") return "Need you";
  return "Not yet";
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
    <PaperCard className="settings-card settings-card--wide">
      <p className="eyebrow">Nudges</p>
      <h2>When I should tap you</h2>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={preferences.enabled}
          disabled={busy}
          onChange={(event) => update({ ...preferences, enabled: event.target.checked })}
        />
        <span>
          <strong>Let me tap you</strong>
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

function UsageCard({ entitlement, usage }: { entitlement: Entitlement | null; usage: UsageState | null }) {
  if (!usage) {
    return (
      <PaperCard className="settings-card usage-card" id="usage-settings">
        <div className="usage-heading">
          <div>
            <p className="eyebrow">Usage</p>
            <h2>{entitlement?.plan === "supporter" ? "Supporter" : "Private beta"}</h2>
          </div>
          <span className="usage-plan">Offline</span>
        </div>
        <p>Connect to the internet and I’ll show your latest totals here.</p>
      </PaperCard>
    );
  }

  const remaining = Math.max(0, usage.tokenAllowance - usage.totalTokens);
  const percentage = Math.min(100, Math.round((usage.totalTokens / usage.tokenAllowance) * 100));
  const maximumDay = Math.max(1, ...usage.days.map((day) => day.tokens));
  const month = new Date(`${usage.period}-01T00:00:00.000Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <PaperCard className="settings-card usage-card" id="usage-settings">
      <div className="usage-heading">
        <div>
          <p className="eyebrow">{month} usage</p>
          <h2>{formatTokenCount(usage.totalTokens)} tokens</h2>
        </div>
        <span className="usage-plan">{usage.plan === "supporter" ? "Supporter" : "Private beta"}</span>
      </div>
      <div className="usage-meter" aria-label={`${percentage}% of this month's included tokens used`}>
        <span style={{ width: `${percentage}%` }} />
      </div>
      <div className="usage-meter-copy">
        <strong>{formatTokenCount(remaining)} left</strong>
        <span>{formatTokenCount(usage.tokenAllowance)} included</span>
      </div>

      <div className="usage-breakdown" aria-label="Token breakdown">
        <UsageNumber label="Input" value={usage.inputTokens} />
        <UsageNumber label="Output" value={usage.outputTokens} />
        <UsageNumber label="Cached" value={usage.cachedTokens} />
      </div>

      <div className="usage-chart-block">
        <div className="usage-section-heading">
          <strong>Tokens by day</strong>
          <span>{usage.toolCalls.toLocaleString()} tool calls</span>
        </div>
        <div className="usage-chart" aria-label={`Daily token usage for ${month}`}>
          {usage.days.map((day) => {
            const height = day.tokens === 0 ? 4 : Math.max(10, Math.round((day.tokens / maximumDay) * 100));
            const label = new Date(`${day.date}T00:00:00.000Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
            return <span key={day.date} title={`${label}: ${day.tokens.toLocaleString()} tokens`} style={{ "--usage-height": `${height}%` } as CSSProperties} />;
          })}
        </div>
      </div>

      <div className="usage-activity">
        <span><strong>{usage.inkyTurns.toLocaleString()}</strong> Inky turns</span>
        <span><strong>{usage.assignmentsWorked.toLocaleString()}</strong> assignments worked</span>
      </div>
      <p className="usage-privacy">Only these totals sync. Your prompts, answers, and school pages stay out of usage tracking.</p>
    </PaperCard>
  );
}

function UsageNumber({ label, value }: { label: string; value: number }) {
  return <span><small>{label}</small><strong>{formatTokenCount(value)}</strong></span>;
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function SettingsScreen({
  chrome,
  entitlement,
  usage,
  initialSection = "inky",
  settings,
  onboarding,
  workspace,
  connectedApps,
  appConnections,
  telemetry,
  runtime,
  diagnosticsReceipt,
  busy,
  error,
  onSavePreferences,
  onSelectHomeworkRoot,
  onSaveNotifications,
  onTestNotification,
  onSaveRule,
  onDeleteRule,
  onSchedule,
  onSelectAgentRuntime,
  onConnectRuntime,
  onConnectApp,
  onRefreshConnectedApp,
  onTelemetry,
  onTelemetryDebug,
  onExportDiagnostics,
  onSignOut,
  onFeedback,
}: {
  chrome: ChromeProps;
  entitlement: Entitlement | null;
  usage: UsageState | null;
  initialSection?: "inky" | "school" | "privacy" | "account";
  settings: ProductSettingsState | null;
  onboarding: SchoolOnboardingState;
  workspace: StudiWorkspaceState | null;
  connectedApps: ConnectedAppsState | null;
  appConnections: Readonly<Record<string, ConnectedAppConnection | null>>;
  telemetry: TelemetryState | null;
  runtime: RuntimeInfo | null;
  diagnosticsReceipt: DiagnosticsExportReceipt | null;
  busy: string | null;
  error: string | null;
  onSavePreferences: (reviewMinutes: number, handoffMinutes: number, memoryVisibility: "none" | "selected" | "all") => void;
  onSelectHomeworkRoot: () => void;
  onSaveNotifications: (notifications: NotificationPreferences) => void;
  onTestNotification: (kind: NotificationKind) => Promise<NotificationTestReceipt | undefined>;
  onSaveRule: (input: SaveRuleInput) => void;
  onDeleteRule: (ruleId: string) => void;
  onSchedule: (cadence: "manual" | "daily" | "weekly", localTime: string, weekday?: number) => void;
  onSelectAgentRuntime: (modelId: string, reasoningEffort: AgentReasoningEffort) => void;
  onConnectRuntime: () => void;
  onConnectApp: (toolkit: string) => void;
  onRefreshConnectedApp: (toolkit: string) => void;
  onTelemetry: (enabled: boolean, replayEnabled: boolean) => void;
  onTelemetryDebug: (minutes: 0 | 30) => void;
  onExportDiagnostics: () => void;
  onSignOut: () => void;
  onFeedback: (context: string, message: string) => void;
}) {
  const preferences = settings?.preferences;
  const schedule = settings?.schedule;
  const [section, setSection] = useState<SettingsGroup>(() => chrome.settingsLanding === "settings" ? settingsGroup(readDevPreviewConfig()?.settingsSection ?? initialSection) : "you");
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
  useEffect(() => {
    const targetId = chrome.settingsLanding === "usage" ? "usage-settings" : chrome.settingsLanding === "feedback" ? "feedback-settings" : null;
    if (!targetId) return undefined;
    const frame = window.requestAnimationFrame(() => document.getElementById(targetId)?.scrollIntoView({ block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [chrome.settingsLanding]);
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
          <div className="settings-greeting">
            <Inky state="idle" size={64} label="Inky" />
            <div>
              <p className="eyebrow">Settings</p>
              <h1>This is how I work for you.</h1>
            </div>
          </div>
        </header>
        <nav className="settings-tabs" aria-label="Settings sections">
          {([["inky", "Inky"], ["school", "School"], ["you", "You"]] as const).map(([id, label]) => (
            <button className={section === id ? "is-active" : ""} type="button" key={id} onClick={() => setSection(id)}>{label}</button>
          ))}
        </nav>

        {section === "inky" && (
          <div className="settings-stack">
            <PaperCard className="settings-card">
              <p className="eyebrow">How I think</p>
              <h2>{workspace?.provider.providerName ?? "ChatGPT"}</h2>
              <p>{workspace?.provider.reason}</p>
              <RuntimeAttentionBanner attention={classifyAgentRuntimeAttention(workspace?.provider)} workspace={workspace} busy={busy !== null} onConnect={onConnectRuntime} />
              <button className="button button--yellow" type="button" onClick={onConnectRuntime} disabled={busy !== null}>{workspace?.provider.state === "ready" ? "Use another ChatGPT" : "Connect ChatGPT"}</button>
              <div className="form-grid form-grid--two">
                <Field label="Model"><select value={workspace?.selectedModelId ?? ""} onChange={(event) => onSelectAgentRuntime(event.target.value, workspace?.selectedReasoningEffort ?? "high")} disabled={!workspace || busy !== null}>{workspace?.models.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</select></Field>
                <Field label="How hard I think"><select value={workspace?.selectedReasoningEffort ?? "high"} onChange={(event) => workspace && onSelectAgentRuntime(workspace.selectedModelId, event.target.value as AgentReasoningEffort)} disabled={!workspace || busy !== null}><option value="off">Off</option><option value="minimal">Minimal</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="xhigh">Extra high</option></select></Field>
              </div>
              <small>New chats use the pair you save here.</small>
            </PaperCard>
            <PaperCard className="settings-card">
              <p className="eyebrow">When I finish</p>
              <h2>Your look, then I wait</h2>
              <div className="form-grid form-grid--two">
                <Field label="Minutes to look over answers"><input type="number" min={1} max={120} value={review} onChange={(event) => setReview(Number(event.target.value))} /></Field>
                <Field label="Minutes I wait on the page"><input type="number" min={1} max={240} value={handoff} onChange={(event) => setHandoff(Number(event.target.value))} /></Field>
                <Field label="What I may remember"><select value={memory} onChange={(event) => setMemory(event.target.value as typeof memory)}><option value="none">Nothing</option><option value="selected">Things you pick</option><option value="all">Everything saved</option></select></Field>
              </div>
              <button className="button button--yellow" disabled={busy !== null} onClick={() => onSavePreferences(review, handoff, memory)}>Save</button>
            </PaperCard>
            <PaperCard className="settings-card">
              <p className="eyebrow">Connected apps</p>
              <h2>Tools I can use</h2>
              <p>Connections happen in your browser. Studi never receives the app password or provider token.</p>
              {!connectedApps && <small>Connected apps need an online Studi account.</small>}
              {connectedApps && !connectedApps.configured && <small>Connected apps are not configured on this Studi server.</small>}
              <div className="connected-app-grid">
                {connectedApps?.toolkits.map(({ toolkit, access, tools }) => {
                  const connection = appConnections[toolkit] ?? null;
                  const active = connectedAppIsActive(connection);
                  const app = connectedAppCatalogEntry(toolkit);
                  return (
                    <div className="connected-app-row" key={toolkit} data-connected-app={toolkit}>
                      <img className="connected-app-logo" src={app.logoUrl} alt="" loading="lazy" />
                      <span>
                        <strong>{app.label}</strong>
                        <small>{app.description}</small>
                        <small>{active ? "Connected" : connection?.status === "INITIATED" ? "Waiting for browser sign-in" : "Not connected"} · {access === "all" ? "all actions" : `${tools?.length ?? 0} approved actions`}</small>
                      </span>
                      <button className="quiet-button" type="button" disabled={busy !== null} onClick={() => active ? onRefreshConnectedApp(toolkit) : connection?.status === "INITIATED" ? onRefreshConnectedApp(toolkit) : onConnectApp(toolkit)}>
                        {active ? "Check" : connection?.status === "INITIATED" ? "I finished" : "Connect"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </PaperCard>
            <PaperCard className="settings-card">
              <p className="eyebrow">Homework folder</p>
              <h2>The folder I may use</h2>
              <p>I can list, read, and write only inside the folder you choose. Shell commands stay unavailable because Studi does not yet have a proven Windows sandbox.</p>
              <small data-homework-root>{preferences?.homeworkRoot ?? "No folder selected"}</small>
              <button className="button button--mint" type="button" disabled={busy !== null} onClick={onSelectHomeworkRoot}>Choose folder</button>
            </PaperCard>
          </div>
        )}

        {section === "school" && (
          <div className="settings-stack">
            <PaperCard className="settings-card">
              <p className="eyebrow">Look schedule</p>
              <h2>When I check school</h2>
              <div className="form-grid form-grid--two">
                <Field label="How often"><select value={cadence} onChange={(event) => setCadence(event.target.value as typeof cadence)}><option value="manual">Only when I ask</option><option value="daily">Every day</option><option value="weekly">Every week</option></select></Field>
                <Field label="Local time"><input type="time" value={localTime} onChange={(event) => setLocalTime(event.target.value)} /></Field>
                {cadence === "weekly" && <Field label="Weekday"><select value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((label, index) => <option value={index} key={label}>{label}</option>)}</select></Field>}
              </div>
              <button className="button button--mint" disabled={busy !== null} onClick={() => onSchedule(cadence, localTime, cadence === "weekly" ? weekday : undefined)}>Save schedule</button>
              {schedule && <small>Next look: {schedule.nextRunAt ? formatDateTime(schedule.nextRunAt) : "only when you ask"}</small>}
            </PaperCard>
            <PaperCard className="settings-card">
              <p className="eyebrow">What I may try</p>
              <h2>Homework rules</h2>
              <form className="rule-form rule-form--stack" onSubmit={saveRule}>
                <Field label="For"><select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="global">Everything</option><option value="course">A class</option><option value="pattern">A pattern</option><option value="assignment">One assignment</option></select></Field>
                {(scope === "course" || scope === "pattern") && <Field label="Class"><select value={courseId} onChange={(event) => setCourseId(event.target.value)}>{onboarding.courses.map((course) => <option key={course.courseId} value={course.courseId}>{course.label}</option>)}</select></Field>}
                {scope === "assignment" && <Field label="Assignment"><select value={assignmentId} onChange={(event) => setAssignmentId(event.target.value)}>{onboarding.assignments.map((assignment) => <option key={assignment.assignmentId} value={assignment.assignmentId}>{assignment.title}</option>)}</select></Field>}
                {scope === "pattern" && <Field label="Pattern"><input value={patternId} onChange={(event) => setPatternId(event.target.value)} placeholder="weekly-problem-set" /></Field>}
                <Field label="I may"><select value={mode} onChange={(event) => setMode(event.target.value as PermissionMode)}><option value="do_not_attempt">Don’t try it</option><option value="attempt">Try it, don’t submit</option><option value="auto_submit">Submit if that’s allowed</option></select></Field>
                <button className="button button--coral" disabled={busy !== null}>Add rule</button>
              </form>
              <div className="rules-list">
                {settings?.permissionRules.map((rule) => (
                  <div key={rule.ruleId}>
                    <span>
                      <strong>{ruleScopeLabel(rule, onboarding)}</strong>
                      <small>{ruleModeLabel(rule.mode)}</small>
                    </span>
                    <button className="quiet-button" onClick={() => onDeleteRule(rule.ruleId)}>Remove</button>
                  </div>
                ))}
                {(settings?.permissionRules.length ?? 0) === 0 && <small>No rules yet. I won’t start homework without one.</small>}
              </div>
            </PaperCard>
          </div>
        )}

        {section === "you" && (
          <div className="settings-stack">
            <UsageCard entitlement={entitlement} usage={usage} />
            <NotificationSettings preferences={preferences?.notifications} busy={busy !== null} onSave={onSaveNotifications} onPreview={onTestNotification} />
            <TelemetryControls telemetry={telemetry} busy={busy === "telemetry"} onChange={onTelemetry} onDebug={onTelemetryDebug} />
            <PaperCard className="settings-card">
              <p className="eyebrow">If something broke</p>
              <h2>Safe diagnostics</h2>
              <p>Saves a short JSON file with versions and recent product events. Secrets stay out. It never copies your school folder.</p>
              <button className="button button--lavender" onClick={onExportDiagnostics} disabled={busy !== null}>{busy === "diagnostics" ? "Preparing…" : "Export diagnostics"}</button>
              {diagnosticsReceipt?.status === "saved" && <small>Saved {diagnosticsReceipt.fileName}</small>}
              {diagnosticsReceipt?.status === "cancelled" && <small>Nothing was written.</small>}
              <small>Studi {runtime?.app ?? "—"}</small>
            </PaperCard>
            <PaperCard className="settings-card" id="feedback-settings">
              <p className="eyebrow">A note for us</p>
              <h2>Something look wrong?</h2>
              <form className="settings-note" onSubmit={(event) => { event.preventDefault(); if (!note.trim()) return; onFeedback("settings", note.trim()); setNote(""); }}>
                <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="Tell Studi what to fix" />
                <button className="button button--yellow" disabled={!note.trim() || busy !== null}>Send note</button>
              </form>
            </PaperCard>
            <PaperCard className="settings-card">
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

function ruleModeLabel(mode: PermissionMode): string {
  if (mode === "do_not_attempt") return "don’t try";
  if (mode === "auto_submit") return "try and submit";
  return "try, don’t submit";
}

function ruleScopeLabel(rule: PermissionRule, onboarding: SchoolOnboardingState): string {
  if (rule.scope === "global") return "Everything";
  if (rule.scope === "course") return courseLabel(onboarding, rule.courseId);
  if (rule.scope === "pattern") return `${courseLabel(onboarding, rule.courseId)} · ${rule.patternId}`;
  return onboarding.assignments.find((assignment) => assignment.assignmentId === rule.assignmentId)?.title ?? "One assignment";
}

function courseLabel(onboarding: SchoolOnboardingState, courseId: string): string { return onboarding.courses.find((course) => course.courseId === courseId)?.label ?? courseId; }
function courseTone(course: string): number { return [...course].reduce((total, character) => total + character.charCodeAt(0), 0) % 6; }
function localDateKey(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function fiveDays(): Array<{ key: string; label: string; date: string }> { const formatter = new Intl.DateTimeFormat(undefined, { weekday: "long" }); const dateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }); const start = new Date(); start.setHours(0, 0, 0, 0); return Array.from({ length: 5 }, (_, offset) => { const date = new Date(start); date.setDate(start.getDate() + offset); return { key: localDateKey(date), label: offset === 0 ? "Today" : formatter.format(date), date: dateFormatter.format(date) }; }); }
