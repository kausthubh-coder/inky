import { HomeworkRules } from "./HomeworkRules.js";
import { FeedbackSettings } from "./FeedbackSettings.js";
import { ScanStatus } from "./ScanStatus.js";
import { ConnectedAppRow } from "./ConnectedAppRow.js";
import type { ConnectionFeedbackMap } from "./useConnectedApps.js";
import { ChatWorkspace, type ChatView } from "./ChatWorkspace.js";
import { Icon } from "./Icon.js";
import { SettingsNavigation, SETTINGS_SECTIONS, matchingSettings, type SettingsSectionId } from "./SettingsNavigation.js";
import { calendarWeek, localDateKey } from "./weekCalendar.js";
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  classifyAgentRuntimeAttention,
  type AgentReasoningEffort,
  type ConnectedAppConnection,
  type ConnectedAppsState,
  type DiagnosticsExportReceipt,
  type Entitlement,
  type LibraryState,
  type LifecycleState,
  type NotificationKind,
  type NotificationIntent,
  type NotificationPreferences,
  type NotificationSoundId,
  type NotificationTestReceipt,
  type ProductSettingsState,
  type RuntimeInfo,
  type SchoolOnboardingState,
  type StudiWorkspaceState,
  type StudiRendererApi,
  type SchoolPageBounds,
  type TaskDetail,
  type TaskSummary,
  type TelemetryState,
  type UsageState,
} from "../../shared/index.js";
import {
  DeskDrawer,
  deskInkyState,
  taskStatusCopy,
  type DeskPanel,
} from "./DeskScreen.js";
import { Inky } from "./Inky.js";
import { readDevPreviewConfig } from "./devPreview.js";
import {
  AppChrome,
  type AppScreen,
  type SettingsLanding,
  Field,
  PaperCard,
  RuntimeAttentionBanner,
  StatusPill,
  TelemetryControls,
  formatDateTime,
} from "./Ui.js";

type SaveRuleInput = Parameters<StudiRendererApi["savePermissionRule"]>[0];

