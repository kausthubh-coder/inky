import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { hasCompletedSchoolOnboarding, isLivePhase, nextSchoolScanAction, type AgentReasoningEffort, type AuthState, type DiagnosticsExportReceipt, type LibraryState, type LifecycleState, type NotificationKind, type NotificationPreferences, type NotificationTestReceipt, type PermissionMode, type ProductSettingsState, type RuntimeInfo, type SchoolOnboardingState, type SchoolPageBounds, type StudiWorkspaceState, type TaskDetail, type TelemetryState } from "../../shared/index.js";import { rendererTelemetry } from "../telemetry/renderer.js";
import { openAssignmentId, talkKeyForPanel, viewingLiveDesk, type DeskPanel } from "./DeskScreen.js";
import { Inky, type InkyState } from "./Inky.js";
import { OnboardingScreen } from "./OnboardingScreen.js";
import { DashboardScreen, SettingsScreen } from "./WorkspaceScreens.js";
import { type AppScreen } from "./Ui.js";

type BusyAction = "loading" | "auth" | "auth-retry" | "sign-out" | "model" | "profile" | "navigate" | "scan" | "resume" | "replay" | "manager" | "assignment" | "takeover" | "cancel" | "artifact" | "settings" | "feedback" | "telemetry" | "diagnostics" | null;

