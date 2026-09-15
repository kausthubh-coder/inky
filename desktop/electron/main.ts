import { windowChromeOptions } from "./window-chrome.js";
import { configureAppNavigation } from "./app-navigation.js";
import { UpdateService } from "./updates/service.js";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  app,
  autoUpdater,
  BrowserWindow,
  dialog,
  Menu,
  Tray,
  WebContentsView,
  ipcMain,
  nativeImage,
  safeStorage,
  session as electronSession,
  shell,
} from "electron";
import squirrelStartup from "electron-squirrel-startup";

import {
  STUDI_SCHEMA_VERSION,
  browserDriver,
  AGENT_PROVIDERS,
  agentProviderName,
  classifyAgentRuntimeAttention,
  type AgentProviderId,
  createIpcHandlerRegistrations,
  projectProtectedAuthState,
  studiIpcMethods,
  studiIpcRegistry,
  type AuthState,
  type LifecycleState,
  type SchoolOnboardingState,
  type StudiIpcHandlers,
  type BrowserLayoutMode,
  type SchoolPageBounds,
  type LibraryState,
  type ProductSettingsState,
  type TaskDetail,
  type AgentReasoningEffort,
  type UsageEventKind,
  type UsageState,
} from "../shared/index.js";
import { getDevelopmentUrl } from "./development-url.js";
import { buildDiagnosticsSnapshot, writeDiagnosticsSnapshot } from "./diagnostics.js";
import { AuthCoordinator } from "./auth/coordinator.js";
import { findDesktopConnectUrl, isDesktopConnectUrl, STUDI_CONNECT_PROTOCOL } from "./auth/desktop-link.js";
import { AuthVault } from "./auth/vault.js";
import { PiAgentRuntime } from "./agent/runtime.js";
import { createConnectedAppTools } from "./agent/composio-tools.js";
import { ConversationCoordinator } from "./agent/conversation-coordinator.js";
import { ProviderLoginAttemptOwner } from "./agent/provider-login.js";
import { AssignmentExecutionCoordinator, type ExecutionNotification } from "./assignment/coordinator.js";
import { startSelectedAssignment } from "./assignment/start-selected.js";
import { BrowserController } from "./browser/controller.js";
import { DriveOverlay, SCHOOL_PANE_RADIUS } from "./browser/drive-overlay.js";
import { VisibleBrowserWork } from "./browser/work-ownership.js";
import { AppKernel } from "./lifecycle/kernel.js";
import { ManagerCoordinator } from "./manager/coordinator.js";
import { SchoolScanCoordinator } from "./scan/coordinator.js";
import { type LocalStore, openLocalStore } from "./storage/index.js";
import { loadTelemetryPublicConfig } from "./telemetry/config.js";
import { TelemetryService } from "./telemetry/service.js";
import { usageProperties, type AgentUsageSnapshot } from "./telemetry/usage.js";
import { initializeHomeworkWorkspace, syncHomeworkClassFolders } from "./files/workspace.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const preloadPath = join(moduleDirectory, "preload.cjs");
const rendererPath = resolve(moduleDirectory, "..", "client", "index.html");
const appIconPath = app.isPackaged
  ? join(process.resourcesPath, "studi-inky.png")
  : resolve(moduleDirectory, "..", "..", "assets", "studi-inky.png");
const trayIconPath = app.isPackaged
  ? join(process.resourcesPath, "studi-inky.ico")
  : resolve(moduleDirectory, "..", "..", "assets", "studi-inky.ico");
const startupProfileConfigured = configureStartupProfile();
// The installed app owns a single-instance lock. Unpackaged development and QA
// runs use isolated profiles and must be able to coexist with that installation.
const ownsSingleInstance = !app.isPackaged || app.requestSingleInstanceLock();
const canStart = startupProfileConfigured && !squirrelStartup && ownsSingleInstance;
let localStore: LocalStore | null = null;
let browserController: BrowserController | null = null;
let browserView: WebContentsView | null = null;
const browserPages = new Map<string, {view:WebContentsView; controller:BrowserController}>();
let selectedBrowserPage = "school";
let browserDriverTimer: ReturnType<typeof setInterval> | null = null;
let driveOverlay: DriveOverlay | null = null;
let browserLayoutMode: BrowserLayoutMode = "hidden";
let deskSlotBounds: SchoolPageBounds | null = null;
let agentRuntime: PiAgentRuntime | null = null;
let runtimeLoginAttempt: ProviderLoginAttemptOwner | null = null;
let managerCoordinator: ManagerCoordinator | null = null;
let conversationCoordinator: ConversationCoordinator | null = null;
let unsubscribeConversationTrace: (() => void) | null = null;
let visibleBrowserWork: VisibleBrowserWork | null = null;
let schoolScanCoordinator: SchoolScanCoordinator | null = null;
let assignmentExecutionCoordinator: AssignmentExecutionCoordinator | null = null;
let appKernel: AppKernel | null = null;
let mainWindow: BrowserWindow | null = null;
let authCoordinator: AuthCoordinator | null = null;
let telemetryService: TelemetryService | null = null;
let gateTray: Tray | null = null;
let gateQuitting = false;
let updateService: UpdateService | null = null;
let pendingDesktopConnect = Boolean(findDesktopConnectUrl(process.argv));
let telemetryShutdownFinished = false;
const pendingNotifications: ExecutionNotification[] = [];
let assignmentRunStartedAt: number | null = null;

