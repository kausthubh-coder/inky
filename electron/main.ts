import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  Tray,
  WebContentsView,
  ipcMain,
  nativeImage,
  safeStorage,
  screen,
  session as electronSession,
  shell,
} from "electron";
import squirrelStartup from "electron-squirrel-startup";

import {
  CONTRACT_MANIFEST,
  ContractManifestSchema,
  RuntimeInfoSchema,
  STUDI_SCHEMA_VERSION,
  browserDriver,
  classifyAgentRuntimeAttention,
  createIpcHandlerRegistrations,
  projectProtectedAuthState,
  studiIpcMethods,
  studiIpcRegistry,
  type ContractManifest,
  type AuthState,
  type LifecycleState,
  type RuntimeInfo,
  type SchoolOnboardingState,
  type StudiIpcHandlers,
  type BrowserLayoutMode,
  type LibraryState,
  type ProductSettingsState,
  type TaskDetail,
  type Task,
  type AgentReasoningEffort,
  transitionTask,
} from "../shared/index.js";
import { getDevelopmentUrl } from "./development-url.js";
import { buildDiagnosticsSnapshot, writeDiagnosticsSnapshot } from "./diagnostics.js";
import { AuthCoordinator } from "./auth/coordinator.js";
import { AuthVault } from "./auth/vault.js";
import { PiAgentRuntime } from "./agent/runtime.js";
import { OpenAiCodexLoginAttemptOwner } from "./agent/provider-login.js";
import { AssignmentExecutionCoordinator, type ExecutionNotification } from "./assignment/coordinator.js";
import { BrowserController } from "./browser/controller.js";
import { DriveOverlay, SCHOOL_PANE_RADIUS } from "./browser/drive-overlay.js";
import { VisibleBrowserWork } from "./browser/work-ownership.js";
import { AppKernel } from "./lifecycle/kernel.js";
import { ManagerCoordinator } from "./manager/coordinator.js";
import { SchoolScanCoordinator } from "./scan/coordinator.js";
import { type LocalStore, openLocalStore } from "./storage/index.js";
import { loadTelemetryPublicConfig } from "./telemetry/config.js";
import { TelemetryService } from "./telemetry/service.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const preloadPath = join(moduleDirectory, "preload.cjs");
const rendererPath = resolve(moduleDirectory, "..", "client", "index.html");
const appIconPath = app.isPackaged
  ? join(process.resourcesPath, "studi-inky.png")
  : resolve(moduleDirectory, "..", "..", "assets", "studi-inky.png");
const isSelfTest = process.env.STUDI_SELF_TEST === "1";
const uiScenario = isSelfTest ? process.env.STUDI_UI_SCENARIO : undefined;
const selfTestDirectory = resolve(
  process.env.STUDI_SELF_TEST_USER_DATA ?? join(tmpdir(), `studi-wp00-self-test-${process.pid}`),
);
const selfTestConfigured = configureSelfTest();
const canStart = selfTestConfigured && !squirrelStartup && app.requestSingleInstanceLock();
let selfTestFinished = false;
let localStore: LocalStore | null = null;
let storageSelfTestObservation: StorageSelfTestObservation | null = null;
let agentSelfTestObservation: AgentSelfTestObservation | null = null;
let browserSelfTestObservation: BrowserSelfTestObservation | null = null;
let browserController: BrowserController | null = null;
let browserView: WebContentsView | null = null;
let driveOverlay: DriveOverlay | null = null;
let browserLayoutMode: BrowserLayoutMode = "hidden";
let agentRuntime: PiAgentRuntime | null = null;
let runtimeLoginAttempt: OpenAiCodexLoginAttemptOwner | null = null;
let managerCoordinator: ManagerCoordinator | null = null;
let visibleBrowserWork: VisibleBrowserWork | null = null;
let schoolScanCoordinator: SchoolScanCoordinator | null = null;
let assignmentExecutionCoordinator: AssignmentExecutionCoordinator | null = null;
let appKernel: AppKernel | null = null;
let mainWindow: BrowserWindow | null = null;
let authCoordinator: AuthCoordinator | null = null;
let telemetryService: TelemetryService | null = null;
let gateTray: Tray | null = null;
let gateQuitting = false;
let telemetryShutdownFinished = false;
const pendingNotifications: ExecutionNotification[] = [];

const selfTestAuthState: AuthState = {
  status: "approved",
  user: { subject: "self-test-user", email: "self-test@studi.local", name: "Self test" },
  entitlement: { plan: "beta", credits: 0 },
  deviceId: "00000000-0000-4000-8000-000000000010",
  secureStorage: true,
};

interface StorageSelfTestObservation {
  readonly driver: "node:sqlite";
  readonly node: string;
  readonly schemaVersion: 4;
  readonly fileBacked: boolean;
  readonly reopened: boolean;
  readonly artifactRoundTrip: boolean;
  readonly backupValidated: boolean;
  readonly backupArtifactCount: number;
}

interface AgentSelfTestObservation {
  readonly runtime: "pi-agent-session";
  readonly sdkVersion: string;
  readonly sessionPersisted: boolean;
  readonly sessionResumed: boolean;
  readonly probeCompleted: boolean;
  readonly activeTools: readonly string[];
  readonly providerStatus: {
    readonly schemaVersion: 1;
    readonly providerId: string;
    readonly providerName: string;
    readonly state: "ready" | "needs_login" | "unavailable";
    readonly loginMethods: readonly ("api_key" | "oauth")[];
    readonly reason: string;
  };
}

interface BrowserSelfTestObservation {
  readonly view: "web-contents-view";
  readonly source: "visible-school-browser";
  readonly url: "about:blank";
  readonly bounded: boolean;
  readonly revision: number;
  readonly telemetryIsolated: boolean;
}

