import "./settings.css";
import { SettingsGroup, SettingsRow, SettingsToggle, SavedNotice } from "./SettingsPrimitives.js";
import { connectedAppIsActive } from "../../shared/index.js";
import type { TimelineContext } from "../../shared/conversation-timeline.js";
import { MemorySettings } from "./MemorySettings.js";
import { HomeworkRules } from "./HomeworkRules.js";
import { FeedbackSettings } from "./FeedbackSettings.js";
import { ConnectedAppRow } from "./ConnectedAppRow.js";
import type { ConnectionFeedbackMap } from "./useConnectedApps.js";
import { ChatWorkspace, type ChatView } from "./ChatWorkspace.js";
import { HomeworkHome } from "./HomeworkHome.js";
import type { Assignment } from "../../shared/index.js";
import { Icon } from "./Icon.js";
import { SettingsNavigation, settingsTab, type SettingsSectionId } from "./SettingsNavigation.js";
import {
  useEffect,
  useRef,
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
  type TelemetryState,
  type UsageState,
  AGENT_PROVIDERS,
  defaultModelFor,
  providerLoginActive,
  selectedProvider,
  type AgentProviderEntry,
  type AgentProviderId,
  type ProviderStatus,
} from "../../shared/index.js";
import { deskDotState, type DeskPanel } from "./DeskScreen.js";
import { readDevPreviewConfig } from "./devPreview.js";
import {
  AppChrome,
  type AppScreen,
  type SettingsLanding,
  ProviderLoginHandoffView,
  RuntimeAttentionBanner,
  formatDateTime,
} from "./Ui.js";

type SaveRuleInput = Parameters<StudiRendererApi["savePermissionRule"]>[0];