export interface ChromeProps {
  storageKey?: string;
  screen: AppScreen;
  settingsLanding: SettingsLanding;
  studentName: string;
  deskOpen: boolean;
  deskBusy: boolean;
  onNavigate: (screen: AppScreen, landing?: SettingsLanding) => void;
  onOpenDesk: () => void;
  onNotification: (target: NotificationIntent["target"]) => void;
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
  onStopAndScan,
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
  onStopAndScan: (taskId: string) => void;
  onConnectRuntime: () => void;
  onFeedback: (context: string, message: string) => Promise<boolean>;
  onSchoolSlot: (bounds: SchoolPageBounds | null) => void;
}) {
  const [chatView, setChatView] = useState<ChatView>(() =>
    readDevPreviewConfig()?.id.startsWith("chat-") ? "expanded" : "home",
  );
  const [schoolOpen, setSchoolOpen] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [weekOffset, setWeekOffset] = useState(0);
  const [boardView, setBoardView] = useState<"week" | "undated">(() => readDevPreviewConfig()?.id === "week-undated" ? "undated" : "week");
  useEffect(() => {
    const tick = () => setClock(new Date());
    const timer = setInterval(tick, 30_000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, []);
  useEffect(() => {
    if (panel.kind !== "closed") { setSchoolOpen(panel.kind === "school"); setChatView("expanded"); }
  }, [panel]);
  const [feedback, setFeedback] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const verified = onboarding.assignments.filter(
    (assignment) =>
      assignment.lastVerifiedScanId && assignment.evidence.length > 0,
  );
  const taskByAssignment = new Map(
    (library?.tasks ?? []).map((item) => [item.assignment.assignmentId, item]),
  );
  const week = useMemo(
    () => calendarWeek(clock, weekOffset),
    [clock, weekOffset],
  );
  const days = week.days;
  const scan = onboarding.scan;
  const dueToday = verified.filter(
    (assignment) =>
      assignment.dueAt &&
      localDateKey(new Date(assignment.dueAt)) === localDateKey(clock),
  ).length;
  const runtimeAttention = classifyAgentRuntimeAttention(
    workspace?.provider,
    scan?.state === "failed" ? (scan.failures[0] ?? scan.currentStep) : null,
  );
  const inkyState = deskInkyState({
    ...(lifecycle.execution ? { execution: lifecycle.execution } : {}),
    ...(workspace ? { driver: workspace.browser.driver } : {}),
    ...(scan ? { scanState: scan.state } : {}),
    runtimeAttention,
  });
  const selectedAssignment =
    panel.kind === "assignment"
      ? (onboarding.assignments.find(
          (item) => item.assignmentId === panel.assignmentId,
        ) ?? null)
      : panel.kind === "desk"
        ? (onboarding.assignments.find(
            (item) =>
              item.assignmentId ===
              (detail?.assignment.assignmentId ??
                lifecycle.execution?.assignmentId),
          ) ?? null)
        : null;
  const selectedTask = selectedAssignment
    ? (taskByAssignment.get(selectedAssignment.assignmentId) ??
      (detail &&
      detail.assignment.assignmentId === selectedAssignment.assignmentId
        ? detail
        : null))
    : panel.kind === "desk" && detail
      ? detail
      : null;

  return (
    <main
      className="app-shell chat-dashboard"
      data-studi-app-ready="true"
    >
      <AppChrome
        {...chrome}
        chatName={undefined}
        onNavigate={(screen, landing) => {
          if (screen === "week") {
            setChatView("home");
            onClosePanel();
          }
          chrome.onNavigate(screen, landing);
        }}
      />
      <div className="page dashboard-page">
        <header className="page-hero dashboard-hero">
          <h1>Hey {chrome.studentName.trim().split(/\s+/)[0]}.</h1>
          <p>{dueToday ? `${dueToday} ${dueToday === 1 ? "thing" : "things"} due today. We’ll take them one at a time.` : "Nothing due today. A little room to breathe."}</p>
        </header>

        <RuntimeAttentionBanner
          attention={runtimeAttention}
          workspace={workspace}
          busy={busy !== null}
          onConnect={onConnectRuntime}
        />

        <ScanStatus state={onboarding} lifecycle={lifecycle} busy={busy}
          onCheck={onScanAgain} onStopAndScan={onStopAndScan} onOpenWork={onOpenDesk}
          onWait={() => { onClosePanel(); setSchoolOpen(false); setChatView("home"); }}
          onDetails={() => { onClosePanel(); setSchoolOpen(true); setChatView("expanded"); }} />

        <section className="week-section" data-studi-week-board="true">
          {onboarding.courseConflicts?.map(conflict => (
            <div className="week-note" role="status" key={conflict.courseIds.join(",")}>
              <strong>I kept these classes separate: {conflict.courseIds.map(id => courseLabel(onboarding, id)).join(" · ")}.</strong>
              <p>{conflict.reason} Automatic work on these classes is paused.</p>
              {conflict.kind === "permissions" && <button className="quiet-button" onClick={() => chrome.onNavigate("settings", "rules")}>Review homework rules</button>}
            </div>
          ))}
          {onboarding.assignmentConflicts?.map(conflict => (
            <p className="week-note" role="status" key={conflict.assignmentIds.join(",")}>
              I kept separate copies of {onboarding.assignments.find(item => item.assignmentId === conflict.assignmentIds[0])?.title ?? "this homework"}.
              {" "}{conflict.reason} I’ve paused automatic work on these copies.
            </p>
          ))}
          <div className="section-title">
            <div>
              <div className="board-views" aria-label="Assignment views">
                <button aria-pressed={boardView === "week"} onClick={() => setBoardView("week")}>Your week</button>
                <button aria-pressed={boardView === "undated"} onClick={() => setBoardView("undated")}>Without dates <span>{verified.filter(a => !a.dueAt).length}</span></button>
              </div>
            </div>
            <div className="week-tools">
              {boardView === "week" && <div className="week-navigation" aria-label="Week navigation">
              <button className="week-arrow" onClick={() => setWeekOffset(n => n - 1)} aria-label="Previous week"><Icon name="left" /></button>
              <div className="week-range" aria-live="polite"><strong>{week.title}</strong><small>{week.range}</small></div>
              <button className="week-arrow" onClick={() => setWeekOffset(n => n + 1)} aria-label="Next week"><Icon name="right" /></button>
              </div>}
              {boardView === "week" && weekOffset !== 0 && (
                <button
                  className="week-today"
                  onClick={() => setWeekOffset(0)}
                >
                  This week
                </button>
              )}
            </div>
          </div>
          {noteOpen && (
            <form
              className="week-note"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!feedback.trim() || busy !== null) return;
                if (await onFeedback("dashboard", feedback.trim())) {
                  setFeedback("");
                  setNoteOpen(false);
                }
              }}
            >
              <input
                aria-label="Note about your assignments"
                autoFocus
                value={feedback}
                disabled={busy !== null}
                onChange={(event) => setFeedback(event.target.value)}
                placeholder="Which assignment is missing or incorrect?"
                maxLength={1000}
              />
              <button
                className="button button--yellow"
                disabled={!feedback.trim() || busy !== null}
              >
                Send note
              </button>
            </form>
          )}
          {boardView === "week" && <div className="week-grid-scroll"><div className="week-grid">
            {days.map((day, index) => {
              const items = verified.filter(
                (assignment) =>
                  assignment.dueAt &&
                  localDateKey(new Date(assignment.dueAt)) === day.key,
              );
              return (
                <section
                  className={`day-column ${day.isToday ? "is-today" : ""}`}
                  key={day.key}
                >
                  <header>
                    <strong>{day.label}</strong>
                    <small>{day.isToday ? "today" : day.date}</small>
                  </header>
                  <div className="day-stack">
                    {items.length === 0 ? (
                      <p className="empty-day">
                        <span aria-hidden="true">〰</span>Nothing due
                      </p>
                    ) : (
                      items.map((assignment) => {
                        const task = taskByAssignment.get(
                          assignment.assignmentId,
                        );
                        const course = courseLabel(
                          onboarding,
                          assignment.courseId,
                        );
                        const selected =
                          (panel.kind === "assignment" &&
                            panel.assignmentId === assignment.assignmentId) ||
                          (showingLiveDesk &&
                            lifecycle.execution?.assignmentId ===
                              assignment.assignmentId);
                        return (
                          <AssignmentCard
                            key={assignment.assignmentId}
                            assignmentId={assignment.assignmentId}
                            selected={selected}
                            {...(task ? { item: task } : {})}
                            title={assignment.title}
                            {...(assignment.dueAt
                              ? { dueAt: assignment.dueAt }
                              : {})}
                            course={course}
                            tone={courseTone(course)}
                            onAssignment={onAssignment}
                          />
                        );
                      })
                    )}
                  </div>
                </section>
              );
            })}
          </div></div>}
          {boardView === "undated" && (
            <div className="undated-assignments">
              <p>School hasn’t listed a due date for these yet.</p>
              {!verified.some(a => !a.dueAt) && <p className="undated-empty">All caught up — everything has a place in your week.</p>}
              {[...new Set(verified.filter(a => !a.dueAt).map(a => a.courseId))].map(courseId => <section className="undated-course" key={courseId}>
              <h3>{courseLabel(onboarding, courseId)}</h3><div>
                {verified
                  .filter((a) => !a.dueAt && a.courseId === courseId)
                  .map((assignment) => (
                    <AssignmentCard
                      key={assignment.assignmentId}
                      assignmentId={assignment.assignmentId}
                      title={assignment.title}
                      {...(taskByAssignment.get(assignment.assignmentId) ? { item: taskByAssignment.get(assignment.assignmentId)! } : {})}
                      course={courseLabel(onboarding, assignment.courseId)}
                      tone={courseTone(
                        courseLabel(onboarding, assignment.courseId),
                      )}
                      selected={
                        selectedAssignment?.assignmentId ===
                        assignment.assignmentId
                      }
                      onAssignment={onAssignment}
                    />
                  ))}
              </div></section>)}
            </div>
          )}
          {verified.length === 0 && (
            <PaperCard className="empty-state">
              <p className="eyebrow">Nothing here yet</p>
              <h3>I haven’t found homework on the school pages.</h3>
              <p>
                {scan?.state === "succeeded"
                  ? "I looked, and nothing showed up. Check the school page or tell me what I missed."
                  : "Let me look through school first."}
              </p>
            </PaperCard>
          )}
          <footer className="week-footer">
            <button className="scan-refresh" onClick={() => { onClosePanel(); setSchoolOpen(true); setChatView("expanded"); }} aria-label="School check"><Icon name="refresh" size={15} /><span role="status">School scan details</span></button>
            <button className="week-correction" onClick={() => setNoteOpen(open => !open)} aria-expanded={noteOpen}><Icon name="note" size={15} />{noteOpen ? "Close note" : "Report missing or incorrect homework"}</button>
          </footer>
        </section>
        {error && panel.kind === "closed" && (
          <p className="error-note" role="alert">
            {error}
          </p>
        )}
      </div>
      <ChatWorkspace
        key={`${chrome.storageKey}:${schoolOpen ? "school" : selectedAssignment?.assignmentId ?? "home"}`}
        schoolCheck={schoolOpen}
        onAssignment={id => { setSchoolOpen(false); onAssignment(id); }}
        view={chatView === "home" ? "home" : "expanded"}
        onView={view => { setChatView(view); if(view === "home") { onClosePanel(); setSchoolOpen(false); } }}
        storageKey={chrome.storageKey ?? chrome.studentName}
        onboarding={onboarding}
        lifecycle={lifecycle}
        workspace={workspace}
        assignment={schoolOpen ? null : selectedAssignment}
        task={schoolOpen ? null : selectedTask}
        mood={inkyState}
        actionError={error}
        onStart={onStart}
        onOpenWork={onOpenDesk}
        onTakeover={onTakeover}
        onResume={onResume}
        onCancel={onCancel}
        onOpenArtifact={onOpenArtifact}
        onVerifySubmission={onVerifySubmission}
        onSchoolSlot={onSchoolSlot}
        onResumeScan={onScanAgain}
        onStopAndScan={onStopAndScan}
        scanBusy={busy}
      />
    </main>
  );
}