interface OnboardingUiSelfTestObservation {
  readonly fableConversation: boolean;
  readonly browserHandoff: boolean;
  readonly scanAction: boolean;
  readonly passwordFieldCount: number;
}

interface UiQualitySelfTestObservation {
  readonly mainLandmarkCount: number;
  readonly interactiveCount: number;
  readonly focusMoved: true;
}

interface LifecycleSelfTestObservation {
  readonly singleInstanceLock: true;
  readonly closeHides: true;
  readonly trayOpenHandled: true;
}

const ipcHandlers: StudiIpcHandlers = {
  getRuntimeInfo: () => {
    if (isSelfTest && process.env.STUDI_SELF_TEST_MALFORMED_RUNTIME_RESULT === "1") {
      return {
        app: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
      } as unknown as RuntimeInfo;
    }
    return {
      app: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    };
  },
  getContractManifest: () => {
    if (isSelfTest && process.env.STUDI_SELF_TEST_MALFORMED_MANIFEST_RESULT === "1") {
      return {
        ...CONTRACT_MANIFEST,
        schemaVersion: 999,
      } as unknown as ContractManifest;
    }
    return CONTRACT_MANIFEST;
  },
  getAuthState: () => currentAuthState(),
  signIn: async () => {
    if (isSelfTest) return selfTestAuthState;
    const state = await requireAuthCoordinator().signIn();
    observeAuthState(state);
    await synchronizeProtectedRuntime(state);
    return state;
  },
  signOut: async () => {
    if (isSelfTest) return selfTestAuthState;
    disposeProtectedRuntime();
    ensureGateTray();
    const state = await requireAuthCoordinator().signOut();
    observeAuthState(state);
    return state;
  },
  retryEntitlement: async () => {
    if (isSelfTest) return selfTestAuthState;
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
  getWorkspaceState: () => readWorkspaceState(),
  navigateBrowser: async ({ url }) => {
    await requireBrowserController().navigate(url);
    requireTelemetryService().capture("studi_onboarding_step", { step: "school_browser_opened" });
    return readWorkspaceState();
  },
  loginOpenAiCodex: async () => {
    requireRuntimeLoginAttempt().start();
    return readWorkspaceState();
  },
  cancelOpenAiCodexLogin: async () => {
    requireRuntimeLoginAttempt().cancel();
    return readWorkspaceState();
  },
  selectAgentModel: async ({ modelId, reasoningEffort }) => {
    const runtime = requireAgentRuntime();
    runtime.selectModel("openai-codex", modelId);
    runtime.setReasoningEffort(reasoningEffort);
    await persistAgentRuntimeChoice(modelId, reasoningEffort);
    await requireManagerCoordinator().replaceManagerSession();
    return readWorkspaceState();
  },
  getManagerState: () => requireManagerCoordinator().state(),
  runManager: async ({ prompt, memoryArtifactIds }) => {
    const provider = await requireAgentRuntime().getProviderStatus("openai-codex");
    const attention = classifyAgentRuntimeAttention(provider);
    if (attention === "usage") {
      throw new Error("ChatGPT usage ran out. Wait for more usage or connect another ChatGPT, then try again.");
    }
    if (attention === "needs_login") {
      throw new Error("Codex needs another ChatGPT login before the work manager can run.");
    }
    if (provider.state !== "ready") {
      throw new Error("Connect the Codex subscription before starting the work manager");
    }
    const result = await requireManagerCoordinator().runManagerTurn(prompt, memoryArtifactIds);
    captureQueueTransition("manager_turn", requireAppKernel().state());
    return result;
  },
  getSchoolOnboardingState: () => requireSchoolScanCoordinator().state(),
  saveSchoolProfile: async (input) => {
    const state = await requireSchoolScanCoordinator().saveProfile(input);
    requireAppKernel().configureSchedule(input.scanCadence);
    requireTelemetryService().capture("studi_onboarding_step", { step: "profile_saved", cadence: input.scanCadence });
    return state;
  },
  startSchoolScan: async () => {
    await requireReadyProviderForScan();
    return runScanWithTelemetry("start", () => requireSchoolScanCoordinator().startScan());
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
    await requireAssignmentExecutionCoordinator().startNext();
    const state = requireAppKernel().state();
    captureQueueTransition("assignment_start", state);
    return state;
  },
  resumeAssignment: async ({ taskId }) => {
    await requireReadyProviderForScan();
    await requireAssignmentExecutionCoordinator().resume(taskId);
    const state = requireAppKernel().state();
    captureQueueTransition("assignment_resume", state);
    return state;
  },
  verifyStudentSubmission: async ({ taskId, confirmationText }) => {
    await requireAssignmentExecutionCoordinator().verifyStudentSubmission(taskId, confirmationText);
    const state = requireAppKernel().state();
    captureQueueTransition("submission_verify", state);
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
      updatedAt: new Date().toISOString(),
    });
    requireAssignmentExecutionCoordinator().configureReviewHandoff(preferences.reviewMinutes, preferences.handoffMinutes);
    return preferences;
  },
  savePermissionRule: async (input) => {
    requireLocalStore().permissionRules.put({
      ...input,
      schemaVersion: STUDI_SCHEMA_VERSION,
      ruleId: input.ruleId ?? `setting-${randomUUID()}`,
      updatedAt: new Date().toISOString(),
    });
    return readProductSettings();
  },
  deletePermissionRule: async ({ ruleId }) => {
    requireLocalStore().permissionRules.delete(ruleId);
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
  setBrowserLayout: ({ mode }) => {
    browserLayoutMode = mode;
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
  captureUiTelemetry: ({ section }) =>
    requireTelemetryService().capture("studi_dashboard_viewed", { section }),
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
      try {
        return await registration.handle(rawRequest);
      } catch (error) {
        telemetryService?.captureError(error, "ipc", "ipc_request");
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
    backgroundColor: "#fbf7ec",
    icon: loadAppIcon(),
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  window.on("close", (event) => {
    if (!appKernel && !gateQuitting) {
      event.preventDefault();
      window.hide();
    }
  });

  if (isSelfTest) {
    window.webContents.once("did-finish-load", () => {
      void runSelfTest(window);
    });
    window.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (isMainFrame) {
          finishSelfTestFailure(
            `renderer load failed (${errorCode}): ${errorDescription}; target=${validatedUrl}`,
          );
        }
      },
    );
  } else {
    window.once("ready-to-show", () => {
    });
  }
  mainWindow = window;

  return window;
}