export function StudiApp() {
  const [auth, setAuth] = useState<AuthState>(window.studi ? { status: "checking" } : { status: "signed_out" });
  const [workspace, setWorkspace] = useState<StudiWorkspaceState | null>(null);
  const [onboarding, setOnboarding] = useState<SchoolOnboardingState | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleState | null>(null);
  const [settings, setSettings] = useState<ProductSettingsState | null>(null);
  const [library, setLibrary] = useState<LibraryState | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [screen, setScreen] = useState<AppScreen>("week");
  const [panel, setPanel] = useState<DeskPanel>({ kind: "closed" });
  const [talk, setTalk] = useState<Record<string, { who: "you" | "inky"; text: string }[]>>({});
  const [schoolSlot, setSchoolSlot] = useState<SchoolPageBounds | null>(null);
  const panelRef = useRef<DeskPanel>(panel);
  const libraryRef = useRef<LibraryState | null>(library);
  panelRef.current = panel;
  libraryRef.current = library;
  const [studentName, setStudentName] = useState("");
  const [schoolUrl, setSchoolUrl] = useState("");
  const [scanCadence, setScanCadence] = useState<"manual" | "daily" | "weekly">("daily");
  const [defaultPermission, setDefaultPermission] = useState<PermissionMode>("do_not_attempt");
  const [managerReply, setManagerReply] = useState("");
  const [gateFeedback, setGateFeedback] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [telemetry, setTelemetry] = useState<TelemetryState | null>(null);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [diagnosticsReceipt, setDiagnosticsReceipt] = useState<DiagnosticsExportReceipt | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOnboardingCompletion, setShowOnboardingCompletion] = useState(false);
  const telemetryView = useRef<string | null>(null);

  const authorized = auth.status === "approved" || auth.status === "offline";
  const onboardingComplete = onboarding ? hasCompletedSchoolOnboarding(onboarding) : false;
  const onboarded = onboardingComplete && !showOnboardingCompletion;
  const execution = lifecycle?.execution;
  const activeExecution = Boolean(execution && isLivePhase(execution.phase));
  const showingLiveDesk = screen === "week" && viewingLiveDesk(panel, execution);
  const openId = openAssignmentId(panel, execution);
  const visibleDetail = detail && openId && detail.assignment.assignmentId === openId ? detail : null;
  const talkKey = talkKeyForPanel(panel, execution);
  const visibleTalk = talkKey ? talk[talkKey] ?? [] : [];

  const refreshProduct = useCallback(async () => {
    const studi = window.studi;
    if (!studi) return;
    const [workspaceState, onboardingState, lifecycleState, settingsState, libraryState, runtimeInfo] = await Promise.all([studi.getWorkspaceState(), studi.getSchoolOnboardingState(), studi.getLifecycleState(), studi.getProductSettings(), studi.getLibraryState(), studi.getRuntimeInfo()]);
    setWorkspace(workspaceState); setOnboarding(onboardingState); setLifecycle(lifecycleState); setSettings(settingsState); setLibrary(libraryState); setRuntime(runtimeInfo);
    if (onboardingState.profile) { setStudentName(onboardingState.profile.studentName); setSchoolUrl(onboardingState.profile.schoolRoot); setScanCadence(onboardingState.profile.scanCadence); setDefaultPermission(onboardingState.profile.defaultPermission); }
    const wantedTaskId = taskIdForPanel(panelRef.current, lifecycleState, libraryState);
    if (wantedTaskId) setDetail(await studi.getTaskDetail({ taskId: wantedTaskId }));
  }, []);

  useEffect(() => {
    if (!window.studi) return;
    let cancelled = false; let timer = 0;
    const read = async () => { try { const state = await window.studi!.getAuthState(); if (cancelled) return; setAuth(state); if (state.status === "checking") timer = window.setTimeout(() => void read(), 250); } catch (cause) { if (!cancelled) setError(formatError(cause)); } };
    void read(); return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);

  useEffect(() => { if (!authorized) return; setBusy("loading"); void refreshProduct().catch((cause) => setError(formatError(cause))).finally(() => setBusy(null)); }, [authorized, refreshProduct]);

  useEffect(() => {
    if (!authorized || onboarding?.profile || studentName.trim()) return;
    if (auth.status === "approved" || auth.status === "offline") {
      setStudentName(auth.user.name?.trim() || auth.user.email?.split("@")[0]?.trim() || "Student");
    }
  }, [auth, authorized, onboarding?.profile, studentName]);

  useEffect(() => {
    const studi = window.studi; if (!studi || !authorized) return;
    const timer = window.setInterval(() => { void Promise.all([studi.getLifecycleState(), studi.getSchoolOnboardingState(), studi.getWorkspaceState()]).then(async ([lifecycleState, onboardingState, workspaceState]) => { setLifecycle(lifecycleState); setOnboarding(onboardingState); setWorkspace(workspaceState); const wantedTaskId = taskIdForPanel(panelRef.current, lifecycleState, libraryRef.current); if (wantedTaskId) setDetail(await studi.getTaskDetail({ taskId: wantedTaskId })); }).catch(() => undefined); }, 900);
    const libraryTimer = window.setInterval(() => void studi.getLibraryState().then(setLibrary).catch(() => undefined), 4_000);
    return () => { window.clearInterval(timer); window.clearInterval(libraryTimer); };
  }, [authorized]);

  useEffect(() => {
    const studi = window.studi;
    const phase = workspace?.providerLogin?.phase;
    if (!studi || !authorized || (phase !== "starting" && phase !== "waiting")) return;
    let cancelled = false;
    let timer = 0;
    const refresh = async () => {
      try {
        const state = await studi.getWorkspaceState();
        if (!cancelled) setWorkspace(state);
      } catch { /* The next read can recover a transient provider-status failure. */ }
      if (!cancelled) timer = window.setTimeout(() => void refresh(), 750);
    };
    timer = window.setTimeout(() => void refresh(), 750);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [authorized, workspace?.providerLogin?.phase]);

  const deskOpen = screen === "week" && panel.kind !== "closed";
  const rememberSchoolSlot = useCallback((bounds: SchoolPageBounds | null) => {
    setSchoolSlot((current) => sameBounds(current, bounds) ? current : bounds);
  }, []);
  useEffect(() => {
    const studi = window.studi;
    if (!studi || !authorized) return;
    if (!onboarded) {
      void studi.setBrowserLayout({ mode: onboarding?.profile ? "onboarding" : "hidden" }).catch(() => undefined);
      return;
    }
    if (showingLiveDesk && schoolSlot) {
      void studi.setBrowserLayout({ mode: "desk", bounds: schoolSlot }).catch(() => undefined);
      return;
    }
    void studi.setBrowserLayout({ mode: "hidden" }).catch(() => undefined);
  }, [authorized, onboarded, onboarding?.profile, showingLiveDesk, schoolSlot]);

  useEffect(() => {
    const studi = window.studi; if (!studi) return; let cancelled = false;
    const refresh = async () => { try { const state = await studi.getTelemetryState(); if (cancelled) return; setTelemetry(state); await rendererTelemetry.sync(state); const section = authorized ? "workspace" : "auth_gate"; const key = `${state.distinctId}:${section}:${screen}`; if (telemetryView.current !== key) { telemetryView.current = key; await studi.captureUiTelemetry({ event: "dashboard_viewed", section }); } } catch { /* Telemetry never blocks schoolwork. */ } };
    void refresh(); const timer = window.setInterval(() => void refresh(), 15_000); return () => { cancelled = true; window.clearInterval(timer); };
  }, [authorized, screen]);

  async function action<T>(name: BusyAction, run: () => Promise<T>, apply?: (value: T) => void | Promise<void>): Promise<T | undefined> { setBusy(name); setError(null); try { const value = await run(); await apply?.(value); return value; } catch (cause) { setError(formatError(cause)); return undefined; } finally { setBusy(null); } }

  const signIn = async () => { const studi = window.studi; if (!studi) return; setAuth({ status: "signing_in" }); const next = await action("auth", () => studi.signIn()); if (next) setAuth(next); else setAuth(await studi.getAuthState()); };
  const retryAuth = async () => { const studi = window.studi; if (!studi) return; setAuth({ status: "checking" }); const next = await action("auth-retry", () => studi.retryEntitlement()); if (next) setAuth(next); };
  const signOut = async () => { const studi = window.studi; if (!studi) return; rendererTelemetry.reset(); const next = await action("sign-out", () => studi.signOut()); if (next) { setAuth(next); setWorkspace(null); setOnboarding(null); setLifecycle(null); setSettings(null); setLibrary(null); } };
  const connectRuntime = async () => { const studi = window.studi; if (!studi) return; setError(null); try { setWorkspace(await studi.loginOpenAiCodex()); } catch (cause) { setError(formatError(cause)); } };
  const cancelRuntimeLogin = async () => { const studi = window.studi; if (!studi) return; setError(null); try { setWorkspace(await studi.cancelOpenAiCodexLogin()); } catch (cause) { setError(formatError(cause)); } };
  const selectAgentRuntime = async (modelId: string, reasoningEffort?: AgentReasoningEffort) => { const studi = window.studi; if (!studi) return; const effort = reasoningEffort ?? workspace?.selectedReasoningEffort ?? "high"; await action("model", () => studi.selectAgentModel({ modelId, reasoningEffort: effort }), setWorkspace); };
  const saveProfile = async () => { const studi = window.studi; if (!studi) return; await action("profile", () => studi.saveSchoolProfile({ studentName, schoolRoot: schoolUrl, defaultPermission, scanCadence }), async (state) => { setOnboarding(state); setLifecycle(await studi.getLifecycleState()); setWorkspace(await studi.navigateBrowser({ url: schoolUrl })); }); };
  const openSchool = async () => { const studi = window.studi; if (studi) await action("navigate", () => studi.navigateBrowser({ url: schoolUrl }), setWorkspace); };
  const runScan = async (kind: "scan" | "resume" | "replay") => { const studi = window.studi; if (!studi) return; const command = kind === "scan" ? studi.startSchoolScan : kind === "resume" ? studi.resumeSchoolScan : studi.replaySchoolScan; await action(kind, () => command(), async (state) => { setOnboarding(state); if (hasCompletedSchoolOnboarding(state)) setShowOnboardingCompletion(true); setWorkspace(await studi.getWorkspaceState()); setLibrary(await studi.getLibraryState()); }); };
  const runManager = async (prompt: string, surface: "week" | "desk" = "week") => {
    const studi = window.studi;
    if (!studi) return;
    const result = await action("manager", () => studi.runManager({ prompt, memoryArtifactIds: [] }));
    if (!result) return;
    const text = result.text || `Inky ${result.outcome}.`;
    if (surface === "week") setManagerReply(text);
    setLifecycle((current) => current ? { ...current, manager: result.state } : current);
    setLibrary(await studi.getLibraryState());
    return text;
  };
  const updateLifecycle = async (name: BusyAction, command: () => Promise<LifecycleState>) => {
    const studi = window.studi;
    if (!studi) return;
    const state = await action(name, command);
    if (state) {
      setLifecycle(state);
      const libraryState = await studi.getLibraryState();
      setLibrary(libraryState);
      const wantedTaskId = taskIdForPanel(panelRef.current, state, libraryState);
      if (wantedTaskId) setDetail(await studi.getTaskDetail({ taskId: wantedTaskId }));
    }
    return state;
  };
  const loadTask = async (taskId: string) => { const studi = window.studi; if (!studi) return; const value = await action("loading", () => studi.getTaskDetail({ taskId })); if (value) setDetail(value); };
  const openAssignment = async (assignmentId: string) => {
    setScreen("week");
    setPanel({ kind: "assignment", assignmentId });
    const task = library?.tasks.find((item) => item.assignment.assignmentId === assignmentId);
    if (task) await loadTask(task.task.taskId);
    else setDetail(null);
  };
  const openDesk = async () => {
    setScreen("week");
    setPanel({ kind: "desk" });
    const taskId = lifecycle?.execution?.taskId;
    if (taskId) await loadTask(taskId);
  };
  const openAnswerArtifact = async (taskId: string) => { const studi = window.studi; if (studi) await action("artifact", () => studi.openAnswerArtifact({ taskId })); };
  const savePreferences = async (reviewMinutes: number, handoffMinutes: number, memoryVisibility: "none" | "selected" | "all") => { const studi = window.studi; if (!studi) return; await action("settings", () => studi.saveProductPreferences({ reviewMinutes, handoffMinutes, memoryVisibility }), (preferences) => setSettings((current) => current ? { ...current, preferences } : current)); };
  const saveNotifications = async (notifications: NotificationPreferences) => { const studi = window.studi; if (!studi) return; await action("settings", () => studi.saveNotificationPreferences(notifications), (preferences) => setSettings((current) => current ? { ...current, preferences } : current)); };
  const testNotification = async (kind: NotificationKind): Promise<NotificationTestReceipt | undefined> => {
    const studi = window.studi;
    if (!studi) return undefined;
    const receipt = await action("settings", () => studi.testNotification({ kind }));
    if (receipt) setLifecycle((current) => current ? { ...current, latestNotification: receipt.notification } : current);
    return receipt;
  };
  const saveRule = async (input: Parameters<NonNullable<typeof window.studi>["savePermissionRule"]>[0]) => { const studi = window.studi; if (studi) await action("settings", () => studi.savePermissionRule(input), setSettings); };
  const deleteRule = async (ruleId: string) => { const studi = window.studi; if (studi) await action("settings", () => studi.deletePermissionRule({ ruleId }), setSettings); };
  const configureSchedule = async (cadence: "manual" | "daily" | "weekly", localTime: string, weekday?: number) => { const studi = window.studi; if (!studi) return; await action("settings", () => studi.configureScanSchedule({ cadence, localTime, ...(weekday === undefined ? {} : { weekday }) }), setSettings); setLifecycle(await studi.getLifecycleState()); };
  const updateTelemetry = async (enabled: boolean, replayEnabled: boolean) => { const studi = window.studi; if (!studi) return; if (!enabled) rendererTelemetry.disable(); await action("telemetry", () => studi.setTelemetryPreferences({ enabled, replayEnabled }), async (state) => { setTelemetry(state); await rendererTelemetry.sync(state); }); };
  const updateTelemetryDebug = async (durationMinutes: 0 | 30) => { const studi = window.studi; if (studi) await action("telemetry", () => studi.setTelemetryDebug({ durationMinutes }), setTelemetry); };
  const exportDiagnostics = async () => { const studi = window.studi; if (studi) await action("diagnostics", () => studi.exportDiagnostics(), setDiagnosticsReceipt); };
  const sendFeedback = async (context: string, message: string) => { const studi = window.studi; if (studi) await action("feedback", () => studi.submitFeedback({ message: `[${context}] ${message}` })); };
  const talkAboutAssignment = async (message: string) => {
    const key = talkKey ?? "desk";
    const assignmentId = openId;
    const title = onboarding?.assignments.find((item) => item.assignmentId === assignmentId)?.title ?? assignmentId ?? "the desk";
    setTalk((current) => ({ ...current, [key]: [...(current[key] ?? []), { who: "you", text: message }] }));
    const result = await runManager(assignmentId ? `The student is looking at assignment "${title}" (${assignmentId}). ${message}` : message, "desk");
    if (result) setTalk((current) => ({ ...current, [key]: [...(current[key] ?? []), { who: "inky", text: result }] }));
  };
  const startThisAssignment = async (taskId: string) => {
    const studi = window.studi;
    if (!studi) return;
    const state = await updateLifecycle("assignment", () => studi.startAssignment({ taskId }));
    if (state?.execution?.taskId === taskId && isLivePhase(state.execution.phase)) {
      setPanel({ kind: "desk" });
    }
  };

  useEffect(() => {
    const studi = window.studi;
    if (!studi) return undefined;
    const stopActivated = studi.onLifecycleActivated((target) => {
      setError(null);
      if (target.type === "scan") {
        setScreen("week");
        return;
      }
      if (target.id === "settings-preview") return;
      void Promise.all([
        studi.getLifecycleState(),
        studi.getTaskDetail({ taskId: target.id }),
      ]).then(([lifecycleState, value]) => {
        setLifecycle(lifecycleState);
        setDetail(value);
        setScreen("week");
        const live = lifecycleState.execution;
        const desk = Boolean(live && live.taskId === target.id && isLivePhase(live.phase));
        setPanel(desk ? { kind: "desk" } : { kind: "assignment", assignmentId: value.assignment.assignmentId });
      }).catch((cause) => setError(formatError(cause)));
    });
    const stopSound = studi.onNotificationSound((fileUrl) => {
      const audio = new Audio(fileUrl);
      void audio.play().catch(() => undefined);
    });
    return () => {
      stopActivated();
      stopSound();
    };
  }, []);

  if (!window.studi) return <main className="desktop-required" data-studi-app-ready="true"><p className="eyebrow">Studi desktop</p><h1>Open the desktop app to use the school browser.</h1></main>;
  if (!authorized) return <AuthGate auth={auth} busy={busy} error={error} feedback={gateFeedback} sent={feedbackSent} onFeedback={setGateFeedback} onSignIn={() => void signIn()} onRetry={() => void retryAuth()} onSignOut={() => void signOut()} onSubmit={async (event) => { event.preventDefault(); if (!gateFeedback.trim()) return; await sendFeedback("beta_gate", gateFeedback.trim()); setGateFeedback(""); setFeedbackSent(true); }} />;
  if (!onboarding || !lifecycle) return <main className="loading-screen"><Inky state="sleep" size={132} label="Inky is waking up" /><h1>Opening your desk…</h1>{error && <p className="error-note">{error}</p>}</main>;
  if (!onboarded) return <OnboardingScreen workspace={workspace} onboarding={onboarding} studentName={studentName} schoolUrl={schoolUrl} scanCadence={scanCadence} defaultPermission={defaultPermission} busy={busy} error={error} onStudentName={setStudentName} onSchoolUrl={setSchoolUrl} onCadence={setScanCadence} onDefaultPermission={setDefaultPermission} onConnectRuntime={() => void connectRuntime()} onCancelRuntimeLogin={() => void cancelRuntimeLogin()} onSelectModel={(id) => void selectAgentRuntime(id)} onSaveProfile={() => void saveProfile()} onOpenSchool={() => void openSchool()} onStartScan={() => void runScan("scan")} onResumeScan={() => void runScan("resume")} onReplayScan={() => void runScan("replay")} onFinish={() => setShowOnboardingCompletion(false)} />;
  const chrome = {
    screen,
    studentName: onboarding.profile?.studentName ?? studentName,
    status: onboarding.scan?.state === "partial" ? "partial school view" : "school is local",
    deskOpen,
    deskBusy: activeExecution,
    onNavigate: (next: AppScreen) => {
      setScreen(next);
      setError(null);
      if (next === "settings") setPanel({ kind: "closed" });
    },
    onOpenDesk: () => { void openDesk(); },
  };
  if (screen === "settings") return <SettingsScreen chrome={chrome} settings={settings} onboarding={onboarding} workspace={workspace} telemetry={telemetry} runtime={runtime} diagnosticsReceipt={diagnosticsReceipt} busy={busy} error={error} onSavePreferences={(review, handoff, memory) => void savePreferences(review, handoff, memory)} onSaveNotifications={(notifications) => void saveNotifications(notifications)} onTestNotification={(kind) => testNotification(kind)} onSaveRule={(input) => void saveRule(input)} onDeleteRule={(id) => void deleteRule(id)} onSchedule={(cadence, time, weekday) => void configureSchedule(cadence, time, weekday)} onSelectAgentRuntime={(id, effort) => void selectAgentRuntime(id, effort)} onConnectRuntime={() => void connectRuntime()} onTelemetry={(enabled, replay) => void updateTelemetry(enabled, replay)} onTelemetryDebug={(minutes) => void updateTelemetryDebug(minutes)} onExportDiagnostics={() => void exportDiagnostics()} onSignOut={() => void signOut()} onFeedback={(context, message) => void sendFeedback(context, message)} />;
  return <DashboardScreen chrome={chrome} onboarding={onboarding} workspace={workspace} lifecycle={lifecycle} library={library} detail={visibleDetail} panel={panel} showingLiveDesk={showingLiveDesk} talk={visibleTalk} managerReply={managerReply} busy={busy} error={error} onCommand={(prompt) => void runManager(prompt)} onAssignment={(assignmentId) => void openAssignment(assignmentId)} onOpenDesk={() => void openDesk()} onClosePanel={() => setPanel({ kind: "closed" })} onStart={(taskId) => void startThisAssignment(taskId)} onTalk={(prompt) => void talkAboutAssignment(prompt)} onTakeover={(taskId) => void updateLifecycle("takeover", () => window.studi!.requestAssignmentTakeover({ taskId }))} onResume={(taskId) => void updateLifecycle("assignment", () => window.studi!.resumeAssignment({ taskId }))} onCancel={(taskId) => void updateLifecycle("cancel", () => window.studi!.cancelAssignment({ taskId }))} onVerifySubmission={(taskId, confirmationText) => void updateLifecycle("assignment", () => window.studi!.verifyStudentSubmission({ taskId, confirmationText }))} onOpenArtifact={(taskId) => void openAnswerArtifact(taskId)} onScanAgain={() => void runScan(nextSchoolScanAction(onboarding))} onConnectRuntime={() => void connectRuntime()} onFeedback={(context, message) => void sendFeedback(context, message)} onSchoolSlot={rememberSchoolSlot} />;
}

function AuthGate({ auth, busy, error, feedback, sent, onFeedback, onSignIn, onRetry, onSignOut, onSubmit }: { auth: Exclude<AuthState, { status: "approved" | "offline" }>; busy: BusyAction; error: string | null; feedback: string; sent: boolean; onFeedback: (value: string) => void; onSignIn: () => void; onRetry: () => void; onSignOut: () => void; onSubmit: (event: FormEvent) => void }) {
  const waiting = auth.status === "checking" || auth.status === "signing_in";
  const inkyState: InkyState = auth.status === "denied" || auth.status === "error" ? "needs" : waiting ? "waiting" : "hello";
  const copy = authTalk(auth);
  return (
    <main className="fable-onboarding" {...(waiting ? {} : { "data-studi-app-ready": "true" })}>
      <section className="fable-window" role="application" aria-label="Talking to Inky">
        <div className="fable-stage">
          <section className="fable-talk">
            <div className="fable-inky-wrap"><Inky state={inkyState} size={200} label="Inky" /></div>
            <div className="fable-copy">
              <div className="fable-who">talking to Inky</div>
              <div className="fable-bubbles" aria-live="polite">
                <article className="fable-speech">
                  <span className="fable-tail" aria-hidden="true" />
                  <h1>{copy.title}</h1>
                  <p>{copy.body}</p>
                  {auth.status === "denied" && (
                    <form className="fable-note" onSubmit={onSubmit}>
                      <strong>Want to leave a note?</strong>
                      <label>Note for the beta team<textarea rows={3} value={feedback} onChange={(event) => onFeedback(event.target.value)} maxLength={1000} /></label>
                      <button className="fable-button" disabled={!feedback.trim()}>{sent ? "Sent" : "Send note"}</button>
                    </form>
                  )}
                </article>
              </div>
              <div className="fable-replies">
                {auth.status === "signed_out" && <button className="fable-button primary" onClick={onSignIn} disabled={busy !== null}>{busy === "auth" ? "Opening…" : "Hi Inky"}</button>}
                {auth.status === "signing_in" && <button className="fable-button" onClick={onSignIn} disabled={busy !== null}>Open it again</button>}
                {auth.status === "denied" && <><button className="fable-button primary" onClick={onRetry}>Check again</button><button className="fable-button" onClick={onSignOut}>Use another account</button></>}
                {auth.status === "error" && <button className="fable-button primary" onClick={onRetry}>Try again</button>}
              </div>
              {error && <p className="fable-error" role="alert">{error}</p>}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function authTalk(auth: Exclude<AuthState, { status: "approved" | "offline" }>): { title: string; body: string } {
  if (auth.status === "checking") return { title: "One sec.", body: "Making sure you're in." };
  if (auth.status === "signing_in") return { title: "A page just opened.", body: "Sign in there, then come back." };
  if (auth.status === "denied" && auth.reason === "device_conflict") return { title: "You're already signed in somewhere else.", body: "Studi only works on one laptop at a time." };
  if (auth.status === "denied") return { title: "Not yet.", body: "You're on the waitlist. I'll wait." };
  if (auth.status === "error") return { title: "That didn't work.", body: "Try once more?" };
  return { title: "Hey.", body: "I'm Inky. I'll help with your homework. First, sign into Studi." };
}

function formatError(error: unknown): string { return error instanceof Error ? error.message : "Studi could not finish that action."; }

function taskIdForPanel(
  panel: DeskPanel,
  lifecycle: LifecycleState,
  library: LibraryState | null,
): string | null {
  if (panel.kind === "assignment") {
    return library?.tasks.find((item) => item.assignment.assignmentId === panel.assignmentId)?.task.taskId ?? null;
  }
  if (panel.kind === "desk") return lifecycle.execution?.taskId ?? null;
  return null;
}

function sameBounds(left: SchoolPageBounds | null, right: SchoolPageBounds | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}