function AssignmentCard({ assignmentId, item, title, dueAt, course, tone, selected, onAssignment }: { assignmentId: string; item?: TaskSummary; title: string; dueAt?: string; course: string; tone: number; selected: boolean; onAssignment: (assignmentId: string) => void }) {
  const status = item ? taskStatusCopy(item.task.state) : null;
  return (
    <button className={`assignment-card course-accent-${tone} ${selected ? "is-selected" : ""}`} onClick={() => onAssignment(assignmentId)}>
      <small>{course}</small>
      <strong>{title}</strong>
      {dueAt && <span>{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(dueAt))}</span>}
      {status && <StatusPill tone={status.tone}>{status.label}</StatusPill>}
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
  appConnections, appConnectionFeedback,
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
  appConnections: Readonly<Record<string, ConnectedAppConnection | null>>; appConnectionFeedback: ConnectionFeedbackMap;
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
  onFeedback: (context: string, message: string) => Promise<boolean>;
}) {
  const preferences = settings?.preferences;
  const schedule = settings?.schedule;
  const [section, setSection] = useState<SettingsSectionId>(() => chrome.settingsLanding === "usage" ? "usage" : chrome.settingsLanding === "feedback" ? "support" : chrome.settingsLanding === "rules" ? "rules" : readDevPreviewConfig()?.settingsSection ?? initialSection);
  const [query, setQuery] = useState("");
  const matches = matchingSettings(query);
  const visible = (id: SettingsSectionId) => query.trim() ? matches.includes(id) : section === id;
  const currentSection = SETTINGS_SECTIONS.find(item => item.id === section)!;
  const [review, setReview] = useState(15);
  const [handoff, setHandoff] = useState(30);
  const [memory, setMemory] = useState<"none" | "selected" | "all">("selected");
  const [cadence, setCadence] = useState<"manual" | "daily" | "weekly">("daily");
  const [localTime, setLocalTime] = useState("09:00");
  const [weekday, setWeekday] = useState(1);
  useEffect(() => { if (preferences) { setReview(preferences.reviewMinutes); setHandoff(preferences.handoffMinutes); setMemory(preferences.memoryVisibility); } }, [preferences]);
  useEffect(() => { if (schedule) { setCadence(schedule.cadence); setLocalTime(schedule.localTime); setWeekday(schedule.weekday ?? 1); } }, [schedule]);
  useEffect(() => {
    const targetId = chrome.settingsLanding === "usage" ? "usage-settings" : chrome.settingsLanding === "feedback" ? "feedback-settings" : null;
    if (!targetId) return undefined;
    const frame = window.requestAnimationFrame(() => document.getElementById(targetId)?.scrollIntoView({ block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [chrome.settingsLanding]);
  const validPreferences = Number.isInteger(review) && review >= 1 && review <= 120 && Number.isInteger(handoff) && handoff >= 1 && handoff <= 240;

  return (
    <main className="app-shell" data-studi-app-ready="true">
      <AppChrome {...chrome} />
      <div className="page settings-page">
        <SettingsNavigation section={section} query={query} onQuery={setQuery} onSection={setSection} />
        <div className="settings-content">
          <header className="settings-heading">
            <div><p className="eyebrow">{query.trim() ? "Find your setting" : currentSection.group}</p><h2>{query.trim() ? "Search results" : currentSection.label}</h2><p>{query.trim() ? `${matches.length} ${matches.length === 1 ? "section" : "sections"} matching “${query.trim()}”` : currentSection.hint}</p></div>
            <Inky state="idle" size={58} label="Inky" />
          </header>
          {query.trim() && matches.length === 0 && <div className="settings-no-results"><h3>No settings found.</h3><p>Try “sound”, “model”, or “school”.</p><button className="button" onClick={() => setQuery("")}>Clear search</button></div>}
            {visible("inky") && (
            <PaperCard className="settings-card">
              <p className="eyebrow">How I think</p>
              <h2>{workspace?.provider.providerName ?? "ChatGPT"}</h2>
              <p>{workspace?.provider.reason}</p>
              <RuntimeAttentionBanner attention={classifyAgentRuntimeAttention(workspace?.provider)} workspace={workspace} busy={busy !== null} onConnect={onConnectRuntime} />
              <button className="button button--yellow" type="button" onClick={onConnectRuntime} disabled={busy !== null}>{workspace?.provider.state === "ready" ? "Use another ChatGPT" : "Connect ChatGPT"}</button>
              <div className="form-grid form-grid--two">
                <Field label="Model"><select value={workspace?.selectedModelId ?? ""} onChange={(event) => onSelectAgentRuntime(event.target.value, workspace?.selectedReasoningEffort ?? "medium")} disabled={!workspace || busy !== null}>{workspace?.models.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</select></Field>
                <Field label="How hard I think"><select value={workspace?.selectedReasoningEffort ?? "medium"} onChange={(event) => workspace && onSelectAgentRuntime(workspace.selectedModelId, event.target.value as AgentReasoningEffort)} disabled={!workspace || busy !== null}><option value="off">Off</option><option value="minimal">Minimal</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="xhigh">Extra high</option></select></Field>
              </div>
              <small>New chats use the pair you save here.</small>
            </PaperCard>
            )}
            {visible("preferences") && (
            <PaperCard className="settings-card">
              <p className="eyebrow">When I finish</p>
              <h2>Your look, then I wait</h2>
              <div className="form-grid form-grid--two">
                <Field label="Minutes to look over answers"><input type="number" min={1} max={120} value={review} onChange={(event) => setReview(Number(event.target.value))} /></Field>
                <Field label="Minutes I wait on the page"><input type="number" min={1} max={240} value={handoff} onChange={(event) => setHandoff(Number(event.target.value))} /></Field>
                <Field label="What I may remember"><select value={memory} onChange={(event) => setMemory(event.target.value as typeof memory)}><option value="none">Nothing</option><option value="selected">Things you pick</option><option value="all">Everything saved</option></select></Field>
              </div>
              <button className="button button--yellow" disabled={busy !== null || !validPreferences} onClick={() => onSavePreferences(review, handoff, memory)}>Save</button>
              {!validPreferences && <small role="status">Choose 1–120 minutes for review and 1–240 minutes to wait.</small>}
            </PaperCard>
            )}
            {visible("apps") && (
            <PaperCard className="settings-card">
              <p className="eyebrow">Connected apps</p>
              <h2>Tools I can use</h2>
              <p>Connections happen in your browser. Studi never receives the app password or provider token.</p>
              {!connectedApps && <small>Connected apps need an online Studi account.</small>}
              {connectedApps && !connectedApps.configured && <small>Connected apps are not configured on this Studi server.</small>}
              <div className="connected-app-grid">
                {connectedApps?.configured && connectedApps.toolkits.map(({ toolkit, access, tools }) => (
                  <ConnectedAppRow key={toolkit} toolkit={toolkit} connection={appConnections[toolkit] ?? null} feedback={appConnectionFeedback[toolkit]} access={access === "all" ? "all actions" : `${tools?.length ?? 0} approved actions`} disabled={busy !== null} onConnect={onConnectApp} onCheck={onRefreshConnectedApp} />
                ))}
              </div>
            </PaperCard>
            )}
            {visible("folder") && (
            <PaperCard className="settings-card">
              <p className="eyebrow">Homework folder</p>
              <h2>The folder I may use</h2>
              <p>Choose a folder just for Studi. I’ll organize your classes and keep each assignment’s files and saved answers together.</p>
              <small data-homework-root>{preferences?.homeworkRoot ?? "No folder selected"}</small>
              <button className="button button--mint" type="button" disabled={busy !== null} onClick={onSelectHomeworkRoot}>Choose an empty folder</button>
            </PaperCard>
            )}

            {visible("school") && (
            <PaperCard className="settings-card">
              <p className="eyebrow">Look schedule</p>
              <h2>When I check school</h2>
              <div className="form-grid form-grid--two">
                <Field label="How often"><select value={cadence} onChange={(event) => setCadence(event.target.value as typeof cadence)}><option value="manual">Only when I ask</option><option value="daily">Every day</option><option value="weekly">Every week</option></select></Field>
                {cadence !== "manual" && <Field label="Local time"><input type="time" value={localTime} onChange={(event) => setLocalTime(event.target.value)} /></Field>}
                {cadence === "weekly" && <Field label="Weekday"><select value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((label, index) => <option value={index} key={label}>{label}</option>)}</select></Field>}
              </div>
              <button className="button button--mint" disabled={busy !== null || (cadence !== "manual" && !localTime)} onClick={() => onSchedule(cadence, localTime || "09:00", cadence === "weekly" ? weekday : undefined)}>Save schedule</button>
              {schedule && <small>Next look: {schedule.nextRunAt ? formatDateTime(schedule.nextRunAt) : "only when you ask"}</small>}
            </PaperCard>
            )}
            {visible("rules") && <HomeworkRules rules={settings?.permissionRules ?? []} onboarding={onboarding} busy={busy !== null} onSaveRule={onSaveRule} onDeleteRule={onDeleteRule} />}

            {visible("usage") && <UsageCard entitlement={entitlement} usage={usage} />}
            {visible("notifications") && <NotificationSettings preferences={preferences?.notifications} busy={busy !== null} onSave={onSaveNotifications} onPreview={onTestNotification} />}
            {visible("privacy") && <TelemetryControls telemetry={telemetry} busy={busy === "telemetry"} onChange={onTelemetry} onDebug={onTelemetryDebug} />}
            {visible("support") && (
            <PaperCard className="settings-card">
              <p className="eyebrow">If something broke</p>
              <h2>Safe diagnostics</h2>
              <p>Saves a short JSON file with versions and recent product events. Secrets stay out. It never copies your school folder.</p>
              <button className="button button--lavender" onClick={onExportDiagnostics} disabled={busy !== null}>{busy === "diagnostics" ? "Preparing…" : "Export diagnostics"}</button>
              {diagnosticsReceipt?.status === "saved" && <small>Saved {diagnosticsReceipt.fileName}</small>}
              {diagnosticsReceipt?.status === "cancelled" && <small>Nothing was written.</small>}
              <small>Studi {runtime?.app ?? "—"}</small>
            </PaperCard>
            )}
            {visible("support") && <FeedbackSettings busy={busy !== null} onFeedback={onFeedback} />}
            {visible("account") && (
            <PaperCard className="settings-card">
              <p className="eyebrow">Signed in</p>
              <h2>{chrome.studentName}</h2>
              <p>Signing out leaves your school pages and saved work on this laptop.</p>
              <button className="button button--coral" onClick={onSignOut} disabled={busy !== null}>Sign out</button>
            </PaperCard>
            )}
        </div>
        {error && <p className="error-note" role="alert">{error}</p>}
      </div>
    </main>
  );
}

function courseLabel(onboarding: SchoolOnboardingState, courseId: string): string { return onboarding.courses.find((course) => course.courseId === courseId)?.label ?? courseId; }
function courseTone(course: string): number { return [...course].reduce((total, character) => total + character.charCodeAt(0), 0) % 6; }