function initializeAuthCoordinator(): void {
  if (isSelfTest) return;
  authCoordinator = new AuthCoordinator({
    vault: new AuthVault(join(app.getPath("userData"), "studi-auth"), safeStorage),
    openExternal: (url) => shell.openExternal(url),
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
  const config = isSelfTest
    ? { host: "https://us.i.posthog.com" as const }
    : loadTelemetryPublicConfig(app.isPackaged);
  telemetryService = new TelemetryService({
    ...config,
    appVersion: app.getVersion(),
    platform: process.platform,
    settingsPath: join(app.getPath("userData"), "telemetry-settings.json"),
  });
  telemetryService.capture("studi_app_started", { launch: "desktop" });
}

function observeAuthState(state: AuthState): void {
  if ("user" in state) requireTelemetryService().identifyClerk(state.user.subject);
  requireTelemetryService().capture("studi_auth_gate", {
    status: state.status,
    ...(state.status === "denied" ? { reason: state.reason } : {}),
    ...(state.status === "error" ? { reason: "unavailable" as const } : {}),
  });
}

function currentAuthState(): AuthState {
  if (isSelfTest) return selfTestAuthState;
  return projectProtectedAuthState(authCoordinator?.state() ?? { status: "checking" }, appKernel !== null);
}

function ensureGateTray(): void {
  if (isSelfTest || gateTray) return;
  gateTray = new Tray(loadAppIcon());
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
    if (isSelfTest) {
      finishSelfTestFailure(`renderer load rejected: ${formatError(error)}`);
    } else {
      process.stderr.write(`STUDI_RENDERER_LOAD_FAILED ${formatError(error)}\n`);
    }
  });
}

function createSchoolBrowser(window: BrowserWindow): void {
  const schoolSession = electronSession.fromPartition("persist:studi-school", {
    cache: true,
  });
  const view = new WebContentsView({
    webPreferences: {
      session: schoolSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  browserView = view;
  browserController = new BrowserController(view.webContents);
  view.setBorderRadius(SCHOOL_PANE_RADIUS);
  window.contentView.addChildView(view);
  driveOverlay = new DriveOverlay(window);

  layoutSchoolBrowser();
  window.on("resize", layoutSchoolBrowser);
  setInterval(() => {
    if (browserLayoutMode === "hidden") {
      driveOverlay?.setStudentHover(false);
      return;
    }
    driveOverlay?.setStudentHover(studentCursorOverSchool());
    driveOverlay?.setDriver(currentBrowserDriver());
  }, 80);

  view.webContents.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) {
      browserController?.pageChanged();
    }
  });
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      void view.webContents.loadURL(url);
    }
    return { action: "deny" };
  });
  void view.webContents.loadURL("about:blank");
}

function layoutSchoolBrowser(): void {
  const window = mainWindow;
  const view = browserView;
  if (!window || window.isDestroyed() || !view) return;
  if (browserLayoutMode === "hidden") {
    view.setVisible(false);
    driveOverlay?.layout(null);
    return;
  }
  const [width = 1120, height = 760] = window.getContentSize();
  const bounds = schoolBrowserBounds(browserLayoutMode, width, height);
  view.setBounds(bounds);
  view.setBorderRadius(SCHOOL_PANE_RADIUS);
  view.setVisible(true);
  driveOverlay?.layout(bounds);
  driveOverlay?.setStudentHover(studentCursorOverSchool());
  driveOverlay?.setDriver(currentBrowserDriver());
}

function studentCursorOverSchool(): boolean {
  const window = mainWindow;
  const view = browserView;
  if (!window || window.isDestroyed() || !view || browserLayoutMode === "hidden") return false;
  const bounds = view.getBounds();
  const content = window.getContentBounds();
  const point = screen.getCursorScreenPoint();
  const x = point.x - content.x;
  const y = point.y - content.y;
  return x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height;
}

function schoolBrowserBounds(
  mode: Exclude<BrowserLayoutMode, "hidden">,
  width: number,
  height: number,
): Electron.Rectangle {
  if (mode === "onboarding") {
    const conversationWidth = Math.round(width * (0.92 / 2.1));
    const gapLeft = 20;
    const gapTop = 24;
    const edge = 10;
    const x = conversationWidth + gapLeft;
    const y = gapTop;
    return { x, y, width: Math.max(300, width - x - edge), height: Math.max(300, height - y - edge) };
  }
  const start = Math.round(width * 0.52);
  return { x: start, y: 76, width: Math.max(300, width - start - 18), height: Math.max(300, height - 94) };
}