export interface ChromeProps {
  onOpenContext: (context: TimelineContext) => void;
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
  settings,
  onRefresh,
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
  onCheckAssignment,
  onStopAndScan,
  onConnectRuntime,
  onCompleteRuntimeLogin,
  onCancelRuntimeLogin,
  onSwitchProvider,
  onFeedback,
  onSchoolSlot,
}: {
  settings: ProductSettingsState | null;
  onRefresh: () => Promise<void>;
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
  onCheckAssignment: (assignmentId: string) => void;
  onStopAndScan: (taskId: string) => void;
  onConnectRuntime: () => void;
  onCompleteRuntimeLogin: (code: string) => void;
  onCancelRuntimeLogin: () => void;
  onSwitchProvider: () => void;
  onFeedback: (context: string, message: string) => Promise<boolean>;
  onSchoolSlot: (bounds: SchoolPageBounds | null) => void;
}) {
  const [chatView, setChatView] = useState<ChatView>(() =>
    readDevPreviewConfig()?.id.startsWith("chat-") ? "expanded" : "home",
  );
  const [schoolOpen, setSchoolOpen] = useState(false);
  const [askedAssignment, setAskedAssignment] = useState<Assignment | null>(null);
  useEffect(() => {
    if (panel.kind !== "closed") { setSchoolOpen(panel.kind === "school"); setChatView("expanded"); }
  }, [panel]);
  const taskByAssignment = new Map(
    (library?.tasks ?? []).map((item) => [item.assignment.assignmentId, item]),
  );
  const scan = onboarding.scan;
  const runtimeAttention = classifyAgentRuntimeAttention(
    workspace ? selectedProvider(workspace) : null,
    scan?.state === "failed" ? (scan.failures[0] ?? scan.currentStep) : null,
  );
  const inkyState = deskDotState({
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
        className="app-shell chat-dashboard redesign"
      data-studi-app-ready="true"
    >
      <AppChrome
        {...chrome}
        schoolStatus={onboarding.scan?.state === "running" ? "Checking school now" : onboarding.scan?.state === "needs_user" ? "School needs sign-in" : "School check"}
        onSchool={() => { setSchoolOpen(true); setChatView("expanded"); }}
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
        <HomeworkHome onboarding={onboarding} lifecycle={lifecycle} library={library} settings={settings} onOpen={onAssignment} onStart={onStart} onAsk={assignment => { setAskedAssignment(assignment); setChatView("compact"); }} onSchool={() => { setSchoolOpen(true); setChatView("expanded"); }} onRefresh={onRefresh} onSettings={() => chrome.onNavigate("settings", "rules")} />
        <RuntimeAttentionBanner attention={runtimeAttention} workspace={workspace} busy={busy !== null} onConnect={onConnectRuntime} onCompleteLogin={onCompleteRuntimeLogin} onCancelLogin={onCancelRuntimeLogin} onSwitchProvider={onSwitchProvider} />
        {error && panel.kind === "closed" && <p className="error-note" role="alert">{error}</p>}
      </div>
      <ChatWorkspace
        onOpenContext={chrome.onOpenContext}
        contextAssignment={askedAssignment}
        key={`${chrome.storageKey}:${schoolOpen ? "school" : selectedAssignment?.assignmentId ?? askedAssignment?.assignmentId ?? "home"}`}
        schoolCheck={schoolOpen}
        onAssignment={id => { setSchoolOpen(false); onAssignment(id); }}
        view={chatView === "home" ? "home" : "expanded"}
        onView={view => { setChatView(view); if(view === "home") { onClosePanel(); setSchoolOpen(false); setAskedAssignment(null); } }}
        storageKey={chrome.storageKey ?? chrome.studentName}
        onboarding={onboarding}
        lifecycle={lifecycle}
        workspace={workspace}
        assignment={schoolOpen ? null : selectedAssignment}
        task={schoolOpen ? null : selectedTask}
        mood={inkyState}
        actionError={error}
        onStart={onStart}
        onCheckAssignment={id => { setSchoolOpen(true); setChatView("expanded"); onCheckAssignment(id); }}
        onOpenWork={onOpenDesk}
        onOpenSchoolCheck={() => { onClosePanel(); setSchoolOpen(true); setChatView("expanded"); }}
        onOpenRules={() => chrome.onNavigate("settings", "rules")}
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

const NOTIFICATION_ROWS: ReadonlyArray<{ kind: NotificationKind; label: string; hint: string }> = [
  { kind: "handoff", label: "Dot needs you", hint: "A sign-in, a file, a question, or a heads-up" },
  { kind: "review_ready", label: "Work is ready to look over", hint: "Answers are filled in, waiting for your review" },
  { kind: "work_start", label: "Dot starts an assignment", hint: "So you can watch if you want" },
  { kind: "scan_result", label: "A school check finishes", hint: "See what Dot found at school" },
  { kind: "failure", label: "Something went wrong", hint: "Dot had to stop and saved what it could" },
];

const SOUND_OPTIONS: ReadonlyArray<{ id: NotificationSoundId; label: string }> = [
  { id: "silent", label: "Silent" },
  { id: "os", label: "Windows sound" },
  { id: "inky_nudge", label: "Nudge" },
  { id: "inky_done", label: "Done" },
  { id: "inky_soft", label: "Soft" },
  { id: "inky_uh_oh", label: "Uh-oh" },
];

function NotificationSettings({ preferences, busy, onSave, onPreview }: {
  preferences: NotificationPreferences | undefined; busy: boolean; onSave: (next: NotificationPreferences) => void;
  onPreview: (kind: NotificationKind) => Promise<NotificationTestReceipt | undefined>;
}) {
  const [previewing, setPreviewing] = useState<NotificationKind | null>(null);
  const [notice, setNotice] = useState("");
  if (!preferences) return <p role="status">Notification settings are unavailable.</p>;
  const hours = preferences.quietHours;
  return <>
    <SettingsRow highlight title="Let Dot tap you" description="A small banner and sound, even when Studi is open.">
      <SettingsToggle label="Let Dot tap you" checked={preferences.enabled} disabled={busy} onChange={enabled => onSave({ ...preferences, enabled })} />
    </SettingsRow>
    <SettingsGroup title="Tell me when">
      {NOTIFICATION_ROWS.map(row => {
        const kind = preferences.kinds[row.kind];
        return <div className="st-notification" key={row.kind}>
          <SettingsToggle label={row.label} checked={kind.banner} disabled={busy || !preferences.enabled}
            onChange={banner => onSave({ ...preferences, kinds: { ...preferences.kinds, [row.kind]: { ...kind, banner } } })} />
          <div className="st-copy"><strong>{row.label}</strong><small>{row.hint}</small></div>
          <select aria-label={`Sound for ${row.label}`} value={kind.sound} disabled={busy || !preferences.enabled}
            onChange={event => onSave({ ...preferences, kinds: { ...preferences.kinds, [row.kind]: { ...kind, sound: event.target.value as NotificationSoundId } } })}>
            {SOUND_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <button className="st-play" aria-label={`Preview ${row.label}`} disabled={busy || previewing !== null} onClick={async () => {
            setPreviewing(row.kind); setNotice("");
            try { const receipt = await onPreview(row.kind); if (receipt && !receipt.shown) setNotice("No banner shown. Check quiet hours, these switches, and your system notification settings."); }
            catch { setNotice("The preview could not play. Try again."); }
            finally { setPreviewing(null); }
          }}><Icon name="play" size={14} /></button>
        </div>;
      })}
      {notice && <p className="st-muted" role="status">{notice}</p>}
    </SettingsGroup>
    <SettingsGroup title="Quiet hours">
      <SettingsRow title="Don't tap me at night" description="Dot keeps working. Check your notifications in the morning.">
        <SettingsToggle label="Quiet hours" checked={hours !== "off"} disabled={busy} onChange={enabled => onSave({ ...preferences, quietHours: enabled ? { start: "22:00", end: "08:00" } : "off" })} />
      </SettingsRow>
      {hours !== "off" && <SettingsRow title="From / until" description="Uses this computer's local time.">
        <input type="time" aria-label="Quiet hours start" value={hours.start} disabled={busy}
          onChange={event => { if (event.target.value && event.target.value !== hours.end) onSave({ ...preferences, quietHours: { ...hours, start: event.target.value } }); }} />
        <span>–</span>
        <input type="time" aria-label="Quiet hours end" value={hours.end} disabled={busy}
          onChange={event => { if (event.target.value && event.target.value !== hours.start) onSave({ ...preferences, quietHours: { ...hours, end: event.target.value } }); }} />
      </SettingsRow>}
    </SettingsGroup>
  </>;
}

function UsageCard({ usage }: { entitlement: Entitlement | null; usage: UsageState | null }) {
  const percentage = usage && usage.tokenAllowance > 0 ? Math.round(100 * usage.totalTokens / usage.tokenAllowance) : null;
  return <SettingsGroup title="This month">
    {!usage ? <p className="st-muted">Connect to see your latest usage.</p> : <div className="st-usage">
      <div><strong>{percentage === null ? "Usage unavailable" : `${percentage}% of your monthly usage`}</strong><span>{usage.assignmentsWorked} assignments</span></div>
      <div className="st-meter" role="progressbar" aria-label="Monthly usage" aria-valuenow={Math.min(100, percentage ?? 0)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, percentage ?? 0)}%` }} /></div>
      <small>Tutor-session and school-check counts aren't recorded yet.</small>
    </div>}
  </SettingsGroup>;
}

function SettingsMinutes({ label, value, max, disabled, onChange }: {
  label: string; value: number; max: number; disabled: boolean; onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const valid = Number.isInteger(Number(draft)) && Number(draft) >= 1 && Number(draft) <= max;
  const commit = () => { if (valid && Number(draft) !== value) onChange(Number(draft)); };
  return <div className="st-minutes"><input aria-label={label} type="number" min={1} max={max} value={draft} disabled={disabled}
    aria-invalid={!valid} onChange={event => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === "Enter") commit(); }} /><span>min</span>
    {!valid && <small role="alert">Use 1–{max} minutes.</small>}
  </div>;
}


export function SettingsScreen({
  chrome,
  entitlement,
  studentEmail,
  usage,
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
  onCompleteRuntimeLogin,
  onCancelRuntimeLogin,
  onDisconnectRuntime,
  onConnectApp,
  onRefreshConnectedApp,
  onTelemetry,
  onCheckSchool,
  onOpenSite,
  onExportDiagnostics,
  onSignOut,
  onFeedback,
}: {
  chrome: ChromeProps;
  entitlement: Entitlement | null;
  studentEmail: string | null;
  usage: UsageState | null;
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
  onSavePreferences: (reviewMinutes: number, handoffMinutes: number, memoryVisibility: "none" | "selected" | "all", workStartMode?: "manual" | "automatic") => void;
  onSelectHomeworkRoot: () => void;
  onSaveNotifications: (notifications: NotificationPreferences) => void;
  onTestNotification: (kind: NotificationKind) => Promise<NotificationTestReceipt | undefined>;
  onSaveRule: (input: SaveRuleInput) => void;
  onDeleteRule: (ruleId: string) => void;
  onSchedule: (cadence: "manual" | "daily" | "weekly", localTime: string, weekday?: number) => void;
  onSelectAgentRuntime: (providerId: AgentProviderId, modelId: string, reasoningEffort: AgentReasoningEffort) => void;
  onConnectRuntime: (providerId: AgentProviderId) => void;
  onCompleteRuntimeLogin: (code: string) => void;
  onCancelRuntimeLogin: () => void;
  onDisconnectRuntime: (providerId: AgentProviderId) => void;
  onConnectApp: (toolkit: string) => void;
  onRefreshConnectedApp: (toolkit: string) => void;
  onTelemetry: (enabled: boolean, replayEnabled: boolean) => void;
  onCheckSchool: () => void;
  onOpenSite: (url: string) => void;
  onExportDiagnostics: () => void;
  onSignOut: () => void;
  onFeedback: (context: string, message: string) => Promise<boolean>;
}) {
  const preferences = settings?.preferences;
  const schedule = settings?.schedule;
  const [section, setSection] = useState<SettingsSectionId>(() => settingsTab(chrome.settingsLanding, readDevPreviewConfig()?.settingsSection));
  const [feedbackOpen, setFeedbackOpen] = useState(chrome.settingsLanding === "feedback");
  const [appsOpen, setAppsOpen] = useState(false);
  const [saved, setSaved] = useState(0);
  const [depth, setDepth] = useState(onboarding.profile?.scanDepth ?? "normal");
  const saveDepth = (next: "normal" | "deep") => {
    const profile = onboarding.profile;
    if (!profile || !window.studi) return;
    setDepth(next);
    void window.studi.saveSchoolProfile({ studentName: profile.studentName, schoolRoot: profile.schoolRoot, defaultPermission: profile.defaultPermission,
      scanCadence: profile.scanCadence, ...(profile.schoolTimeZone ? { schoolTimeZone: profile.schoolTimeZone } : {}), scanDepth: next });
  };
  const pendingSave = useRef<string | null>(null);
  const snapshot = JSON.stringify([settings, workspace?.selectedProviderId, workspace?.selectedModelId, workspace?.selectedReasoningEffort, telemetry?.enabled, telemetry?.replayEnabled]);
  useEffect(() => {
    if (busy || pendingSave.current === null) return;
    if (error) { pendingSave.current = null; return; }
    if (pendingSave.current !== snapshot) { pendingSave.current = null; setSaved(value => value + 1); }
  }, [busy, error, snapshot]);
  const save = (action: () => void) => { pendingSave.current = snapshot; action(); };
  const disabled = busy !== null;
  const scan = onboarding.scan;
  const openSchoolCheck = () => chrome.onOpenContext({ kind: "scan", scanId: scan?.scanId ?? "school" });
  const changePreference = (review: number, handoff: number, start = preferences?.workStartMode) => {
    if (preferences) save(() => onSavePreferences(review, handoff, preferences.memoryVisibility, start));
  };
  const host = (url: string) => { try { return new URL(url).hostname; } catch { return url; } };
  return <main className="app-shell st-settings" data-studi-app-ready="true">
    <AppChrome {...chrome} onSchool={openSchoolCheck} />
    <div className="st-page">
      <header className="st-heading"><h1>Settings</h1><SettingsNavigation section={section} onSection={setSection} /></header>
      <div className="st-content" id={`settings-${section}`}>
      {section === "inky" && <>
        <SettingsGroup title="Which AI does the work">
          {!workspace && <p role="status">Your AI connection is unavailable.</p>}
          {workspace && AGENT_PROVIDERS.map(entry => {
            const provider = workspace.providers.find(item => item.providerId === entry.id);
            return provider && <ProviderCard key={entry.id} entry={entry} provider={provider} workspace={workspace} busy={disabled}
              onSelect={() => { const model = defaultModelFor(workspace.models, entry.id); if (model) save(() => onSelectAgentRuntime(entry.id, model.id, workspace.selectedReasoningEffort)); }}
              onConnect={() => onConnectRuntime(entry.id)} onCompleteLogin={onCompleteRuntimeLogin}
              onCancelLogin={onCancelRuntimeLogin} onDisconnect={() => onDisconnectRuntime(entry.id)} />;
          })}
        </SettingsGroup>
        <SettingsGroup title="How Dot thinks">
          <SettingsRow title="Model" description="Choose a model included in your subscription.">
            <select aria-label="Model" value={workspace?.selectedModelId ?? ""} disabled={!workspace || disabled}
              onChange={event => workspace && save(() => onSelectAgentRuntime(workspace.selectedProviderId, event.target.value, workspace.selectedReasoningEffort))}>
              {workspace?.models.filter(model => model.providerId === workspace.selectedProviderId).map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </SettingsRow>
        </SettingsGroup>
        <MemorySettings onboarding={onboarding} />
      </>}
      {section === "homework" && <>
        <HomeworkRules rules={settings?.permissionRules ?? []} onboarding={onboarding} busy={disabled}
          onSaveRule={input => save(() => onSaveRule(input))} onDeleteRule={id => save(() => onDeleteRule(id))}
          onGiveBack={assignmentId => save(() => window.studi!.setAssignmentOwner({ assignmentId, owner: "inky" }))}
          onCheckSchool={onCheckSchool} />
        <SettingsGroup title="Timing and files">
          <SettingsRow title="When Dot starts" description="Only for homework your rules allow.">
            <select aria-label="When Dot starts" disabled={!preferences || disabled} value={preferences?.workStartMode ?? "manual"}
              onChange={event => preferences && changePreference(preferences.reviewMinutes, preferences.handoffMinutes, event.target.value as "manual" | "automatic")}>
              <option value="manual">Only when I ask</option><option value="automatic">Automatically</option>
            </select>
          </SettingsRow>
          <SettingsRow title="Time to look it over" description="Then Dot submits only if your rule allows it.">
            <SettingsMinutes label="Time to look it over (minutes)" value={preferences?.reviewMinutes ?? 30} max={120} disabled={!preferences || disabled}
              onChange={value => preferences && changePreference(value, preferences.handoffMinutes)} />
          </SettingsRow>
          <div id="settings-folder"><SettingsRow title="Homework folder" description={<span data-homework-root>{preferences?.homeworkRoot ?? "No folder selected"}</span>}>
            <button className="st-quiet" disabled={disabled} onClick={() => save(onSelectHomeworkRoot)}>Change</button>
          </SettingsRow></div>
          <details className="st-more-effort"><summary>When Dot needs you</summary>
          <SettingsRow title="Time to wait when Dot needs you" description="Then save your answers and move on.">
            <SettingsMinutes label="Time to wait for you (minutes)" value={preferences?.handoffMinutes ?? 30} max={240} disabled={!preferences || disabled}
              onChange={value => preferences && changePreference(preferences.reviewMinutes, value)} />
          </SettingsRow>
          </details>
        </SettingsGroup>
      </>}
      {section === "school" && <>
        <SettingsGroup title="School checks">
          <SettingsRow highlight title={scan?.completedAt ? `Last checked ${formatDateTime(scan.completedAt)}` : scan?.state === "running" ? "Checking school now" : "Ready to check school"}
            description={scan ? `${onboarding.courses.length} classes · ${scan.changes.filter(change => change.kind === "new").length} new assignments · ${scan.state.replaceAll("_", " ")}` : "Find your classes and upcoming work."}>
            <button className="st-primary" disabled={disabled || scan?.state === "running"} onClick={onCheckSchool}>{scan?.state === "needs_user" ? "Continue check" : "Check now"}</button>
          </SettingsRow>
          {scan?.handoff && <p className="st-muted">{scan.handoff.reason}</p>}
          <SettingsRow title="How deep checks go" description={depth === "deep" ? "As much as possible: every item's instructions, all materials. Uses more of your plan." : "The important things: all your work, each class's syllabus and exams, email."}>
            <div className="st-effort" role="group" aria-label="How deep checks go">
              {(["normal", "deep"] as const).map(value => <button key={value} disabled={disabled || !onboarding.profile}
                aria-pressed={depth === value} onClick={() => saveDepth(value)}>{value === "normal" ? "Normal" : "Deep"}</button>)}
            </div>
          </SettingsRow>
          <SettingsRow title="Check automatically" description="Read-only. Dot never submits or posts during a check.">
            <select aria-label="Check automatically" disabled={disabled} value={schedule?.cadence ?? "manual"}
              onChange={event => save(() => onSchedule(event.target.value as "manual" | "daily" | "weekly", schedule?.localTime ?? "09:00", event.target.value === "weekly" ? schedule?.weekday ?? 1 : undefined))}>
              <option value="manual">When I ask</option><option value="daily">Every day</option><option value="weekly">Every week</option>
            </select>
            {schedule && schedule.cadence !== "manual" && <input aria-label="School check time" type="time" disabled={disabled} value={schedule?.localTime ?? "09:00"}
              onChange={event => event.target.value && save(() => onSchedule(schedule?.cadence ?? "daily", event.target.value, schedule?.cadence === "weekly" ? schedule.weekday ?? 1 : undefined))} />}
          </SettingsRow>
          {schedule?.cadence === "weekly" && <SettingsRow title="Day of the week">
            <select aria-label="Weekday" value={schedule.weekday ?? 1} disabled={disabled} onChange={event => save(() => onSchedule("weekly", schedule.localTime, Number(event.target.value)))}>
              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => <option key={day} value={index}>{day}</option>)}
            </select>
          </SettingsRow>}
        </SettingsGroup>
        <SettingsGroup title="Where Dot looks">
          {onboarding.profile && <SettingsRow title={host(onboarding.profile.schoolRoot)} description="Your school's main site">
            <small>{onboarding.profile.onboardingState === "needs_sign_in" ? "Needs a sign-in" : "Not checked yet"}</small>
            <button className="st-quiet" disabled={disabled} onClick={() => onOpenSite(onboarding.profile!.schoolRoot)}>Open</button>
          </SettingsRow>}
          {onboarding.linkedSystems.map(system => <SettingsRow key={system.linkedSystemId} title={system.label} description={host(system.sourceTarget)}>
            <small className={system.state === "needs_user" ? "st-danger" : "st-verified"}>{system.state === "needs_user" ? "Needs a sign-in" : "Signed in at last check"}</small>
            <button className="st-quiet" disabled={disabled} onClick={() => onOpenSite(system.sourceTarget)}>{system.state === "needs_user" ? "Sign in" : "Open"}</button>
          </SettingsRow>)}
          {!onboarding.profile && <p className="st-muted">No school connected.</p>}
        </SettingsGroup>
        <SettingsGroup title="Connected apps">
          <SettingsRow title={connectedApps?.configured ? `${connectedApps.toolkits.filter(({ toolkit }) => connectedAppIsActive(appConnections[toolkit] ?? null)).length} of ${connectedApps.toolkits.length} apps connected` : "Connected apps unavailable"}
            description="For course emails and files. Studi never sees your passwords.">
            <button className="st-quiet" disabled={!connectedApps?.configured} aria-expanded={appsOpen} onClick={() => setAppsOpen(!appsOpen)}>Manage</button>
          </SettingsRow>
          {appsOpen && connectedApps?.toolkits.map(({ toolkit, access, tools }) => <ConnectedAppRow key={toolkit} toolkit={toolkit} connection={appConnections[toolkit] ?? null}
            feedback={appConnectionFeedback[toolkit]} access={access === "all" ? "all actions" : `${tools?.length ?? 0} approved actions`} disabled={disabled} onConnect={onConnectApp} onCheck={onRefreshConnectedApp} />)}
        </SettingsGroup>
      </>}
      {section === "notifications" && <NotificationSettings preferences={preferences?.notifications} busy={disabled}
        onSave={value => save(() => onSaveNotifications(value))} onPreview={onTestNotification} />}
      {section === "you" && <>
        <div className="st-account st-highlight"><span className="st-avatar">{chrome.studentName.slice(0, 1)}</span>
          <div className="st-copy"><strong>{chrome.studentName}</strong><small>{studentEmail && `${studentEmail} · `}{entitlement?.plan === "supporter" ? "Supporter" : "Private beta"}</small></div>
          <button className="st-quiet" disabled={disabled} onClick={onSignOut}>Sign out</button>
        </div>
        <UsageCard entitlement={entitlement} usage={usage} />
        <SettingsGroup title="Privacy">
          <SettingsRow title="Share product events" description="Beta diagnostics include messages, answers and tool activity. Credentials stay out.">
            <SettingsToggle label="Share product events" checked={telemetry?.enabled ?? false} disabled={!telemetry?.configured || disabled}
              onChange={value => save(() => onTelemetry(value, telemetry?.replayEnabled ?? false))} />
          </SettingsRow>
          <SettingsRow title="Share Studi replay" description="Records the Studi window, not the school page.">
            <SettingsToggle label="Share Studi replay" checked={telemetry?.replayEnabled ?? false} disabled={!telemetry?.configured || !telemetry.enabled || disabled}
              onChange={value => save(() => onTelemetry(telemetry!.enabled, value))} />
          </SettingsRow>
        </SettingsGroup>
        <SettingsGroup title="Help">
          <SettingsRow title="Something confusing or broken?" description={`Studi ${runtime?.app ?? "—"}`}>
            <button className="st-quiet" disabled={disabled} onClick={onExportDiagnostics}>Save a diagnostics file</button>
            <button className="st-outline" aria-expanded={feedbackOpen} onClick={() => setFeedbackOpen(!feedbackOpen)}>Tell us</button>
          </SettingsRow>
          {diagnosticsReceipt && <small role="status">{diagnosticsReceipt.status === "saved" ? `Saved ${diagnosticsReceipt.fileName}` : "Nothing was written."}</small>}
          {feedbackOpen && <FeedbackSettings busy={disabled} onFeedback={onFeedback} />}
        </SettingsGroup>
      </>}
      </div>
      <SavedNotice revision={saved} />
      {error && <p className="st-danger" role="alert">{error}</p>}
    </div>
  </main>;

}


/** One subscription the student can bring: its state, and the one action that makes sense right now. */
function ProviderCard({ entry, provider, workspace, busy, onSelect, onConnect, onCompleteLogin, onCancelLogin, onDisconnect }: {
  entry: AgentProviderEntry;
  provider: ProviderStatus;
  workspace: StudiWorkspaceState;
  busy: boolean;
  onSelect: () => void;
  onConnect: () => void;
  onCompleteLogin: (code: string) => void;
  onCancelLogin: () => void;
  onDisconnect: () => void;
}) {
  const selected = entry.id === workspace.selectedProviderId;
  const ready = provider.state === "ready";
  const login = workspace.providerLogin?.providerId === entry.id ? workspace.providerLogin : null;
  const anyLoginActive = providerLoginActive(workspace.providerLogin);
  const [details, setDetails] = useState(false);
  const description = classifyAgentRuntimeAttention(provider) === "usage" ? "Ran out of usage"
    : ready ? selected ? "Connected · Dot uses this" : "Connected" : provider.state === "needs_login" ? "Not connected" : "Connection unavailable";
  return <div className={`st-provider ${selected && ready ? "st-provider-selected" : ""}`} data-provider={entry.id}>
    <SettingsRow title={entry.id === "anthropic" ? "Claude Pro or Max" : entry.plan} description={description}>
      {ready && !selected && <button className="st-outline" disabled={busy} onClick={onSelect}>Use {entry.name}</button>}
      {ready && <button className="st-quiet" disabled={busy || anyLoginActive} aria-expanded={details} onClick={() => setDetails(!details)}>Switch account</button>}
      {!ready && !login && <button className="st-outline" disabled={busy || anyLoginActive} onClick={onConnect}>Connect {entry.name}</button>}
    </SettingsRow>
    {details && ready && <div className="st-provider-actions"><button className="st-quiet" disabled={busy || anyLoginActive} onClick={onConnect}>Use another account</button><button className="st-text st-danger" disabled={busy || anyLoginActive} onClick={onDisconnect}>Disconnect {entry.name}</button></div>}
    <ProviderLoginHandoffView login={login} busy={busy} onCompleteLogin={onCompleteLogin} onCancelLogin={onCancelLogin} onRetryLogin={onConnect} />
  </div>;
}