function updates(): UpdateService {
  if (!updateService) {
    updateService = new UpdateService({platform:process.platform,arch:process.arch,packaged:app.isPackaged,version:app.getVersion(),firstRun:process.argv.includes('--squirrel-firstrun'),native:autoUpdater,
      blocked: () => {
        if (conversationCoordinator?.isBusy) return 'Finish or stop your reply before restarting.';
        const scan = localStore?.school.latestScan();
        const execution = localStore?.lifecycle.getActiveExecution();
        if (scan?.state === 'running' || scan?.state === 'needs_user') return 'Finish checking your school before restarting.';
        if (execution && ['working','submitting','needs_user','ready_review'].includes(execution.phase)) return 'Finish your current assignment or browser handoff before restarting.';
        return null;
      },
      prepare: async () => {
        // Acquire service gate synchronously, then stop the scheduler before any await.
        appKernel?.prepareUpdate();
        // Drafts are synchronously persisted on each edit. Ask the renderer to verify storage before quitting.
        await mainWindow?.webContents.executeJavaScript('(() => { const event = new Event("studi:before-update", {cancelable:true}); if(!window.dispatchEvent(event))throw new Error("Your draft could not be saved."); })()');
        const block=updates().state().restartBlock;
        if(block)throw new Error(block);
        if (telemetryService) await Promise.race([telemetryService.flush(),new Promise<void>(resolve=>setTimeout(resolve,3000))]);
        telemetryShutdownFinished = true; gateQuitting = true;
      },recover:()=>{gateQuitting=false;telemetryShutdownFinished=false;appKernel?.cancelUpdate();},openDownload: url => shell.openExternal(url),report: error=>telemetryService?.captureError(error,'ipc','ipc_request')});
  }
  return updateService;
}
const ipcHandlers: StudiIpcHandlers = {
  getUpdateState: () => updates().state(),
  checkForUpdates: () => updates().check(),
  installUpdate: () => updates().install(),
  getRuntimeInfo: () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }),
  getAuthState: () => currentAuthState(),
  signIn: async () => {
    const state = await requireAuthCoordinator().signIn();
    observeAuthState(state);
    await synchronizeProtectedRuntime(state);
    return state;
  },
  signOut: async () => {
    disposeProtectedRuntime();
    ensureGateTray();
    const state = await requireAuthCoordinator().signOut();
    observeAuthState(state);
    return state;
  },
  retryEntitlement: async () => {
    const state = await requireAuthCoordinator().retryEntitlement();
    observeAuthState(state);
    await synchronizeProtectedRuntime(state);
    return state;
  },
  submitFeedback: async ({ message }) => {
    const receipt = await requireAuthCoordinator().submitFeedback(message);
    requireTelemetryService().capture("studi_feedback_sent", { channel: "beta_gate" });
    return receipt;
  },
  getUsageState: () => requireAuthCoordinator().usage(),
  getConnectedApps: () => requireAuthCoordinator().connectedApps(),
  connectApp: async ({ toolkit }) => {
    const startedAt = Date.now();
    const connection = await requireAuthCoordinator().authorizeConnectedApp(toolkit);
    if (!connection.redirectUrl) throw new Error(`${toolkit} did not return a connection link`);
    const redirect = new URL(connection.redirectUrl);
    if (redirect.protocol !== "https:") throw new Error(`${toolkit} returned an unsafe connection link`);
    await shell.openExternal(redirect.href);
    requireTelemetryService().capture("studi_connected_app", {
      toolkit,
      operation: "connect",
      status: connection.status,
      ...(connection.connectedAccountId ? { connected_account_id: connection.connectedAccountId } : {}),
      duration_ms: Date.now() - startedAt,
    });
    return connection;
  },
  refreshConnectedApp: async ({ toolkit }) => {
    const startedAt = Date.now();
    const connection = await requireAuthCoordinator().connectedAppConnection(toolkit);
    requireTelemetryService().capture("studi_connected_app", {
      toolkit,
      operation: "refresh",
      status: connection.status,
      ...(connection.connectedAccountId ? { connected_account_id: connection.connectedAccountId } : {}),
      duration_ms: Date.now() - startedAt,
    });
    return connection;
  },
  getWorkspaceState: () => readWorkspaceState(),
  navigateBrowser: async ({ url, target }) => {
    const key = target ? target.kind === "assignment" ? `assignment:${target.assignmentId}` : target.kind : selectedBrowserPage;
    if (target?.kind === "assignment" && !requireLocalStore().assignments.get(target.assignmentId)) throw new Error("That assignment no longer exists");
    if (browserPageBusy(key)) throw new Error("Pause this activity before navigating its page.");
    await schoolBrowserPage(key).controller.navigate(url);
    requireTelemetryService().capture("studi_onboarding_step", { step: "school_browser_opened" });
    return readWorkspaceState();
  },
  loginProvider: async ({ providerId }) => {
    requireRuntimeLoginAttempt().start(providerId);
    return readWorkspaceState();
  },
  completeProviderLogin: async ({ providerId, code }) => {
    requireRuntimeLoginAttempt().complete(providerId, code);
    return readWorkspaceState();
  },
  cancelProviderLogin: async () => {
    requireRuntimeLoginAttempt().cancel();
    return readWorkspaceState();
  },
  logoutProvider: async ({ providerId }) => {
    requireRuntimeLoginAttempt().cancel();
    await requireAgentRuntime().logoutProvider(providerId);
    requireTelemetryService().capture("studi_provider_connection", { provider: providerId, state: "disconnected" });
    return readWorkspaceState();
  },
  selectAgentModel: async ({ providerId, modelId, reasoningEffort }) => {
    const runtime = requireAgentRuntime();
    runtime.selectModel(providerId, modelId);
    runtime.setReasoningEffort(reasoningEffort);
    await persistAgentRuntimeChoice();
    requireTelemetryService().capture("studi_model_selected", { provider: providerId, model: modelId, reasoning_effort: reasoningEffort });
    requireTelemetryService().setPerson({ selected_provider: providerId, selected_model: modelId, selected_reasoning: reasoningEffort });
    await requireConversationCoordinator().replaceSessions();
    return readWorkspaceState();
  },
  getAssignmentFiles: ({assignmentId}) => requireAssignmentExecutionCoordinator().assignmentFiles(assignmentId),
  readAssignmentFile: ({assignmentId,path}) => requireAssignmentExecutionCoordinator().readAssignmentFile(assignmentId,path),
  importAssignmentFiles: async ({assignmentId}) => {
    const coordinator = requireAssignmentExecutionCoordinator();
    await coordinator.assignmentDirectory(assignmentId);
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error("Open Studi before adding files.");
    const result = await dialog.showOpenDialog(mainWindow, { title: "Add files to this assignment", buttonLabel: "Add files", properties: ["openFile", "multiSelections"] });
    const imported: string[] = [];
    const errors: Array<{ name: string; message: string }> = [];
    if (result.canceled) return { imported, errors };
    if (result.filePaths.length > 12) throw new Error("Add up to 12 files at a time.");
    for (const source of result.filePaths) {
      try { imported.push(await coordinator.importAssignmentFile(assignmentId, source)); }
      catch (cause) { errors.push({ name: source.split(/[\\/]/).pop() ?? "File", message: cause instanceof Error ? cause.message : "Couldn’t add this file. Try again." }); }
    }
    return { imported, errors };
  },
  openAssignmentFolder: async ({assignmentId,path}) => {
    if (path) {
      shell.showItemInFolder(await requireAssignmentExecutionCoordinator().revealAssignmentFile(assignmentId, path));
      return true;
    }
    const error = await shell.openPath(await requireAssignmentExecutionCoordinator().assignmentDirectory(assignmentId));
    if(error) throw new Error(error);
    return true;
  },
  selectBrowserPage: async target => {
    const key = target.kind === "assignment" ? `assignment:${target.assignmentId}` : target.kind;
    const assignment = target.kind === "assignment" ? requireLocalStore().assignments.get(target.assignmentId) : null;
    if (target.kind === "assignment" && !assignment) throw new Error("That assignment no longer exists");
    const page = schoolBrowserPage(key);
    selectedBrowserPage = key;
    browserView = page.view;
    browserController = page.controller;
    layoutSchoolBrowser();
    return readWorkspaceState();
  },
  getScopedConversation: target => requireConversationCoordinator().state(target),
  stopScopedConversation: async target => {
    const taskId = target.kind === "assignment" ? requireManagerCoordinator().activeTaskForAssignment(target.assignmentId) : null;
    if (taskId && requireManagerCoordinator().isWorkerRunning) await requireAssignmentExecutionCoordinator().requestTakeover(taskId);
    return requireConversationCoordinator().stop(target);
  },
  sendScanMessage: input => requireSchoolScanCoordinator().sendMessage(input),
  pauseSchoolScan: () => requireSchoolScanCoordinator().requestTakeover(),
  getConversationState: () => requireConversationCoordinator().state(),
  stopConversation: () => requireConversationCoordinator().stop(),
  getNotifications: () => requireLocalStore().lifecycle.listNotifications(),
  readNotification: ({notificationId}) => {
    const store = requireLocalStore(); const note = store.lifecycle.getNotification(notificationId);
    if (note && !note.clickedAt) store.lifecycle.putNotification({...note, clickedAt:new Date().toISOString()});
    return store.lifecycle.listNotifications();
  },
  getManagerState: () => requireManagerCoordinator().state(),
  send: async ({ target, text, ...metadata }) => {
    await requireReadyProvider("Inky can answer");
    const result = await requireConversationCoordinator().send(target, text, metadata);
    return result;
  },
  selectAssignment: ({ assignmentId }) => requireConversationCoordinator().selectAssignment(assignmentId),
  getSchoolOnboardingState: () => requireSchoolScanCoordinator().state(),
  saveSchoolProfile: async (input) => {
    const state = await requireSchoolScanCoordinator().saveProfile(input);
    requireAppKernel().configureSchedule(input.scanCadence);
    requireTelemetryService().capture("studi_onboarding_step", {
      step: "profile_saved",
      cadence: input.scanCadence,
      student_name: input.studentName,
      school_root: input.schoolRoot,
    });
    requireTelemetryService().setPerson({ student_name: input.studentName, school_root: input.schoolRoot });
    return state;
  },
  startSchoolScan: async (input) => {
    await requireReadyProviderForScan();
    return runScanWithTelemetry("start", () => requireSchoolScanCoordinator().startScan(input?.assignmentId));
  },
  resumeSchoolScan: async () => {
    await requireReadyProviderForScan();
    return runScanWithTelemetry("resume", () => requireSchoolScanCoordinator().resume());
  },
  replaySchoolScan: async () => {
    await requireReadyProviderForScan();
    return runScanWithTelemetry("replay", () => requireSchoolScanCoordinator().replay());
  },
  recordMissedCourseFeedback: ({ feedback }) => {
    const state = requireSchoolScanCoordinator().recordMissedCourseFeedback(feedback);
    requireTelemetryService().capture("studi_feedback_sent", { channel: "school_scan" });
    requireTelemetryService().capture("studi_onboarding_step", { step: "feedback_recorded" });
    return state;
  },
  getLifecycleState: () => requireAppKernel().state(),
  setAutomationPaused: ({ paused }) => {
    const state = requireAppKernel().setAutomationPaused(paused);
    captureQueueTransition(paused ? "schedule_pause" : "schedule_resume", state);
    return state;
  },
  startNextAssignment: async () => {
    await requireReadyProviderForScan();
    assignmentRunStartedAt = Date.now();
    await requireAssignmentExecutionCoordinator().startNext();
    const state = requireAppKernel().state();
    captureQueueTransition("assignment_start", state);
    return state;
  },
  startAssignment: async ({ taskId }) => {
    await requireReadyProviderForScan();
    assignmentRunStartedAt = Date.now();
    await startSelectedAssignment(
      requireLocalStore(),
      requireManagerCoordinator(),
      requireAssignmentExecutionCoordinator(),
      taskId,
    );
    const state = requireAppKernel().state();
    captureQueueTransition("assignment_start", state);
    return state;
  },
  resumeAssignment: async ({ taskId }) => {
    await requireReadyProviderForScan();
    assignmentRunStartedAt = Date.now();
    await requireAssignmentExecutionCoordinator().resume(taskId);
    const state = requireAppKernel().state();
    captureQueueTransition("assignment_resume", state);
    return state;
  },
  verifyStudentSubmission: async ({ taskId, confirmationText }) => {
    await requireAssignmentExecutionCoordinator().verifyStudentSubmission(taskId, confirmationText);
    const state = requireAppKernel().state();
    captureQueueTransition("submission_verify", state);
    if (state.execution) captureAssignmentFinished(state.execution.taskId, "submitted");
    return state;
  },
  openAnswerArtifact: async ({ taskId }) => {
    const execution = requireLocalStore().lifecycle.getExecution(taskId);
    if (!execution?.answerArtifactId) throw new Error(`Task ${taskId} has no preserved answer artifact`);
    const result = await shell.openPath(requireLocalStore().artifacts.path("answer", execution.answerArtifactId));
    requireTelemetryService().capture("studi_fallback", { kind: "answer_markdown", task_id: taskId });
    return result === "";
  },
  getProductSettings: () => readProductSettings(),
  saveProductPreferences: async (input) => {
    const current = await requireLocalStore().productPreferences.get();
    const preferences = await requireLocalStore().productPreferences.put({
      ...current,
      schemaVersion: STUDI_SCHEMA_VERSION,
      reviewMinutes: input.reviewMinutes,
      handoffMinutes: input.handoffMinutes,
      memoryVisibility: input.memoryVisibility,
      workStartMode: input.workStartMode ?? current.workStartMode ?? "manual",
      updatedAt: new Date().toISOString(),
    });
    requireAssignmentExecutionCoordinator().configureReviewHandoff(preferences.reviewMinutes, preferences.handoffMinutes);
    requireManagerCoordinator().setWorkStartMode(preferences.workStartMode ?? "manual");
    return preferences;
  },
  selectHomeworkRoot: async () => {
    const current = await requireLocalStore().productPreferences.get();
    const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const result = owner
      ? await dialog.showOpenDialog(owner, { title: "Choose an empty folder just for Studi", buttonLabel: "Use this empty folder", properties: ["openDirectory", "createDirectory"] })
      : await dialog.showOpenDialog({ title: "Choose an empty folder just for Studi", buttonLabel: "Use this empty folder", properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return current;
    const homeworkRoot = await initializeHomeworkWorkspace(result.filePaths[0]);
    await syncHomeworkClassFolders(homeworkRoot, requireLocalStore().school.listCourses());
    return requireLocalStore().productPreferences.put({
      ...current,
      homeworkRoot,
      updatedAt: new Date().toISOString(),
    });
  },
  saveNotificationPreferences: async (input) => {
    const current = await requireLocalStore().productPreferences.get();
    return requireLocalStore().productPreferences.put({
      ...current,
      schemaVersion: STUDI_SCHEMA_VERSION,
      notifications: input,
      updatedAt: new Date().toISOString(),
    });
  },
  testNotification: ({ kind }) => requireAppKernel().preview(kind),
  savePermissionRule: async (input) => {
    requireLocalStore().permissionRules.put({
      ...input,
      schemaVersion: STUDI_SCHEMA_VERSION,
      ruleId: input.ruleId ?? `setting-${randomUUID()}`,
      updatedAt: new Date().toISOString(),
    });
    requireManagerCoordinator().reconcileQueue();
    return readProductSettings();
  },
  deletePermissionRule: async ({ ruleId }) => {
    requireLocalStore().permissionRules.delete(ruleId);
    requireManagerCoordinator().reconcileQueue();
    return readProductSettings();
  },
  configureScanSchedule: async ({ cadence, localTime, weekday }) => {
    requireAppKernel().configureSchedule(cadence, Intl.DateTimeFormat().resolvedOptions().timeZone, {
      localTime,
      ...(weekday === undefined ? {} : { weekday }),
    });
    return readProductSettings();
  },
  getLibraryState: () => readLibraryState(),
  getTaskDetail: ({ taskId }) => readTaskDetail(taskId),
  readArtifact: async ({ kind, artifactId }) => {
    if (kind === "memory" && (await requireLocalStore().productPreferences.get()).memoryVisibility === "none") {
      throw new Error("Local memories are hidden by the current memory visibility setting");
    }
    return requireLocalStore().artifacts.read(kind, artifactId);
  },
  requestAssignmentTakeover: async ({ taskId }) => {
    await requireAssignmentExecutionCoordinator().requestTakeover(taskId);
    return requireAppKernel().state();
  },
  cancelAssignment: ({ taskId }) => {
    requireAssignmentExecutionCoordinator().cancel(taskId);
    return requireAppKernel().state();
  },
  setBrowserLayout: ({ mode, bounds }) => {
    browserLayoutMode = mode;
    deskSlotBounds = mode === "desk" && bounds ? bounds : null;
    layoutSchoolBrowser();
    return browserLayoutMode;
  },
  getTelemetryState: () => requireTelemetryService().state(),
  setTelemetryPreferences: ({ enabled, replayEnabled }) => {
    const service = requireTelemetryService();
    const previous = service.state();
    if (previous.enabled && previous.replayEnabled !== replayEnabled) {
      service.capture("studi_setting_changed", { setting: "replay", enabled: replayEnabled });
    }
    if (previous.enabled && !enabled) {
      service.capture("studi_setting_changed", { setting: "analytics", enabled: false });
    }
    service.setPreferences(enabled, replayEnabled);
    if (!previous.enabled && enabled) {
      service.capture("studi_setting_changed", { setting: "analytics", enabled: true });
    }
    return service.state();
  },
  setTelemetryDebug: ({ durationMinutes }) => {
    const service = requireTelemetryService();
    service.setDebug(durationMinutes);
    service.capture("studi_setting_changed", { setting: "beta_debug", enabled: durationMinutes > 0 });
    return service.state();
  },
  captureUiTelemetry: (input) => {
    if (input.event === "replay_context") return requireTelemetryService().setReplayContext(input.distinctId, input.sessionId, input.windowId);
    if(input.event==='ui_error'){const error=new Error(input.message);if(input.stack)error.stack=input.stack;return requireTelemetryService().captureError(error,'ipc','ipc_request');}
    return requireTelemetryService().capture("studi_dashboard_viewed",{section:input.section});
  },
  exportDiagnostics: async () => {
    const window = requireMainWindow();
    const exportedAt = new Date();
    const choice = await dialog.showSaveDialog(window, {
      title: "Export safe Studi diagnostics",
      defaultPath: join(app.getPath("documents"), `studi-diagnostics-${exportedAt.toISOString().slice(0, 10)}.json`),
      filters: [{ name: "JSON diagnostic bundle", extensions: ["json"] }],
      properties: ["showOverwriteConfirmation", "createDirectory"],
    });
    if (choice.canceled || !choice.filePath) return { status: "cancelled" };
    const telemetry = requireTelemetryService().state();
    const snapshot = buildDiagnosticsSnapshot({
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
      packaged: app.isPackaged,
      storage: requireLocalStore().health(),
      telemetryConfigured: telemetry.configured,
      telemetryEnabled: telemetry.enabled,
      replayEnabled: telemetry.replayEnabled,
      diagnostics: telemetry.inspector,
      now: exportedAt,
    });
    await writeDiagnosticsSnapshot(choice.filePath, snapshot);
    return {
      status: "saved",
      fileName: basename(choice.filePath),
      exportedAt: snapshot.manifest.exportedAt,
    };
  },
};

function registerIpcHandlers(): void {
  for (const registration of createIpcHandlerRegistrations(studiIpcRegistry, ipcHandlers)) {
    ipcMain.handle(registration.channel, async (_event, rawRequest: unknown) => {
      const method = Object.entries(studiIpcRegistry).find(([, contract]) => contract.channel === registration.channel)?.[0] ?? registration.channel;
      const tracked = !/^(get|setBrowserLayout|captureUiTelemetry|setTelemetry|signIn|signOut|loginProvider|completeProviderLogin|cancelProviderLogin|retryEntitlement)/.test(method);
      const startedAt = Date.now();
      const owner = telemetryService?.state().distinctId;
      const actionId = randomUUID();
      const recordAction = (phase: string) => {
        if (!tracked || telemetryService?.state().distinctId !== owner) return;
        telemetryService?.captureDiagnostic({ source: "action", kind: method, run_id: actionId,
          at: new Date().toISOString(), payload: { phase, duration_ms: Date.now() - startedAt, ...(phase === "started" ? { request: rawRequest } : {}) } });
      };
      recordAction("started");
      try {
        if (updateService?.restarting && !registration.channel.startsWith('studi:update-')) throw new Error('Studi is saving your place for an update.');
        const result = await registration.handle(rawRequest);
        recordAction("succeeded");
        return result;
      } catch (error) {
        recordAction("failed");
        const request = rawRequest && typeof rawRequest === "object" ? rawRequest as Record<string, unknown> : {};
        telemetryService?.captureError(error, "ipc", "ipc_request", {
          ipc_channel: registration.channel,
          ...(typeof request.taskId === "string" ? { task_id: request.taskId.slice(0, 256) } : {}),
          ...(typeof request.toolkit === "string" ? { toolkit: request.toolkit.slice(0, 128) } : {}),
        });
        throw error;
      }
    });
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    ...windowChromeOptions,
    backgroundColor: "#fbf7ec",
    icon: loadAppIcon(),
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  window.setMenu(null);
  window.setMenuBarVisibility(false);

  configureAppNavigation(window.webContents, url => shell.openExternal(url));
  window.on("close", (event) => {
    if (!appKernel && !gateQuitting) {
      event.preventDefault();
      window.hide();
    }
  });

  window.once("ready-to-show", () => {
    if (window.isDestroyed()) return;
    window.show();
    window.focus();
  });
  mainWindow = window;

  return window;
}

function initializeAuthCoordinator(): void {
  authCoordinator = new AuthCoordinator({
    vault: new AuthVault(join(app.getPath("userData"), "studi-auth"), safeStorage),
    openExternal: openAuthUrl,
    identityReset: resetAnalyticsIdentity,
  });
}

function resetAnalyticsIdentity(): void {
  try {
    telemetryService?.resetIdentity();
  } catch {
    // Telemetry persistence must not prevent local sign-out.
  }
}

function initializeTelemetry(): void {
  const config = loadTelemetryPublicConfig(app.isPackaged);
  telemetryService = new TelemetryService({
    ...config,
    appVersion: app.getVersion(),
    platform: process.platform,
    settingsPath: join(app.getPath("userData"), "telemetry-settings.json"),
  });
  telemetryService.capture("studi_app_started", { launch: "desktop" });
}

function observeAuthState(state: AuthState): void {
  if ("user" in state) {
    requireTelemetryService().identifyClerk({
      subject: state.user.subject,
      email: state.user.email,
      name: state.user.name,
    });
  }
  requireTelemetryService().capture("studi_auth_gate", {
    status: state.status,
    ...(state.status === "denied" ? { reason: state.reason } : {}),
    ...(state.status === "error" ? { reason: "unavailable" as const } : {}),
    ...("user" in state
      ? {
          ...(state.user.email ? { email: state.user.email } : {}),
          ...(state.user.name ? { name: state.user.name } : {}),
        }
      : {}),
  });
}

function currentAuthState(): AuthState {
  return projectProtectedAuthState(authCoordinator?.state() ?? { status: "checking" }, appKernel !== null);
}

function ensureGateTray(): void {
  if (gateTray) return;
  gateTray = new Tray(loadTrayIcon());
  gateTray.setToolTip("Studi sign-in");
  gateTray.on("click", openMainWindow);
  gateTray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Studi", click: openMainWindow },
    { type: "separator" },
    { label: "Quit Studi", click: () => { gateQuitting = true; app.quit(); } },
  ]));
}