function currentBrowserDriver() {
  const scan = localStore?.school.latestScan();
  const execution = localStore?.lifecycle.getActiveExecution();
  return browserDriver({
    layout: browserLayoutMode,
    ...(scan ? { scanState: scan.state } : {}),
    ...(execution ? { executionPhase: execution.phase } : {}),
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
  if (isSelfTest && process.env.STUDI_SELF_TEST_RENDERER_FAILURE === "1") {
    return window.loadFile(join(moduleDirectory, "__missing_renderer__.html"));
  }

  const developmentUrl = getDevelopmentUrl({
    isPackaged: app.isPackaged,
    switchValue: app.commandLine.getSwitchValue("studi-development-url"),
  });
  return developmentUrl ? window.loadURL(developmentUrl) : window.loadFile(rendererPath);
}

async function runSelfTest(window: BrowserWindow): Promise<void> {
  if (selfTestFinished) {
    return;
  }

  try {
    const rendererObservation: unknown = await window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("app-ready marker timed out")), 5000);
        const inspect = async () => {
          const marker = document.querySelector('[data-studi-app-ready="true"]');
          if (!marker) return;
          window.clearTimeout(timeout);
          observer.disconnect();
          try {
            const [runtime, manifest] = await Promise.all([
              window.studi.getRuntimeInfo(),
              window.studi.getContractManifest(),
            ]);
            const focusTarget = document.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled])');
            if (focusTarget instanceof HTMLElement) focusTarget.focus();
            resolve({
              marker: true,
              runtime,
              manifest,
              onboardingUi: {
                fableConversation: Boolean(document.querySelector('.fable-window .fable-speech')),
                browserHandoff: Boolean(document.querySelector('.fable-stage.with-browser')),
                scanAction: Boolean(document.querySelector('[data-app-control="start-scan"]')),
                passwordFieldCount: document.querySelectorAll('input[type="password"]').length,
              },
              uiQuality: {
                mainLandmarkCount: document.querySelectorAll('main').length,
                interactiveCount: document.querySelectorAll('button, input, select, textarea, a[href]').length,
                focusMoved: focusTarget instanceof HTMLElement && document.activeElement === focusTarget,
              },
            });
          } catch (error) {
            reject(error);
          }
        };
        const observer = new MutationObserver(() => void inspect());
        observer.observe(document.documentElement, { childList: true, subtree: true });
        void inspect();
      })
    `);

    if (!rendererObservation || typeof rendererObservation !== "object") {
      throw new Error("self-test returned an invalid renderer observation");
    }
    if (process.env.STUDI_UI_CAPTURE_PATH) {
      const viewport = /^(\d{3,4})x(\d{3,4})$/.exec(process.env.STUDI_UI_VIEWPORT ?? "1120x760");
      if (!viewport) throw new Error("STUDI_UI_VIEWPORT must look like 1120x760");
      window.setContentSize(Number(viewport[1]), Number(viewport[2]));
      window.show();
      if (process.env.STUDI_UI_CAPTURE_SCREEN) {
        const screen = JSON.stringify(process.env.STUDI_UI_CAPTURE_SCREEN);
        const navigated = await window.webContents.executeJavaScript(`
          (() => {
            const label = ${screen};
            const button = [...document.querySelectorAll('nav button')].find((item) => item.textContent?.trim() === label);
            if (!button) return false;
            button.click();
            return true;
          })()
        `);
        if (!navigated) throw new Error(`Could not navigate to UI capture screen ${process.env.STUDI_UI_CAPTURE_SCREEN}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 450));
      const capture = await window.webContents.capturePage();
      writeFileSync(process.env.STUDI_UI_CAPTURE_PATH, capture.toPNG());
    }
    const browserSnapshot = await requireBrowserController().snapshot();
    browserSelfTestObservation = {
      view: "web-contents-view",
      source: "visible-school-browser",
      url: "about:blank",
      bounded: browserSnapshot.elements.length <= 80 && browserSnapshot.text.length <= 8_000,
      revision: browserSnapshot.revision,
      telemetryIsolated: await requireSchoolBrowserTelemetryIsolation(),
    };
    const closeCount = requireAppKernel().lifecycleReceipt().closeInterceptions;
    window.close();
    const hiddenAfterClose = await waitForWindowVisibility(window, false);
    const closeHides = hiddenAfterClose && !window.isDestroyed() && requireAppKernel().lifecycleReceipt().closeInterceptions === closeCount + 1;
    const openCount = requireAppKernel().lifecycleReceipt().openRequests;
    requireAppKernel().open();
    const trayOpenHandled = requireAppKernel().lifecycleReceipt().openRequests === openCount + 1 && !window.isDestroyed();
    const lifecycle: LifecycleSelfTestObservation = {
      singleInstanceLock: app.hasSingleInstanceLock() as true,
      closeHides: closeHides as true,
      trayOpenHandled: trayOpenHandled as true,
    };
    const observation: unknown = {
      ...(rendererObservation as Record<string, unknown>),
      storage: storageSelfTestObservation,
      agent: agentSelfTestObservation,
      browser: browserSelfTestObservation,
      lifecycle,
    };
    if (!isSuccessfulObservation(observation)) {
      throw new Error(`self-test returned an invalid observation: ${JSON.stringify(observation)}`);
    }

    selfTestFinished = true;
    process.stdout.write(`STUDI_SELF_TEST ${JSON.stringify(observation)}\n`);
    app.quit();
  } catch (error) {
    finishSelfTestFailure(formatError(error));
  }
}

