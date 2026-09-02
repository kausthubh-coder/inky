import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { hasCompletedSchoolOnboarding, nextSchoolScanAction, type ArtifactDocument, type AuthState, type DiagnosticsExportReceipt, type LibraryState, type LifecycleState, type PermissionMode, type ProductSettingsState, type RuntimeInfo, type SchoolOnboardingState, type StudiWorkspaceState, type TaskDetail, type TelemetryState } from "../../shared/index.js";
import { rendererTelemetry } from "../telemetry/renderer.js";
import { DeskScreen } from "./DeskScreen.js";
import { Inky, type InkyState } from "./Inky.js";
import { OnboardingScreen } from "./OnboardingScreen.js";
import { DashboardScreen, LibraryScreen, SettingsScreen } from "./WorkspaceScreens.js";
import { type AppScreen, TelemetryControls } from "./Ui.js";

type BusyAction = "loading" | "auth" | "auth-retry" | "sign-out" | "model" | "profile" | "navigate" | "scan" | "resume" | "replay" | "manager" | "assignment" | "takeover" | "cancel" | "artifact" | "settings" | "feedback" | "telemetry" | "diagnostics" | null;

export function StudiApp() {
  const [auth, setAuth] = useState<AuthState>(window.studi ? { status: "checking" } : { status: "signed_out" });
  const [workspace, setWorkspace] = useState<StudiWorkspaceState | null>(null);
  const [onboarding, setOnboarding] = useState<SchoolOnboardingState | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleState | null>(null);
  const [settings, setSettings] = useState<ProductSettingsState | null>(null);
  const [library, setLibrary] = useState<LibraryState | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [artifact, setArtifact] = useState<ArtifactDocument | null>(null);
  const [screen, setScreen] = useState<AppScreen>("week");
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
  const activeExecution = Boolean(execution && ["working", "needs_user", "ready_review", "submitting"].includes(execution.phase));

  const refreshProduct = useCallback(async () => {
    const studi = window.studi;
    if (!studi) return;
    const [workspaceState, onboardingState, lifecycleState, settingsState, libraryState, runtimeInfo] = await Promise.all([studi.getWorkspaceState(), studi.getSchoolOnboardingState(), studi.getLifecycleState(), studi.getProductSettings(), studi.getLibraryState(), studi.getRuntimeInfo()]);
    setWorkspace(workspaceState); setOnboarding(onboardingState); setLifecycle(lifecycleState); setSettings(settingsState); setLibrary(libraryState); setRuntime(runtimeInfo);
    if (onboardingState.profile) { setStudentName(onboardingState.profile.studentName); setSchoolUrl(onboardingState.profile.schoolRoot); setScanCadence(onboardingState.profile.scanCadence); setDefaultPermission(onboardingState.profile.defaultPermission); }
    if (lifecycleState.execution?.taskId) setDetail(await studi.getTaskDetail({ taskId: lifecycleState.execution.taskId }));
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
    const timer = window.setInterval(() => { void Promise.all([studi.getLifecycleState(), studi.getSchoolOnboardingState()]).then(async ([lifecycleState, onboardingState]) => { setLifecycle(lifecycleState); setOnboarding(onboardingState); if (lifecycleState.execution?.taskId) setDetail(await studi.getTaskDetail({ taskId: lifecycleState.execution.taskId })); }).catch(() => undefined); }, 900);
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

  useEffect(() => { const studi = window.studi; if (!studi || !authorized) return; const mode = !onboarded ? (onboarding?.profile ? "onboarding" : "hidden") : activeExecution ? "desk" : "hidden"; void studi.setBrowserLayout({ mode }).catch(() => undefined); }, [authorized, onboarded, onboarding?.profile, activeExecution]);

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
  const selectModel = async (modelId: string) => { const studi = window.studi; if (studi) await action("model", () => studi.selectAgentModel({ modelId }), setWorkspace); };
  const saveProfile = async () => { const studi = window.studi; if (!studi) return; await action("profile", () => studi.saveSchoolProfile({ studentName, schoolRoot: schoolUrl, defaultPermission, scanCadence }), async (state) => { setOnboarding(state); setLifecycle(await studi.getLifecycleState()); setWorkspace(await studi.navigateBrowser({ url: schoolUrl })); }); };
  const openSchool = async () => { const studi = window.studi; if (studi) await action("navigate", () => studi.navigateBrowser({ url: schoolUrl }), setWorkspace); };
  const runScan = async (kind: "scan" | "resume" | "replay") => { const studi = window.studi; if (!studi) return; const command = kind === "scan" ? studi.startSchoolScan : kind === "resume" ? studi.resumeSchoolScan : studi.replaySchoolScan; await action(kind, () => command(), async (state) => { setOnboarding(state); if (hasCompletedSchoolOnboarding(state)) setShowOnboardingCompletion(true); setWorkspace(await studi.getWorkspaceState()); setLibrary(await studi.getLibraryState()); }); };
  const runManager = async (prompt: string) => { const studi = window.studi; if (!studi) return; await action("manager", () => studi.runManager({ prompt, memoryArtifactIds: [] }), async (result) => { setManagerReply(result.text || `Manager ${result.outcome}.`); setLifecycle((current) => current ? { ...current, manager: result.state } : current); setLibrary(await studi.getLibraryState()); }); };
  const updateLifecycle = async (name: BusyAction, command: () => Promise<LifecycleState>) => { const studi = window.studi; if (!studi) return; const state = await action(name, command); if (state) { setLifecycle(state); if (state.execution?.taskId) setDetail(await studi.getTaskDetail({ taskId: state.execution.taskId })); setLibrary(await studi.getLibraryState()); } };
  const chooseTask = async (taskId: string) => { const studi = window.studi; if (!studi) return; setArtifact(null); const value = await action("loading", () => studi.getTaskDetail({ taskId })); if (value) { setDetail(value); setScreen("library"); } };
  const chooseArtifact = async (kind: "preference" | "memory" | "workflow" | "answer", artifactId: string) => { const studi = window.studi; if (!studi) return; setDetail(null); const value = await action("artifact", () => studi.readArtifact({ kind, artifactId })); if (value) setArtifact(value); };
  const openAnswerArtifact = async (taskId: string) => { const studi = window.studi; if (studi) await action("artifact", () => studi.openAnswerArtifact({ taskId })); };
  const savePreferences = async (reviewMinutes: number, handoffMinutes: number, memoryVisibility: "none" | "selected" | "all") => { const studi = window.studi; if (!studi) return; await action("settings", () => studi.saveProductPreferences({ reviewMinutes, handoffMinutes, memoryVisibility }), (preferences) => setSettings((current) => current ? { ...current, preferences } : current)); };
  const saveRule = async (input: Parameters<NonNullable<typeof window.studi>["savePermissionRule"]>[0]) => { const studi = window.studi; if (studi) await action("settings", () => studi.savePermissionRule(input), setSettings); };
  const deleteRule = async (ruleId: string) => { const studi = window.studi; if (studi) await action("settings", () => studi.deletePermissionRule({ ruleId }), setSettings); };
  const configureSchedule = async (cadence: "manual" | "daily" | "weekly", localTime: string, weekday?: number) => { const studi = window.studi; if (!studi) return; await action("settings", () => studi.configureScanSchedule({ cadence, localTime, ...(weekday === undefined ? {} : { weekday }) }), setSettings); setLifecycle(await studi.getLifecycleState()); };
  const updateTelemetry = async (enabled: boolean, replayEnabled: boolean) => { const studi = window.studi; if (!studi) return; if (!enabled) rendererTelemetry.disable(); await action("telemetry", () => studi.setTelemetryPreferences({ enabled, replayEnabled }), async (state) => { setTelemetry(state); await rendererTelemetry.sync(state); }); };
  const updateTelemetryDebug = async (durationMinutes: 0 | 30) => { const studi = window.studi; if (studi) await action("telemetry", () => studi.setTelemetryDebug({ durationMinutes }), setTelemetry); };
  const exportDiagnostics = async () => { const studi = window.studi; if (studi) await action("diagnostics", () => studi.exportDiagnostics(), setDiagnosticsReceipt); };
  const sendFeedback = async (context: string, message: string) => { const studi = window.studi; if (studi) await action("feedback", () => studi.submitFeedback({ message: `[${context}] ${message}` })); };

  if (!window.studi) return <main className="desktop-required" data-studi-app-ready="true"><p className="eyebrow">Studi desktop</p><h1>Open the desktop app to use the school browser.</h1></main>;
  if (!authorized) return <AuthGate auth={auth} busy={busy} error={error} feedback={gateFeedback} sent={feedbackSent} telemetry={telemetry} onFeedback={setGateFeedback} onSignIn={() => void signIn()} onRetry={() => void retryAuth()} onSignOut={() => void signOut()} onSubmit={async (event) => { event.preventDefault(); if (!gateFeedback.trim()) return; await sendFeedback("beta_gate", gateFeedback.trim()); setGateFeedback(""); setFeedbackSent(true); }} onTelemetry={(enabled, replay) => void updateTelemetry(enabled, replay)} onDebug={(minutes) => void updateTelemetryDebug(minutes)} />;
  if (!onboarding || !lifecycle) return <main className="loading-screen"><Inky state="sleep" size={132} label="Inky is waking up" /><h1>Opening your local school desk…</h1>{error && <p className="error-note">{error}</p>}</main>;
  if (!onboarded) return <OnboardingScreen workspace={workspace} onboarding={onboarding} studentName={studentName} schoolUrl={schoolUrl} scanCadence={scanCadence} defaultPermission={defaultPermission} busy={busy} error={error} onStudentName={setStudentName} onSchoolUrl={setSchoolUrl} onCadence={setScanCadence} onDefaultPermission={setDefaultPermission} onConnectRuntime={() => void connectRuntime()} onCancelRuntimeLogin={() => void cancelRuntimeLogin()} onSelectModel={(id) => void selectModel(id)} onSaveProfile={() => void saveProfile()} onOpenSchool={() => void openSchool()} onStartScan={() => void runScan("scan")} onResumeScan={() => void runScan("resume")} onReplayScan={() => void runScan("replay")} onFinish={() => setShowOnboardingCompletion(false)} />;
  if (activeExecution) return <DeskScreen onboarding={onboarding} workspace={workspace} lifecycle={lifecycle} library={library} detail={detail} busy={busy} error={error} onTakeover={(taskId) => void updateLifecycle("takeover", () => window.studi!.requestAssignmentTakeover({ taskId }))} onResume={(taskId) => void updateLifecycle("assignment", () => window.studi!.resumeAssignment({ taskId }))} onCancel={(taskId) => void updateLifecycle("cancel", () => window.studi!.cancelAssignment({ taskId }))} onVerifySubmission={(taskId, confirmationText) => void updateLifecycle("assignment", () => window.studi!.verifyStudentSubmission({ taskId, confirmationText }))} onOpenArtifact={(taskId) => void openAnswerArtifact(taskId)} onBack={() => setScreen("week")} />;

  const chrome = { screen, studentName: onboarding.profile?.studentName ?? studentName, status: onboarding.scan?.state === "partial" ? "partial school view" : "school is local", onNavigate: (next: AppScreen) => { setScreen(next); setError(null); if (next !== "library") { setDetail(null); setArtifact(null); } } };
  if (screen === "library") return <LibraryScreen chrome={chrome} library={library} detail={detail} artifact={artifact} busy={busy} error={error} onTask={(taskId) => void chooseTask(taskId)} onArtifact={(kind, id) => void chooseArtifact(kind, id)} onOpenArtifact={(taskId) => void openAnswerArtifact(taskId)} onFeedback={(context, message) => void sendFeedback(context, message)} />;
  if (screen === "settings") return <SettingsScreen chrome={chrome} settings={settings} onboarding={onboarding} workspace={workspace} telemetry={telemetry} runtime={runtime} diagnosticsReceipt={diagnosticsReceipt} busy={busy} error={error} onSavePreferences={(review, handoff, memory) => void savePreferences(review, handoff, memory)} onSaveRule={(input) => void saveRule(input)} onDeleteRule={(id) => void deleteRule(id)} onSchedule={(cadence, time, weekday) => void configureSchedule(cadence, time, weekday)} onSelectModel={(id) => void selectModel(id)} onTelemetry={(enabled, replay) => void updateTelemetry(enabled, replay)} onTelemetryDebug={(minutes) => void updateTelemetryDebug(minutes)} onExportDiagnostics={() => void exportDiagnostics()} onSignOut={() => void signOut()} />;
  return <DashboardScreen chrome={chrome} onboarding={onboarding} library={library} managerReply={managerReply} busy={busy} error={error} onCommand={(prompt) => void runManager(prompt)} onTask={(taskId) => void chooseTask(taskId)} onStartNext={() => void updateLifecycle("assignment", () => window.studi!.startNextAssignment())} onScanAgain={() => void runScan(nextSchoolScanAction(onboarding))} onFeedback={(context, message) => void sendFeedback(context, message)} />;
}

function AuthGate({ auth, busy, error, feedback, sent, telemetry, onFeedback, onSignIn, onRetry, onSignOut, onSubmit, onTelemetry, onDebug }: { auth: Exclude<AuthState, { status: "approved" | "offline" }>; busy: BusyAction; error: string | null; feedback: string; sent: boolean; telemetry: TelemetryState | null; onFeedback: (value: string) => void; onSignIn: () => void; onRetry: () => void; onSignOut: () => void; onSubmit: (event: FormEvent) => void; onTelemetry: (enabled: boolean, replay: boolean) => void; onDebug: (minutes: 0 | 30) => void }) {
  const waiting = auth.status === "checking" || auth.status === "signing_in";
  const inkyState: InkyState = auth.status === "denied" || auth.status === "error" ? "needs" : waiting ? "waiting" : "hello";
  return <main className="auth-gate" {...(waiting ? {} : { "data-studi-app-ready": "true" })}><section className={`auth-card auth-card--${auth.status}`}><header><Inky state={inkyState} size={94} label="Inky" /><div><p className="eyebrow">Studi private beta</p><h1>School stays on this computer.</h1></div></header>{auth.status === "checking" && <><span className="spinner" /><h2>Checking your beta access</h2><p>Studi verifies the last signed account before any school workflow starts.</p></>}{auth.status === "signing_in" && <><span className="spinner" /><h2>Finish in your browser</h2><p>Clerk sign-in is open in the system browser. Studi continues after the secure callback.</p></>}{auth.status === "signed_out" && <><h2>Hey — I’m Inky.</h2><p>Sign in to set up the school browser. Your school passwords stay inside that browser, never in this chat.</p><button className="button button--yellow" onClick={onSignIn} disabled={busy !== null}>{busy === "auth" ? "Opening browser…" : "Sign in to Studi"}</button></>}{auth.status === "denied" && <><h2>{auth.reason === "device_conflict" ? "Another computer is active" : "You’re on the beta waitlist"}</h2><p>{auth.message}</p><div className="button-row"><button className="button button--mint" onClick={onRetry}>Check access again</button><button className="button button--coral" onClick={onSignOut}>Use another account</button></div><form className="feedback-form" onSubmit={onSubmit}><label className="field"><span>Note for the beta team</span><textarea rows={3} value={feedback} onChange={(event) => onFeedback(event.target.value)} maxLength={1000} /></label><button className="button button--lavender" disabled={!feedback.trim()}>{sent ? "Sent" : "Send note"}</button></form></>}{auth.status === "error" && <><h2>Studi couldn’t verify access</h2><p>{auth.message}</p><button className="button button--yellow" onClick={onRetry}>Retry</button></>}{error && <p className="error-note">{error}</p>}<TelemetryControls telemetry={telemetry} busy={busy === "telemetry"} onChange={onTelemetry} onDebug={onDebug} /><footer>Clerk and Convex receive account access, entitlement, aggregate usage, and feedback only.</footer></section></main>;
}

function formatError(error: unknown): string { return error instanceof Error ? error.message : "Studi could not finish that action."; }