function disposeGateTray(): void {
  gateTray?.removeListener("click", openMainWindow);
  gateTray?.destroy();
  gateTray = null;
}

function openMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function startRenderer(window: BrowserWindow): void {
  void loadRenderer(window).catch((error: unknown) => {
    process.stderr.write(`STUDI_RENDERER_LOAD_FAILED ${formatError(error)}\n`);
  });
}

function createSchoolBrowser(window: BrowserWindow): void {
  selectedBrowserPage = "school";
  const page = schoolBrowserPage("school");
  browserView = page.view;
  browserController = page.controller;
  driveOverlay = new DriveOverlay(window, () => {
    void takeOverVisibleBrowser();
  });

  layoutSchoolBrowser();
  window.on("resize", layoutSchoolBrowser);
  browserDriverTimer = setInterval(() => {
    if (browserLayoutMode === "hidden") return;
    driveOverlay?.setDriver(currentBrowserDriver());
  }, 80);

}

function schoolBrowserPage(key: string): {view:WebContentsView;controller:BrowserController} {
  const existing = browserPages.get(key);
  if (existing) return existing;
  const window = mainWindow;
  if (!window || window.isDestroyed()) throw new Error("The school browser is unavailable");
  const view = new WebContentsView({webPreferences:{session:electronSession.fromPartition("persist:studi-school",{cache:true}),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  const controller = new BrowserController(view.webContents);
  browserPages.set(key,{view,controller});
  view.setVisible(false);
  window.contentView.addChildView(view);
  driveOverlay?.raise();
  view.webContents.on("did-start-navigation",(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame) controller.pageChanged();});
  view.webContents.on("did-fail-load",(_event,code,description,url,isMainFrame)=>{if(isMainFrame) recordBrowserDiagnostic("load_failed",{page:key,code,description,url});});
  view.webContents.on("render-process-gone",(_event,details)=>recordBrowserDiagnostic("process_gone",{page:key,...details}));
  view.webContents.setWindowOpenHandler(({url})=>{
    if (/^https?:/i.test(url)) void controller.navigate(url).catch(error=>recordBrowserDiagnostic("popup_failed",{page:key,message:formatError(error)}));
    return {action:"deny"};
  });
  void view.webContents.loadURL("about:blank").catch(error => recordBrowserDiagnostic("page_start_failed",{page:key,message:formatError(error)}));
  return {view,controller};
}

function recordBrowserDiagnostic(kind: string, payload: unknown): void {
  telemetryService?.captureDiagnostic({
    source: "browser", kind, at: new Date().toISOString(),
    payload: { driver: currentBrowserDriver(), details: payload },
  });
}

function layoutSchoolBrowser(): void {
  const window = mainWindow;
  const view = browserView;
  if (!window || window.isDestroyed() || !view) return;
  for (const page of browserPages.values()) if (page.view !== view) page.view.setVisible(false);
  const bounds = visibleSchoolBounds(window);
  if (!bounds) {
    view.setVisible(false);
    driveOverlay?.layout(null);
    return;
  }
  view.setBounds(bounds);
  view.setBorderRadius(SCHOOL_PANE_RADIUS);
  view.setVisible(true);
  driveOverlay?.layout(bounds);
  driveOverlay?.setDriver(currentBrowserDriver());
}

async function takeOverVisibleBrowser(): Promise<void> {
  try {
    const execution = localStore?.lifecycle.getActiveExecution();
    if (execution?.phase === "working" && selectedBrowserPage === `assignment:${execution.assignmentId}` && assignmentExecutionCoordinator) {
      await assignmentExecutionCoordinator.requestTakeover(execution.taskId);
      driveOverlay?.setDriver(currentBrowserDriver());
      return;
    }
    const scan = localStore?.school.latestScan();
    if (selectedBrowserPage === "school" && scan?.state === "running" && schoolScanCoordinator) {
      await schoolScanCoordinator.requestTakeover();
      driveOverlay?.setDriver(currentBrowserDriver());
    }
  } catch {
    driveOverlay?.setDriver(currentBrowserDriver());
  }
}

function visibleSchoolBounds(window: BrowserWindow): Electron.Rectangle | null {
  if (browserLayoutMode === "hidden") return null;
  if (browserLayoutMode === "desk") return deskSlotBounds;
  const [width = 1120, height = 760] = window.getContentSize();
  const conversationWidth = Math.round(width * (0.92 / 2.1));
  const x = conversationWidth + 20;
  const y = 24;
  return { x, y, width: Math.max(300, width - x - 10), height: Math.max(300, height - y - 10) };
}

function browserPageBusy(key:string): boolean {
  const scan = localStore?.school.latestScan();
  const execution = localStore?.lifecycle.getActiveExecution();
  return (key === "school" && scan?.state === "running") || Boolean(execution && key === `assignment:${execution.assignmentId}` && ["working","submitting"].includes(execution.phase));
}

function currentBrowserDriver() {
  const scan = localStore?.school.latestScan();
  const execution = localStore?.lifecycle.getActiveExecution();
  return browserDriver({
    layout: browserLayoutMode,
    ...(selectedBrowserPage === "school" && scan ? { scanState: scan.state } : {}),
    ...(execution && selectedBrowserPage === `assignment:${execution.assignmentId}` ? { executionPhase: execution.phase } : {}),
  });
}

async function readProductSettings(): Promise<ProductSettingsState> {
  const store = requireLocalStore();
  return {
    preferences: await store.productPreferences.get(),
    permissionRules: store.permissionRules.listAll(),
    schedule: store.lifecycle.getSchedule(),
  };
}

async function readLibraryState(): Promise<LibraryState> {
  const store = requireLocalStore();
  const tasks = store.tasks.listAll().flatMap((task) => {
    const assignment = store.assignments.get(task.assignmentId);
    if (!assignment) return [];
    return [{
      task,
      assignment,
      execution: store.lifecycle.getExecution(task.taskId),
      permission: requireManagerCoordinator().resolvePermission(assignment.assignmentId, assignment.courseId),
    }];
  });
  const memoryVisibility = (await store.productPreferences.get()).memoryVisibility;
  const artifactKinds = memoryVisibility === "none"
    ? (["preference", "workflow", "answer"] as const)
    : (["preference", "memory", "workflow", "answer"] as const);
  const documents = (await Promise.all(
    artifactKinds.map((kind) => store.artifacts.list(kind)),
  )).flat();
  return {
    tasks,
    artifacts: documents.map((document) => ({ frontmatter: document.frontmatter })),
  };
}

function readTaskDetail(taskId: string): TaskDetail {
  const store = requireLocalStore();
  const task = store.tasks.get(taskId);
  if (!task) throw new Error(`Task ${taskId} does not exist`);
  const assignment = store.assignments.get(task.assignmentId);
  if (!assignment) throw new Error(`Assignment ${task.assignmentId} does not exist`);
  return {
    task,
    assignment,
    execution: store.lifecycle.getExecution(taskId),
    permission: requireManagerCoordinator().resolvePermission(assignment.assignmentId, assignment.courseId),
    events: store.tasks.listEvents(taskId),
    runs: store.runs.listByTask(taskId),
    attempts: store.lifecycle.listAttempts(taskId),
    submissionReceipt: store.lifecycle.getSubmissionReceipt(taskId),
    activity: [...requireAssignmentExecutionCoordinator().activity(taskId)],
  };
}

function loadRenderer(window: BrowserWindow): Promise<void> {
  const developmentUrl = getDevelopmentUrl({
    isPackaged: app.isPackaged,
    switchValue: app.commandLine.getSwitchValue("studi-development-url"),
  });
  return developmentUrl ? window.loadURL(developmentUrl) : window.loadFile(rendererPath);
}

async function initializeStorage(): Promise<void> {
  const dataRoot = join(app.getPath("userData"), "studi-data");
  localStore = await openLocalStore(dataRoot, {
    migrationBackup: {
      directory: join(app.getPath("userData"), "studi-migration-backups"),
      appVersion: app.getVersion(),
    },
  });
}

async function initializeDesktopAgent(): Promise<void> {
  const identity = authCoordinator?.state();
  const ownerSubject = identity && (identity.status === "approved" || identity.status === "offline") ? identity.user.subject : undefined;
  const dataRoot = join(app.getPath("userData"), "studi-data");
  agentRuntime = await PiAgentRuntime.create({
    cwd: dataRoot,
    agentDir: join(dataRoot, "pi"),
    browserController: schoolBrowserPage("home").controller,
    scanBrowserController: schoolBrowserPage("school").controller,
    assignmentBrowser: id => schoolBrowserPage(`assignment:${id}`).controller,
    onUsage: recordAgentUsage,
    onSessionError: (error) => requireTelemetryService().captureError(error, "runtime", "session_start", currentAgentSelection()),
    onDiagnostic: (event) => {
      const telemetry = requireTelemetryService();
      if (ownerSubject && telemetry.state().distinctId === ownerSubject) {
        telemetry.captureDiagnostic({ source: "runtime", ...event });
      }
    },
  });
  await applyPersistedAgentRuntime();
  runtimeLoginAttempt = new ProviderLoginAttemptOwner(async (providerId, signal, interaction) => {
    await requireAgentRuntime().loginProvider(providerId, signal, {
      openExternal: (url) => shell.openExternal(url),
      notify: interaction.notify,
      awaitManualCode: interaction.awaitManualCode,
    });
    await adoptConnectedProvider(providerId);
  });
  managerCoordinator = await ManagerCoordinator.create(
    requireLocalStore(),
    agentRuntime,
    {
      startAssignment: async (taskId) => {
        return requireAssignmentExecutionCoordinator().start(taskId);
      },
    },
  );
  conversationCoordinator = new ConversationCoordinator(
    requireLocalStore(),
    agentRuntime,
    managerCoordinator,
    { connectedAppTools: loadConnectedAppTools, ownerSubject },
  );
  unsubscribeConversationTrace = requireTelemetryService().subscribeToTrace(conversationCoordinator.trace);
  visibleBrowserWork = new VisibleBrowserWork(requireLocalStore());
  schoolScanCoordinator = new SchoolScanCoordinator(
    requireLocalStore(),
    agentRuntime,
    schoolBrowserPage("school").controller,
    {
      browserWork: requireVisibleBrowserWork(), manager: requireManagerCoordinator(),
      onError: (error, scanId, toolName) => requireTelemetryService().captureError(error, "scan", "school_scan", {
        ...currentAgentSelection(), scan_id: scanId, ...(toolName ? { tool_name: toolName } : {}),
      }),
    },
  );
}

async function synchronizeProtectedRuntime(state: AuthState): Promise<void> {
  if (state.status !== "approved" && state.status !== "offline") {
    if (appKernel || browserView) disposeProtectedRuntime();
    ensureGateTray();
    return;
  }
  if (appKernel) return;
  const window = mainWindow;
  if (!window || window.isDestroyed()) throw new Error("The Studi window is not ready");
  disposeGateTray();
  createSchoolBrowser(window);
  await initializeDesktopAgent();
  await initializeAppKernel(window);
}

function disposeProtectedRuntime(): void {
  runtimeLoginAttempt?.dispose();
  runtimeLoginAttempt = null;
  appKernel?.dispose();
  appKernel = null;
  assignmentExecutionCoordinator?.dispose();
  assignmentExecutionCoordinator = null;
  schoolScanCoordinator?.dispose();
  schoolScanCoordinator = null;
  unsubscribeConversationTrace?.();
  unsubscribeConversationTrace = null;
  conversationCoordinator?.dispose();
  conversationCoordinator = null;
  managerCoordinator?.dispose();
  managerCoordinator = null;
  visibleBrowserWork = null;
  agentRuntime = null;
  pendingNotifications.splice(0);
  for (const {view:browserView} of browserPages.values()) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(browserView);
    if (!browserView.webContents.isDestroyed()) browserView.webContents.close();
  }
  browserPages.clear();
  if (browserDriverTimer) clearInterval(browserDriverTimer);
  browserDriverTimer = null;
  mainWindow?.removeListener("resize",layoutSchoolBrowser);
  driveOverlay?.dispose();
  driveOverlay = null;
  browserView = null;
  browserController = null;
}

function loadConnectedAppTools() {
  return createConnectedAppTools(requireAuthCoordinator(), {
    observeExecution: (observation) => {
      requireTelemetryService().capture("studi_composio_tool", {
        toolkit: observation.toolkit,
        tool: observation.tool,
        status: observation.status,
        duration_ms: observation.durationMs,
        original_bytes: observation.originalBytes,
        retained_bytes: observation.retainedBytes,
        truncated: observation.truncated,
        log_id: observation.logId,
        error: observation.error,
      });
    },
  });
}

async function initializeAppKernel(window: BrowserWindow): Promise<void> {
  const productPreferences = await requireLocalStore().productPreferences.get();
  assignmentExecutionCoordinator = await AssignmentExecutionCoordinator.create(
    requireLocalStore(),
    requireManagerCoordinator(),
    requireBrowserController(),
    {
      browserWork: requireVisibleBrowserWork(),
      connectedAppTools: loadConnectedAppTools,
      browserForAssignment: id => schoolBrowserPage(`assignment:${id}`).controller,
      reviewWindowMs: productPreferences.reviewMinutes * 60_000,
      handoffWindowMs: productPreferences.handoffMinutes * 60_000,
      notify: async (intent) => {
        observeExecutionNotification(intent);
        if (appKernel) {
          await appKernel.notify(intent);
          return;
        }
        pendingNotifications.push(intent);
      },
    },
  );
  requireConversationCoordinator().setAssignmentWorkRunner((taskId, prompt, observe) =>
    requireAssignmentExecutionCoordinator().continueTurn(taskId, prompt, observe),
  );
  appKernel = new AppKernel(
    requireLocalStore(),
    requireManagerCoordinator(),
    assignmentExecutionCoordinator,
    requireVisibleBrowserWork(),
    window,
    {
      runScheduledScan: async (claimOccurrence) => {
        const service = requireTelemetryService();
        const startedAt = Date.now();
        discardStaleAgentUsage();
        service.capture("studi_scan_started", { mode: "scheduled", ...currentAgentSelection(), ...currentSchoolContext() });
        try {
          const result = await requireSchoolScanCoordinator().runScheduledScan(claimOccurrence, requireReadyProviderForScan);
          if (result) captureScanFinished("scheduled", result.state, startedAt);
          return result;
        } catch (error) {
          service.captureError(error, "scan", "school_scan", currentAgentSelection());
          throw error;
        }
      },
      focusBrowser: () => browserView?.webContents.focus(),
      iconPath: appIconPath,
    },
  );
  const profile = requireLocalStore().school.getProfile();
  if (profile && !requireLocalStore().lifecycle.getSchedule()) {
    appKernel.configureSchedule(profile.scanCadence);
  }
  await appKernel.start();
  for (const intent of pendingNotifications.splice(0)) await appKernel.notify(intent);
}

async function runScanWithTelemetry(
  mode: "start" | "resume" | "replay",
  run: () => Promise<SchoolOnboardingState>,
): Promise<SchoolOnboardingState> {
  const service = requireTelemetryService();
  const startedAt = Date.now();
  discardStaleAgentUsage();
  service.capture("studi_scan_started", { mode, ...currentAgentSelection(), ...currentSchoolContext() });
  try {
    const state = await run();
    await syncSelectedHomeworkClasses();
    captureScanFinished(mode, state, startedAt);
    if (state.scan?.state === "needs_user") service.capture("studi_handoff", { kind: "scan", state: "needs_user" });
    return state;
  } catch (error) {
    service.captureError(error, "scan", "school_scan", currentAgentSelection());
    throw error;
  }
}

function captureScanFinished(
  mode: "start" | "resume" | "replay" | "scheduled",
  state: SchoolOnboardingState,
  startedAt: number,
): void {
  if (!state.scan) return;
  try {
    requireTelemetryService().capture("studi_scan_finished", {
      mode,
      state: state.scan.state,
      duration_ms: Math.max(0, Date.now() - startedAt),
      course_count: state.courses.length,
      assignment_count: state.assignments.length,
      linked_system_count: state.linkedSystems.length,
      ...currentAgentFacts(),
      ...schoolContextFrom(state),
      scan_id: state.scan.scanId,
      failure_count: state.scan.failures.length,
      failures: state.scan.failures,
      coverage: state.scan.coverage.map(({ target, status, failure }) => ({ target, status, ...(failure ? { failure } : {}) })),
      handoff: state.scan.handoff ? { kind: state.scan.handoff.kind, reason: state.scan.handoff.reason } : null,
      current_step: state.scan.currentStep,
    });
  } catch {
    // A finished scan must still return to the window if PostHog reporting is picky.
  }
}

function captureQueueTransition(
  action: "manager_turn" | "assignment_start" | "assignment_resume" | "submission_verify" | "schedule_pause" | "schedule_resume",
  state: LifecycleState,
): void {
  if ((action === "assignment_start" || action === "assignment_resume") && assignmentRunStartedAt === null) {
    assignmentRunStartedAt = Date.now();
  }
  requireTelemetryService().capture("studi_queue_transition", {
    action,
    phase: state.execution?.phase ?? "idle",
    ...(state.execution ? { task_id: state.execution.taskId } : {}),
    ...currentAgentSelection(),
    ...assignmentLabels(state.execution?.assignmentId),
  });
}

function observeExecutionNotification(intent: ExecutionNotification): void {
  const service = requireTelemetryService();
  if (intent.kind === "handoff") service.capture("studi_handoff", { kind: "assignment", state: "needs_user" });
  if (intent.kind === "review_ready") service.capture("studi_review", { state: "ready_review" });
  if (intent.kind === "failure") {
    const execution = intent.target.type === "task" ? requireLocalStore().lifecycle.getExecution(intent.target.id) : null;
    service.captureError(new Error(execution?.lastError ?? intent.body ?? "assignment failed"), "queue", "assignment", currentAgentSelection());
  }
  if (intent.target.type === "task") {
    const phase = intent.kind === "review_ready"
      ? "ready_review"
      : intent.kind === "failure"
        ? "failed"
        : "needs_user";
    captureAssignmentFinished(intent.target.id, phase);
  }
}

function captureAssignmentFinished(
  taskId: string,
  phase: "needs_user" | "ready_review" | "submitted" | "preserved" | "failed",
): void {
  const startedAt = assignmentRunStartedAt;
  assignmentRunStartedAt = null;
  const execution = requireLocalStore().lifecycle.getExecution(taskId);
  requireTelemetryService().capture("studi_assignment_finished", {
    task_id: taskId,
    phase,
    ...assignmentLabels(execution?.assignmentId),
    ...currentAgentFacts(startedAt === null ? undefined : Math.max(0, Date.now() - startedAt)),
  });
  void authCoordinator?.recordUsage({
    eventId: `assignment-worked/${taskId}`.slice(0, 256),
    occurredAt: new Date().toISOString(),
    kind: "assignment_worked",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    toolCalls: 0,
  }).catch(() => undefined);
}

async function syncSelectedHomeworkClasses(): Promise<void> {
  const store = requireLocalStore();
  const preferences = await store.productPreferences.get();
  if (!preferences.homeworkRoot) return;
  await syncHomeworkClassFolders(preferences.homeworkRoot, store.school.listCourses());
}

function recordAgentUsage(
  usage: AgentUsageSnapshot,
  kind: UsageEventKind,
): void {
  const hasUsage = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.toolCalls > 0;
  if (!hasUsage) return;
  void authCoordinator?.recordUsage({
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    kind,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    toolCalls: usage.toolCalls,
  }).catch(() => undefined);
}

function discardStaleAgentUsage(): void {
  agentRuntime?.takeLastUsage();
}

function currentAgentSelection(): { provider?: string; model?: string; reasoning_effort?: AgentReasoningEffort } {
  if (!agentRuntime) return {};
  return {
    provider: agentRuntime.selectedProviderId,
    model: agentRuntime.selectedModelId,
    reasoning_effort: agentRuntime.selectedReasoningEffort,
  };
}

function currentAgentFacts(durationMs?: number): Record<string, string | number> {
  return {
    ...currentAgentSelection(),
    ...(durationMs === undefined ? {} : { duration_ms: durationMs }),
    ...usageProperties(agentRuntime?.takeLastUsage() ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      toolCalls: 0,
    }),
  };
}