async function waitForWindowVisibility(window: BrowserWindow, visible: boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (!window.isDestroyed() && window.isVisible() === visible) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

function isSuccessfulObservation(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record.marker === true &&
    RuntimeInfoSchema.safeParse(record.runtime).success &&
    ContractManifestSchema.safeParse(record.manifest).success &&
    isSuccessfulStorageObservation(record.storage) &&
    isSuccessfulAgentObservation(record.agent) &&
    isSuccessfulBrowserObservation(record.browser) &&
    isSuccessfulLifecycleObservation(record.lifecycle) &&
    isSuccessfulOnboardingUiObservation(record.onboardingUi) &&
    isSuccessfulUiQualityObservation(record.uiQuality)
  );
}

function isSuccessfulUiQualityObservation(value: unknown): value is UiQualitySelfTestObservation {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.mainLandmarkCount === 1 &&
    typeof record.interactiveCount === "number" && record.interactiveCount >= 2 &&
    record.focusMoved === true;
}

function isSuccessfulLifecycleObservation(value: unknown): value is LifecycleSelfTestObservation {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.singleInstanceLock === true && record.closeHides === true && record.trayOpenHandled === true;
}

function isSuccessfulOnboardingUiObservation(
  value: unknown,
): value is OnboardingUiSelfTestObservation {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.passwordFieldCount !== 0) return false;
  if (uiScenario === "partial-dashboard" || uiScenario === "desk-handoff") return true;
  if (uiScenario === "onboarding-welcome") return record.fableConversation === true && record.browserHandoff === false && record.scanAction === false;
  return record.fableConversation === true && record.browserHandoff === true && record.scanAction === true;
}

function seedProductUiScenario(store: LocalStore, scenario: "partial-dashboard" | "desk-handoff"): void {
  const now = "2026-09-01T14:00:00.000Z";
  const scanId = "ui-scenario-partial-scan";
  const source = "https://school.example.edu/courses/calculus";
  const evidence = {
    schemaVersion: STUDI_SCHEMA_VERSION,
    evidenceId: "ui-scenario-evidence",
    reference: "ui-scenario-evidence",
    kind: "text_snapshot" as const,
    sourceTarget: source,
    capturedAt: now,
    summary: "Visible controlled school page retained for UI verification.",
  };
  store.school.putScan({
    schemaVersion: STUDI_SCHEMA_VERSION,
    scanId,
    kind: "first_scan",
    state: "partial",
    startedAt: now,
    updatedAt: now,
    completedAt: now,
    currentStep: "Three verified assignments retained; one linked system still needs sign-in.",
    coverage: [
      { target: "Calculus", status: "verified", evidence },
      { target: "Linked homework system", status: "partial", failure: "The linked system asked for a separate sign-in." },
    ],
    failures: ["The linked homework system is not yet covered."],
    handoff: null,
    observedCourseIds: ["course-calculus"],
    observedAssignmentIds: ["assignment-problems", "assignment-quiz", "assignment-reflection"],
    observedLinkedSystemIds: ["linked-homework"],
  });
  store.school.putCourse({
    schemaVersion: STUDI_SCHEMA_VERSION,
    courseId: "course-calculus",
    label: "Calculus II",
    sourceTarget: source,
    lastVerifiedScanId: scanId,
    lastVerifiedAt: now,
    evidence,
  });
  const assignments = [
    ["assignment-problems", "Problem set 4", "2026-09-02T22:00:00.000Z"],
    ["assignment-quiz", "Sequences quiz", "2026-09-03T18:30:00.000Z"],
    ["assignment-reflection", "Weekly reflection", "2026-09-04T21:00:00.000Z"],
  ] as const;
  for (const [assignmentId, title, dueAt] of assignments) {
    store.assignments.put({ schemaVersion: STUDI_SCHEMA_VERSION, assignmentId, courseId: "course-calculus", title, sourceTarget: `${source}/${assignmentId}`, dueAt, discoveredAt: now, lastVerifiedScanId: scanId, evidence: [evidence] });
  }
  store.permissionRules.put({ schemaVersion: STUDI_SCHEMA_VERSION, ruleId: "ui-scenario-global-rule", scope: "global", mode: "attempt", updatedAt: now });
  const taskId = "task-problems";
  const created = { schemaVersion: STUDI_SCHEMA_VERSION, taskId, assignmentId: "assignment-problems", state: "discovered" as const, revision: 0, createdAt: now, updatedAt: now };
  store.tasks.append({
    expectedRevision: null,
    projection: created,
    event: { schemaVersion: STUDI_SCHEMA_VERSION, eventId: "event-problems-created", aggregateType: "task", aggregateId: taskId, runId: "run-problems", sequence: 0, occurredAt: now, type: "task_created", payload: { taskId, assignmentId: created.assignmentId, state: "discovered", revision: 0, createdAt: now, updatedAt: now } },
  });
  let current: Task = created;
  const transition = (to: "queued" | "working" | "needs_user", sequence: number, reason: string) => {
    const result = transitionTask(current, { type: "transition", to, eventId: `event-problems-${to}`, runId: "run-problems", sequence, occurredAt: new Date(Date.parse(now) + sequence * 1_000).toISOString(), reason });
    if (!result.ok) throw new Error(`UI scenario transition rejected: ${result.rejection.code}`);
    current = result.task;
    store.tasks.append({ expectedRevision: current.revision - 1, projection: current, event: result.event });
  };
  transition("queued", 1, "Queued by the deterministic UI scenario");
  if (scenario === "desk-handoff") {
    transition("working", 2, "Visible browser worker started");
    transition("needs_user", 3, "The linked homework system needs the student to sign in");
    store.lifecycle.putExecution({ schemaVersion: STUDI_SCHEMA_VERSION, taskId, assignmentId: "assignment-problems", phase: "needs_user", taskBudget: { maxAgentTurns: 1, maxRecoveryAttempts: 2 }, attemptCount: 1, returnPredicate: "The linked homework page shows the signed-in student account.", lastError: "Please sign in to the linked homework system in the visible browser.", updatedAt: "2026-09-01T14:00:03.000Z" });
    store.lifecycle.addAttempt({ schemaVersion: STUDI_SCHEMA_VERSION, taskId, ordinal: 1, plan: "Open the linked homework page from the verified assignment.", result: "The page required a separate student sign-in.", evidence: { revision: 3, url: `${source}/assignment-problems`, title: "Linked homework sign-in", capturedAt: "2026-09-01T14:00:02.000Z", summary: "Sign-in page visible; no school credentials were read." }, recordedAt: "2026-09-01T14:00:02.000Z" });
  }
}