function currentSchoolContext(): { student_name?: string; school_root?: string } {
  const profile = localStore?.school.getProfile();
  if (!profile) return {};
  return { student_name: profile.studentName, school_root: profile.schoolRoot };
}

function schoolContextFrom(state: SchoolOnboardingState): {
  student_name?: string;
  school_root?: string;
  course_titles?: string;
} {
  return {
    ...(state.profile ? { student_name: state.profile.studentName, school_root: state.profile.schoolRoot } : {}),
    ...(state.courses.length > 0
      ? { course_titles: state.courses.map((course) => course.label).join(" | ").slice(0, 2_000) }
      : {}),
  };
}

function assignmentLabels(assignmentId?: string): { assignment_title?: string; course_label?: string } {
  if (!assignmentId || !localStore) return {};
  const assignment = localStore.assignments.get(assignmentId);
  if (!assignment) return {};
  const course = localStore.school.listCourses().find((item) => item.courseId === assignment.courseId);
  return {
    assignment_title: assignment.title,
    ...(course ? { course_label: course.label } : {}),
  };
}

async function readWorkspaceState() {
  const runtime = requireAgentRuntime();
  return {
    browser: { ...requireBrowserController().state, driver: currentBrowserDriver() },
    providers: await Promise.all(AGENT_PROVIDERS.map((provider) => runtime.getProviderStatus(provider.id))),
    selectedProviderId: runtime.selectedProviderId,
    providerLogin: runtimeLoginAttempt?.handoff ?? null,
    models: AGENT_PROVIDERS.flatMap((provider) => runtime.getProviderModels(provider.id)),
    selectedModelId: runtime.selectedModelId,
    selectedReasoningEffort: runtime.selectedReasoningEffort,
  };
}

async function persistAgentRuntimeChoice(): Promise<void> {
  const runtime = requireAgentRuntime();
  const store = requireLocalStore().productPreferences;
  const current = await store.get();
  await store.put({
    ...current,
    agentProviderId: runtime.selectedProviderId,
    agentModelId: runtime.selectedModelId,
    agentReasoningEffort: runtime.selectedReasoningEffort,
    updatedAt: new Date().toISOString(),
  });
}

/** A subscription the student just connected becomes the one Inky uses. */
async function adoptConnectedProvider(providerId: AgentProviderId): Promise<void> {
  const runtime = requireAgentRuntime();
  if (runtime.selectedProviderId !== providerId) runtime.selectProvider(providerId);
  await persistAgentRuntimeChoice();
  const telemetry = requireTelemetryService();
  telemetry.capture("studi_provider_connection", { provider: providerId, state: "connected" });
  telemetry.setPerson({ selected_provider: providerId, selected_model: runtime.selectedModelId, selected_reasoning: runtime.selectedReasoningEffort });
}

async function applyPersistedAgentRuntime(): Promise<void> {
  const runtime = requireAgentRuntime();
  const preferences = await requireLocalStore().productPreferences.get();
  try {
    runtime.selectModel(preferences.agentProviderId, preferences.agentModelId);
  } catch {
    try {
      runtime.selectProvider(preferences.agentProviderId);
    } catch {
      // Keep the catalog default when the saved subscription has no installed model.
    }
  }
  runtime.setReasoningEffort(preferences.agentReasoningEffort);
  requireTelemetryService().setPerson({
    selected_provider: runtime.selectedProviderId,
    selected_model: runtime.selectedModelId,
    selected_reasoning: runtime.selectedReasoningEffort,
  });
}