function isSuccessfulBrowserObservation(value: unknown): value is BrowserSelfTestObservation {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.view === "web-contents-view" &&
    record.source === "visible-school-browser" &&
    record.url === "about:blank" &&
    record.bounded === true &&
    typeof record.revision === "number" &&
    record.revision >= 1 &&
    record.telemetryIsolated === true
  );
}

function isSuccessfulAgentObservation(value: unknown): value is AgentSelfTestObservation {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const providerStatus = record.providerStatus;
  return (
    record.runtime === "pi-agent-session" &&
    record.sdkVersion === "0.84.4" &&
    record.sessionPersisted === true &&
    record.sessionResumed === true &&
    record.probeCompleted === true &&
    Array.isArray(record.activeTools) &&
    record.activeTools.length === 1 &&
    record.activeTools[0] === "studi_probe" &&
    !!providerStatus &&
    typeof providerStatus === "object" &&
    (providerStatus as Record<string, unknown>).providerId === "unknown" &&
    (providerStatus as Record<string, unknown>).state === "unavailable"
  );
}

function isSuccessfulStorageObservation(value: unknown): value is StorageSelfTestObservation {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.driver === "node:sqlite" &&
    record.node === process.versions.node &&
    record.schemaVersion === 4 &&
    record.fileBacked === true &&
    record.reopened === true &&
    record.artifactRoundTrip === true &&
    record.backupValidated === true &&
    record.backupArtifactCount === 1
  );
}

async function initializeStorage(): Promise<void> {
  const dataRoot = join(app.getPath("userData"), "studi-data");
  localStore = await openLocalStore(dataRoot, {
    migrationBackup: {
      directory: join(app.getPath("userData"), "studi-migration-backups"),
      appVersion: app.getVersion(),
    },
  });
  if (uiScenario === "partial-dashboard" || uiScenario === "desk-handoff") seedProductUiScenario(localStore, uiScenario);
  if (uiScenario && uiScenario !== "onboarding-welcome") {
    localStore.school.putProfile({
      schemaVersion: STUDI_SCHEMA_VERSION,
      profileId: "primary-school",
      studentName: "Self Test",
      schoolRoot: "https://school.example.edu",
      defaultPermission: "attempt",
      scanCadence: "daily",
      onboardingState: "profile_saved",
      missedCourseFeedback: [],
      updatedAt: "2026-08-31T12:00:00.000Z",
    });
  }
  if (!isSelfTest) {
    return;
  }

  const assignment = {
    schemaVersion: 1 as const,
    assignmentId: "electron-self-test-assignment",
    courseId: "electron-self-test-course",
    title: "Electron storage self-test",
    sourceTarget: "https://school.example.edu/assignments/electron-self-test",
    discoveredAt: "2026-08-31T12:00:00.000Z",
    evidence: [],
  };
  const artifact = {
    frontmatter: {
      schemaVersion: 1 as const,
      kind: "preference" as const,
      artifactId: "electron-self-test-preference",
      updatedAt: "2026-08-31T12:00:00.000Z",
    },
    content: "Electron storage round trip",
  };
  localStore.assignments.put(assignment);
  await localStore.artifacts.write(artifact);
  localStore.close();
  localStore = await openLocalStore(dataRoot);
  const reopened = localStore.assignments.get(assignment.assignmentId);
  const reopenedArtifact = await localStore.artifacts.read(
    artifact.frontmatter.kind,
    artifact.frontmatter.artifactId,
  );
  const backupDirectory = join(app.getPath("userData"), "studi-storage-self-test-backup");
  const backup = await localStore.backup(backupDirectory);
  storageSelfTestObservation = {
    driver: "node:sqlite",
    node: process.versions.node,
    schemaVersion: localStore.health().schemaVersion,
    fileBacked: localStore.databasePath !== ":memory:" && existsSync(localStore.databasePath),
    reopened: reopened?.assignmentId === assignment.assignmentId,
    artifactRoundTrip: reopenedArtifact?.content === artifact.content,
    backupValidated: backup.schemaVersion === 4,
    backupArtifactCount: backup.artifactCount,
  };
}