function requireRuntimeLoginAttempt(): ProviderLoginAttemptOwner {
  if (!runtimeLoginAttempt) {
    throw new Error("The subscription sign-in service is not ready");
  }
  return runtimeLoginAttempt;
}

function requireBrowserController(): BrowserController {
  if (!browserController) {
    throw new Error("The visible school browser is not ready");
  }
  return browserController;
}

function requireLocalStore(): LocalStore {
  if (!localStore) {
    throw new Error("The Studi local store is not ready");
  }
  return localStore;
}

function requireManagerCoordinator(): ManagerCoordinator {
  if (!managerCoordinator) {
    throw new Error("The Studi manager is not ready");
  }
  return managerCoordinator;
}

function requireConversationCoordinator(): ConversationCoordinator {
  if (!conversationCoordinator) {
    throw new Error("Inky conversations are not ready");
  }
  return conversationCoordinator;
}

function requireVisibleBrowserWork(): VisibleBrowserWork {
  if (!visibleBrowserWork) throw new Error("Visible browser ownership is not ready");
  return visibleBrowserWork;
}

function requireAgentRuntime(): PiAgentRuntime {
  if (!agentRuntime) {
    throw new Error("The Studi agent runtime is not ready");
  }
  return agentRuntime;
}

function requireSchoolScanCoordinator(): SchoolScanCoordinator {
  if (!schoolScanCoordinator) {
    throw new Error("School onboarding is not ready");
  }
  return schoolScanCoordinator;
}

function requireAssignmentExecutionCoordinator(): AssignmentExecutionCoordinator {
  if (!assignmentExecutionCoordinator) throw new Error("Assignment execution is not ready");
  return assignmentExecutionCoordinator;
}

function requireAppKernel(): AppKernel {
  if (!appKernel) throw new Error("The Studi app kernel is not ready");
  return appKernel;
}

function requireAuthCoordinator(): AuthCoordinator {
  if (!authCoordinator) throw new Error("Studi authentication is not ready");
  return authCoordinator;
}

function requireTelemetryService(): TelemetryService {
  if (!telemetryService) throw new Error("Studi telemetry is not ready");
  return telemetryService;
}

function requireMainWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("The Studi window is not ready");
  return mainWindow;
}

function loadAppIcon() {
  const icon = nativeImage.createFromPath(appIconPath);
  if (icon.isEmpty()) throw new Error(`Studi app icon is missing: ${appIconPath}`);
  return icon;
}

async function openAuthUrl(url: string): Promise<unknown> {
  const handoff = qaClerkHandoffEndpoint();
  if (!handoff) return shell.openExternal(url);
  const response = await fetch(handoff, {
    method: "POST",
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: url,
  });
  if (!response.ok) throw new Error(`The isolated Clerk handoff rejected the authorization request (${response.status})`);
  return undefined;
}