async function initializeAgentSelfTest(): Promise<void> {
  if (!isSelfTest) {
    return;
  }
  const dataRoot = join(app.getPath("userData"), "studi-data");
  const [runtimeModule, codingAgentModule, piAiModule] = await Promise.all([
    import("./agent/runtime.js"),
    import("@earendil-works/pi-coding-agent"),
    import("@earendil-works/pi-ai"),
  ]);
  const { PiAgentRuntime } = runtimeModule;
  const modelRuntime = await codingAgentModule.ModelRuntime.create({
    credentials: new piAiModule.InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
    signal: AbortSignal.timeout(3_000),
  });
  const faux = piAiModule.fauxProvider({
    provider: "studi-electron-faux",
    api: "studi-electron-faux",
    tokenSize: { min: 100, max: 100 },
  });
  modelRuntime.registerNativeProvider(faux.provider);
  faux.setResponses([
    piAiModule.fauxAssistantMessage(
      piAiModule.fauxToolCall("studi_probe", {}, { id: "electron-studi-probe" }),
      { stopReason: "toolUse" },
    ),
    piAiModule.fauxAssistantMessage("Electron probe complete."),
  ]);
  const runtime = await PiAgentRuntime.create({
    cwd: dataRoot,
    agentDir: join(dataRoot, "pi"),
    modelRuntime,
    model: faux.getModel(),
  });
  const session = await runtime.createSession();
  try {
    const events: Array<{ readonly type: string; readonly outcome?: string }> = [];
    session.subscribe((event) => {
      events.push(event);
    });
    await session.prompt("Run the Electron self-test probe.");
    const originalId = session.sessionId;
    const sessionPath = session.sessionPath;
    if (!sessionPath) {
      throw new Error("Pi did not persist the Electron self-test session");
    }
    await session.replace({ resumeSessionPath: sessionPath });
    agentSelfTestObservation = {
      runtime: "pi-agent-session",
      sdkVersion: PiAgentRuntime.sdkVersion,
      sessionPersisted: true,
      sessionResumed: session.sessionId === originalId,
      probeCompleted:
        events.some((event) => event.type === "tool_started") &&
        events.some((event) => event.type === "tool_finished") &&
        events.some((event) => event.type === "terminal" && event.outcome === "completed"),
      activeTools: session.toolNames,
      providerStatus: await runtime.getProviderStatus("studi-self-test-missing-provider"),
    };
  } finally {
    session.dispose();
  }
}

async function initializeDesktopAgent(): Promise<void> {
  const dataRoot = join(app.getPath("userData"), "studi-data");
  agentRuntime = await PiAgentRuntime.create({
    cwd: dataRoot,
    agentDir: join(dataRoot, "pi"),
    browserController: requireBrowserController(),
  });
  await applyPersistedAgentRuntime();
  runtimeLoginAttempt = new OpenAiCodexLoginAttemptOwner((signal, notify) =>
    requireAgentRuntime().loginOpenAiCodex("device_code", signal, {
      openExternal: (url) => shell.openExternal(url),
      notify,
    }),
  );
  managerCoordinator = await ManagerCoordinator.create(
    requireLocalStore(),
    agentRuntime,
    {
      startAssignment: async (taskId) => {
        return requireAssignmentExecutionCoordinator().start(taskId);
      },
    },
  );
  visibleBrowserWork = new VisibleBrowserWork(requireLocalStore());
  schoolScanCoordinator = new SchoolScanCoordinator(
    requireLocalStore(),
    agentRuntime,
    requireBrowserController(),
    { browserWork: requireVisibleBrowserWork(), manager: requireManagerCoordinator() },
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
  managerCoordinator?.dispose();
  managerCoordinator = null;
  visibleBrowserWork = null;
  agentRuntime = null;
  pendingNotifications.splice(0);
  if (browserView) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(browserView);
    if (!browserView.webContents.isDestroyed()) browserView.webContents.close();
  }
  browserView = null;
  browserController = null;
}

async function initializeAppKernel(window: BrowserWindow): Promise<void> {
  const productPreferences = await requireLocalStore().productPreferences.get();
  assignmentExecutionCoordinator = await AssignmentExecutionCoordinator.create(
    requireLocalStore(),
    requireManagerCoordinator(),
    requireBrowserController(),
    {
      browserWork: requireVisibleBrowserWork(),
      reviewWindowMs: productPreferences.reviewMinutes * 60_000,
      handoffWindowMs: productPreferences.handoffMinutes * 60_000,
      notify: (intent) => {
        observeExecutionNotification(intent);
        if (appKernel) return appKernel.notify(intent);
        pendingNotifications.push(intent);
      },
    },
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
        service.capture("studi_scan_started", { mode: "scheduled" });
        try {
          const result = await requireSchoolScanCoordinator().runScheduledScan(claimOccurrence, requireReadyProviderForScan);
          if (result) captureScanFinished("scheduled", result.state, startedAt);
          return result;
        } catch (error) {
          service.captureError(error, "scan", "school_scan");
          throw error;
        }
      },
      focusBrowser: () => browserView?.webContents.focus(),
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
  service.capture("studi_scan_started", { mode });
  try {
    const state = await run();
    captureScanFinished(mode, state, startedAt);
    if (state.scan?.state === "needs_user") service.capture("studi_handoff", { kind: "scan", state: "needs_user" });
    return state;
  } catch (error) {
    service.captureError(error, "scan", "school_scan");
    throw error;
  }
}

function captureScanFinished(
  mode: "start" | "resume" | "replay" | "scheduled",
  state: SchoolOnboardingState,
  startedAt: number,
): void {
  if (!state.scan) return;
  requireTelemetryService().capture("studi_scan_finished", {
    mode,
    state: state.scan.state,
    duration_ms: Math.max(0, Date.now() - startedAt),
    course_count: state.courses.length,
    assignment_count: state.assignments.length,
    linked_system_count: state.linkedSystems.length,
  });
}

function captureQueueTransition(
  action: "manager_turn" | "assignment_start" | "assignment_resume" | "submission_verify" | "schedule_pause" | "schedule_resume",
  state: LifecycleState,
): void {
  requireTelemetryService().capture("studi_queue_transition", {
    action,
    phase: state.execution?.phase ?? "idle",
    ...(state.execution ? { task_id: state.execution.taskId } : {}),
  });
}