function qaClerkHandoffEndpoint(): string | null {
  if (app.isPackaged) return null;
  const raw = app.commandLine.getSwitchValue("studi-qa-clerk-handoff");
  if (!raw) return null;
  const endpoint = new URL(raw);
  if (
    endpoint.protocol !== "http:"
    || endpoint.hostname !== "127.0.0.1"
    || endpoint.pathname !== "/publish"
    || endpoint.username
    || endpoint.password
    || endpoint.search
    || endpoint.hash
  ) {
    throw new Error("The QA Clerk handoff must be a credential-free 127.0.0.1 /publish URL");
  }
  return endpoint.toString();
}

function loadTrayIcon() {
  const icon = nativeImage.createFromPath(trayIconPath);
  if (!icon.isEmpty()) return icon;
  return loadAppIcon().resize({ width: 32, height: 32, quality: "best" });
}

async function requireReadyProviderForScan(): Promise<void> {
  await requireReadyProvider("scanning the school");
}

/** Refuses work until the selected subscription can actually answer, naming it for the student. */
async function requireReadyProvider(purpose: string): Promise<void> {
  const runtime = requireAgentRuntime();
  const provider = await runtime.getProviderStatus(runtime.selectedProviderId);
  const name = agentProviderName(runtime.selectedProviderId);
  const attention = classifyAgentRuntimeAttention(provider);
  if (attention === "usage") {
    throw new Error(`${name} usage ran out. Wait for more usage or switch to another subscription, then try again.`);
  }
  if (attention === "needs_login") {
    throw new Error(`${name} needs you to sign in again before ${purpose}.`);
  }
  if (provider.state !== "ready") {
    throw new Error(`Connect ${name} before ${purpose}.`);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function configureStartupProfile(): boolean {
  try {
    if (
      !app.isPackaged
      && app.commandLine.hasSwitch("studi-development-url")
      && !app.commandLine.hasSwitch("user-data-dir")
    ) {
      app.setPath("userData", join(app.getPath("appData"), "Studi Development"));
    }
    return true;
  } catch (error) {
    process.stderr.write(`STUDI_STARTUP_PROFILE_FAILED ${formatError(error)}\n`);
    app.exit(1);
    return false;
  }
}

if (canStart) {
  void app.whenReady().then(async () => {
    try {
      app.setAppUserModelId("com.squirrel.studi.Studi");
      Menu.setApplicationMenu(null);
      registerDesktopConnectProtocol();
      initializeTelemetry();
      await initializeStorage();
      const window = createWindow();
      initializeAuthCoordinator();
      ensureGateTray();
      registerIpcHandlers();
      updates().start();
      startRenderer(window);
      const state = await requireAuthCoordinator().start();
      observeAuthState(state);
      await synchronizeProtectedRuntime(state);
      await finishPendingDesktopConnect();
    } catch (error) {
      process.stderr.write(`STUDI_STORAGE_START_FAILED ${formatError(error)}\n`);
      app.exit(1);
    }
  });
}

if (startupProfileConfigured && !canStart) app.quit();

app.on("second-instance", (_event, argv) => {
  if (findDesktopConnectUrl(argv)) {
    queueDesktopConnect();
    return;
  }
  if (appKernel) appKernel.open();
  else openMainWindow();
});

app.on("open-url", (event, url) => {
  if (!isDesktopConnectUrl(url)) return;
  event.preventDefault();
  queueDesktopConnect();
});

app.on("window-all-closed", () => {
  // The tray owns the desktop lifecycle. Explicit Quit is the normal exit path.
});

app.on("before-quit", (event) => {
  if (!telemetryService || telemetryShutdownFinished) return;
  event.preventDefault();
  void telemetryService.shutdown().finally(() => {
    telemetryShutdownFinished = true;
    app.quit();
  });
});

app.on("will-quit", () => {
  gateQuitting = true;
  updateService?.dispose();
  disposeGateTray();
  disposeProtectedRuntime();
  authCoordinator = null;
  telemetryService = null;
  localStore?.close();
  localStore = null;
  mainWindow = null;
  for (const method of studiIpcMethods) {
    ipcMain.removeHandler(studiIpcRegistry[method].channel);
  }
});

function registerDesktopConnectProtocol(): void {
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(STUDI_CONNECT_PROTOCOL);
    return;
  }
  const entry = process.argv[1];
  if (process.defaultApp && entry) {
    app.setAsDefaultProtocolClient(STUDI_CONNECT_PROTOCOL, process.execPath, [resolve(entry)]);
  }
}

function queueDesktopConnect(): void {
  pendingDesktopConnect = true;
  openMainWindow();
  if (app.isReady() && authCoordinator) void finishPendingDesktopConnect();
}

async function finishPendingDesktopConnect(): Promise<void> {
  if (!pendingDesktopConnect || !authCoordinator) return;
  pendingDesktopConnect = false;
  openMainWindow();
  const current = authCoordinator.state();
  if (current.status === "approved" || current.status === "offline") return;
  const state = await authCoordinator.signIn();
  observeAuthState(state);
  await synchronizeProtectedRuntime(state);
}