function observeExecutionNotification(intent: ExecutionNotification): void {
  const service = requireTelemetryService();
  if (intent.kind === "handoff") service.capture("studi_handoff", { kind: "assignment", state: "needs_user" });
  if (intent.kind === "review_ready") service.capture("studi_review", { state: "ready_review" });
  if (intent.kind === "failure") service.captureError(new Error("assignment failed"), "queue", "assignment");
}

async function readWorkspaceState() {
  const runtime = requireAgentRuntime();
  if (uiScenario === "onboarding-ready" || uiScenario === "onboarding-welcome") {
    return {
      browser: { ...requireBrowserController().state, driver: currentBrowserDriver() },
      provider: {
        schemaVersion: STUDI_SCHEMA_VERSION,
        providerId: "openai-codex",
        providerName: "OpenAI Codex",
        state: "ready" as const,
        loginMethods: ["oauth" as const],
        reason: "Deterministic UI scenario is using the same typed provider projection.",
      },
      providerLogin: null,
      models: [{ id: runtime.selectedModelId, name: runtime.selectedModelId }],
      selectedModelId: runtime.selectedModelId,
      selectedReasoningEffort: runtime.selectedReasoningEffort,
    };
  }
  return {
    browser: { ...requireBrowserController().state, driver: currentBrowserDriver() },
    provider: await runtime.getProviderStatus("openai-codex"),
    providerLogin: runtimeLoginAttempt?.handoff ?? null,
    models: [...runtime.getProviderModels("openai-codex")],
    selectedModelId: runtime.selectedModelId,
    selectedReasoningEffort: runtime.selectedReasoningEffort,
  };
}

async function persistAgentRuntimeChoice(modelId: string, reasoningEffort: AgentReasoningEffort): Promise<void> {
  const store = requireLocalStore().productPreferences;
  const current = await store.get();
  await store.put({
    ...current,
    agentModelId: modelId,
    agentReasoningEffort: reasoningEffort,
    updatedAt: new Date().toISOString(),
  });
}

async function applyPersistedAgentRuntime(): Promise<void> {
  const runtime = requireAgentRuntime();
  const preferences = await requireLocalStore().productPreferences.get();
  try {
    runtime.selectModel("openai-codex", preferences.agentModelId);
  } catch {
    // Keep the catalog default when the saved id is not installed yet.
  }
  runtime.setReasoningEffort(preferences.agentReasoningEffort);
}

function requireRuntimeLoginAttempt(): OpenAiCodexLoginAttemptOwner {
  if (!runtimeLoginAttempt) {
    throw new Error("The Codex login service is not ready");
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

async function requireSchoolBrowserTelemetryIsolation(): Promise<boolean> {
  if (!browserView || browserView.webContents.isDestroyed()) return false;
  return browserView.webContents.executeJavaScript(
    "typeof globalThis.posthog === 'undefined' && typeof globalThis.studi === 'undefined'",
  ) as Promise<boolean>;
}

async function requireReadyProviderForScan(): Promise<void> {
  const provider = await requireAgentRuntime().getProviderStatus("openai-codex");
  const attention = classifyAgentRuntimeAttention(provider);
  if (attention === "usage") {
    throw new Error("ChatGPT usage ran out. Wait for more usage or connect another ChatGPT, then try again.");
  }
  if (attention === "needs_login") {
    throw new Error("Codex needs another ChatGPT login before scanning.");
  }
  if (provider.state !== "ready") {
    throw new Error("Connect the Codex subscription before scanning the school");
  }
}

function finishSelfTestFailure(message: string): void {
  if (selfTestFinished) {
    return;
  }
  selfTestFinished = true;
  process.exitCode = 1;
  process.stderr.write(`STUDI_SELF_TEST_FAILED ${message}\n`);
  app.exit(1);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertOwnedSelfTestDirectory(directory: string): void {
  const temporaryRoot = resolve(tmpdir());
  const isOwnedDirectory =
    dirname(directory) === temporaryRoot && basename(directory).startsWith("studi-wp00-self-test-");

  if (!isOwnedDirectory) {
    throw new Error("Self-test userData must be an owned directory under the system temp folder");
  }
}

function configureSelfTest(): boolean {
  if (!isSelfTest) {
    return true;
  }

  try {
    assertOwnedSelfTestDirectory(selfTestDirectory);
    app.disableHardwareAcceleration();
    app.setPath("userData", selfTestDirectory);
    return true;
  } catch (error) {
    process.stderr.write(`STUDI_SELF_TEST_CONFIGURATION_FAILED ${formatError(error)}\n`);
    app.exit(1);
    return false;
  }
}

if (canStart) {
  void app.whenReady().then(async () => {
    try {
      app.setAppUserModelId("com.squirrel.studi.Studi");
      initializeTelemetry();
      await initializeStorage();
      await initializeAgentSelfTest();
      const window = createWindow();
      initializeAuthCoordinator();
      if (isSelfTest) {
        createSchoolBrowser(window);
        await initializeDesktopAgent();
        await initializeAppKernel(window);
      } else {
        ensureGateTray();
      }
      registerIpcHandlers();
      startRenderer(window);
      if (!isSelfTest) {
        const state = await requireAuthCoordinator().start();
        observeAuthState(state);
        await synchronizeProtectedRuntime(state);
      }
    } catch (error) {
      if (isSelfTest) {
        finishSelfTestFailure(`startup initialization failed: ${formatError(error)}`);
      } else {
        process.stderr.write(`STUDI_STORAGE_START_FAILED ${formatError(error)}\n`);
        app.exit(1);
      }
    }
  });
}

if (selfTestConfigured && !canStart) app.quit();

app.on("second-instance", () => {
  if (appKernel) appKernel.open();
  else if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
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
