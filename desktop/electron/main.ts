import { windowChromeOptions } from "./window-chrome.js";
import { configureAppNavigation } from "./app-navigation.js";
import { UpdateService } from "./updates/service.js";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
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
  CONTRACT_MANIFEST,
  ContractManifestSchema,
  DEFAULT_NOTIFICATION_PREFERENCES,
  RuntimeInfoSchema,
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
  type ContractManifest,
  type AuthState,
  type LifecycleState,
  type RuntimeInfo,
  type SchoolOnboardingState,
  type StudiIpcHandlers,
  type BrowserLayoutMode,
  type SchoolPageBounds,
  type LibraryState,
  type ProductSettingsState,
  type TaskDetail,
  type Task,
  type AgentReasoningEffort,
  type UsageEventKind,
  type UsageState,
  transitionTask,
} from "../shared/index.js";
import { getDevelopmentUrl } from "./development-url.js";
import { buildDiagnosticsSnapshot, writeDiagnosticsSnapshot } from "./diagnostics.js";
import { AuthCoordinator } from "./auth/coordinator.js";
import { ProtectedRuntimeLifecycle } from "./auth/runtime-lifecycle.js";
import { findDesktopConnectUrl, isDesktopConnectUrl, STUDI_CONNECT_PROTOCOL } from "./auth/desktop-link.js";
import { AuthVault } from "./auth/vault.js";
import { PiAgentRuntime } from "./agent/runtime.js";
import { createConnectedAppTools } from "./agent/composio-tools.js";
import { ConversationCoordinator } from "./agent/conversation-coordinator.js";
import { projectConversationTimeline } from "./agent/conversation-timeline.js";
import { HomeworkCoordinator } from "./assignment/homework.js";
import { LearnRepository } from './storage/learn-records.js';
import { TutorCoordinator } from './agent/tutor-coordinator.js';
import { MemoryCoordinator } from './agent/memory-coordinator.js';
import { LearnExtractionWorker } from './agent/learn-extraction.js';
import { importLearnFile } from './agent/learn-import.js';
import { ProviderLoginAttemptOwner } from "./agent/provider-login.js";
import { AssignmentExecutionCoordinator, type ExecutionNotification } from "./assignment/coordinator.js";
import { startSelectedAssignment } from "./assignment/start-selected.js";
import { BrowserController } from "./browser/controller.js";
import { DriveOverlay, SCHOOL_PANE_RADIUS } from "./browser/drive-overlay.js";
import { VisibleBrowserWork } from "./browser/work-ownership.js";
import { AppKernel } from "./lifecycle/kernel.js";
import { ManagerCoordinator } from "./manager/coordinator.js";
import { SchoolScanCoordinator } from "./scan/coordinator.js";
import { type LocalStore, openLocalStore, STORAGE_SCHEMA_VERSION } from "./storage/index.js";
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
const isSelfTest = !app.isPackaged && process.env.STUDI_SELF_TEST === "1";
const uiScenario = isSelfTest ? process.env.STUDI_UI_SCENARIO : undefined;
const selfTestConnectedApps = [
  ["gmail", "20260902_00"], ["googledrive", "20260902_00"], ["googledocs", "20260826_00"],
  ["notion", "20260819_00"], ["github", "20260902_00"], ["canvas", "20260729_00"],
  ["googlecalendar", "20260902_00"], ["googlesheets", "20260902_00"], ["outlook", "20260903_00"],
  ["dropbox", "20260903_00"], ["slack", "20260826_00"], ["discord", "20260826_00"], ["todoist", "20260731_00"],
] as const;
const selfTestDirectory = resolve(
  process.env.STUDI_SELF_TEST_USER_DATA ?? join(tmpdir(), `studi-wp00-self-test-${process.pid}`),
);
const startupProfileConfigured = configureStartupProfile();
// The installed app owns a single-instance lock. Unpackaged development and QA
// runs use isolated profiles and must be able to coexist with that installation.
const ownsSingleInstance = !app.isPackaged || app.requestSingleInstanceLock();
const canStart = startupProfileConfigured && !squirrelStartup && ownsSingleInstance;
let selfTestFinished = false;
let localStore: LocalStore | null = null;
let storageSelfTestObservation: StorageSelfTestObservation | null = null;
let agentSelfTestObservation: AgentSelfTestObservation | null = null;
let browserSelfTestObservation: BrowserSelfTestObservation | null = null;
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
let homeworkCoordinator: HomeworkCoordinator | null = null;
let learnRepository: LearnRepository | null = null;
let tutorCoordinator: TutorCoordinator | null = null;
let memoryCoordinator: MemoryCoordinator | null = null;
let learnExtractionWorker: LearnExtractionWorker | null = null;
const protectedRuntimeLifecycle = new ProtectedRuntimeLifecycle(async (owner, isCurrent) => {
  const identity = isSelfTest ? selfTestAuthState : requireAuthCoordinator().state();
  if ((identity.status !== 'approved' && identity.status !== 'offline') || identity.user.subject !== owner) {
    throw new Error('Your account changed. Sign in to continue.');
  }
  const window = requireMainWindow();
  disposeGateTray();
  createSchoolBrowser(window);
  await initializeDesktopAgent();
  if (isCurrent()) await initializeAppKernel(window, isCurrent);
}, disposeProtectedRuntimeNow);
let tutorTimelineCache: {
  repository: LearnRepository; changes: number; entries: import('../shared/index.js').TimelineEntry[];
} | null = null;
let assignmentExecutionCoordinator: AssignmentExecutionCoordinator | null = null;
let appKernel: AppKernel | null = null;
let mainWindow: BrowserWindow | null = null;
let authCoordinator: AuthCoordinator | null = null;
let telemetryService: TelemetryService | null = null;
let gateTray: Tray | null = null;
let gateQuitting = false;
let updateService: UpdateService | null = null;
let pendingDesktopConnect = !isSelfTest && Boolean(findDesktopConnectUrl(process.argv));
let telemetryShutdownFinished = false;
let appShutdownFinished = false;
let appShutdown: Promise<void> | null = null;
const pendingNotifications: ExecutionNotification[] = [];
let assignmentRunStartedAt: number | null = null;

const selfTestAuthState: AuthState = {
  status: "approved",
  user: { subject: "self-test-user", email: "self-test@studi.local", name: "Self test" },
  entitlement: { plan: "beta", credits: 0 },
  deviceId: "00000000-0000-4000-8000-000000000010",
  secureStorage: true,
};

const selfTestUsageState: UsageState = {
  schemaVersion: STUDI_SCHEMA_VERSION,
  period: "2026-09",
  plan: "beta",
  tokenAllowance: 1_000_000,
  totalTokens: 284_600,
  inputTokens: 136_400,
  outputTokens: 71_200,
  cachedTokens: 77_000,
  toolCalls: 42,
  inkyTurns: 12,
  assignmentsWorked: 3,
  days: [
    { date: "2026-09-01", tokens: 48_200 },
    { date: "2026-09-02", tokens: 91_700 },
    { date: "2026-09-03", tokens: 62_300 },
    { date: "2026-09-04", tokens: 82_400 },
  ],
  updatedAt: "2026-09-04T16:00:00.000Z",
};

interface StorageSelfTestObservation {
  readonly driver: "node:sqlite";
  readonly node: string;
  readonly schemaVersion: typeof STORAGE_SCHEMA_VERSION;
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

function updates(): UpdateService {
  if (!updateService) {
    updateService = new UpdateService({platform:process.platform,arch:process.arch,packaged:app.isPackaged,version:app.getVersion(),firstRun:process.argv.includes('--squirrel-firstrun'),native:autoUpdater,
      blocked: () => {
        if (conversationCoordinator?.isBusy) return 'Finish or stop your reply before restarting.';
        if (learnRepository?.sessionSummaries().some(item => item.status === 'active')) return 'Pause your tutor before restarting.';
        if (learnRepository?.sources().some(item => item.status === 'reading')) return 'Wait for your syllabus to finish reading before restarting.';
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
    await disposeProtectedRuntime();
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
  getUsageState: () => isSelfTest ? selfTestUsageState : requireAuthCoordinator().usage(),
  getConnectedApps: async () => {
    if (isSelfTest) {
      return {
        configured: true,
        toolkits: selfTestConnectedApps.map(([toolkit, version]) => ({ toolkit, version, access: "all" as const })),
      };
    }
    return requireAuthCoordinator().connectedApps();
  },
  connectApp: async ({ toolkit }) => {
    if (isSelfTest) {
      return { toolkit, sessionId: "self-test", connectedAccountId: null, status: "INITIATED", redirectUrl: null };
    }
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
    if (isSelfTest) {
      return { toolkit, sessionId: "self-test", connectedAccountId: null, status: "DISCONNECTED", redirectUrl: null };
    }
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
    layoutSchoolBrowser();
    return readWorkspaceState();
  },
  completeProviderLogin: async ({ providerId, code }) => {
    requireRuntimeLoginAttempt().complete(providerId, code);
    return readWorkspaceState();
  },
  cancelProviderLogin: async () => {
    requireRuntimeLoginAttempt().cancel();
    layoutSchoolBrowser();
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
  getConversationTimeline: (input) => {
    requireConversationCoordinator();
    const store = requireLocalStore();
    const identity = isSelfTest ? selfTestAuthState : requireAuthCoordinator().state();
    const ownerSubject = identity.status === 'approved' || identity.status === 'offline' ? identity.user.subject : undefined;
    return projectConversationTimeline({
      jobs: store.agentJobs.list().map(record => record.job), scans: store.school.listScans(),
      assignments: store.assignments.listAll(),
      events: store.tasks.listAll().filter(task => ownerSubject && store.lifecycle.getExecution(task.taskId)?.ownerSubject === ownerSubject).flatMap(task => store.tasks.listEvents(task.taskId)),
      notes: store.notes.list(), ...(ownerSubject ? { ownerSubject } : {}),
      ...(input?.limit === undefined ? {} : { limit: input.limit }),
      tutorEntries: tutorTimelineEntries(requireLearnRepository()),
    });
  },
  correctAssignment: async (input) => {
    const result = await requireHomeworkCoordinator().correctAssignment(input);
    requireAppKernel().requestReconcile();
    return result;
  },
  getLearnState: (input) => currentLearnState(input?.selectedExamId),
  listMemories: () => requireMemoryCoordinator().list(),
  readMemory: ({ noteId }) => requireMemoryCoordinator().read(noteId),
  updateMemory: (input) => requireMemoryCoordinator().update(input),
  deleteMemory: (input) => requireMemoryCoordinator().delete(input),
  importLearnSource: (input) => {
    validateLearnCourse(input.courseId);
    requireLearnRepository().importSource({ ...input, kind: 'paste', sourceTarget: null });
    queueLearnExtraction();
    return currentLearnState();
  },
  importLearnFile: async ({ courseId }) => {
    validateLearnCourse(courseId);
    const repository = requireLearnRepository();
    const result = await dialog.showOpenDialog({
      title: 'Choose your syllabus', properties: ['openFile'],
      filters: [{ name: 'Syllabus', extensions: ['pdf', 'txt', 'md', 'csv'] }],
    });
    if (repository !== learnRepository) throw new Error('Your account changed. Choose the file again.');
    if (!result.canceled && result.filePaths[0]) {
      await importLearnFile(repository, result.filePaths[0], courseId, undefined, () => {
        if (repository !== learnRepository) throw new Error('Your account changed. Choose the file again.');
      });
      if (repository !== learnRepository) throw new Error('Your account changed. Sign in to continue.');
      queueLearnExtraction();
    }
    return currentLearnState();
  },
  setLearnExam: (input) => {
    validateLearnCourse(input.courseId);
    requireLearnRepository().setExam(input);
    return currentLearnState();
  },
  findLearnSyllabus: async () => {
    await requireReadyProvider('finding your syllabus');
    await runScanWithTelemetry('start', () => requireSchoolScanCoordinator().startScan());
    return currentLearnState();
  },
  retryLearnSource: async ({ sourceId }) => {
    requireLearnRepository().source(sourceId);
    await requireReadyProvider('reading your syllabus');
    queueLearnExtraction(sourceId);
    return currentLearnState();
  },
  getTutorSession: ({ sessionId }) => requireTutorCoordinator().state(sessionId),
  startTutorSession: async (input) => {
    return withReadyTutor('starting your tutor', tutor => tutor.start(input));
  },
  answerTutorBlock: ({ sessionId, blockId, answer }) => requireTutorCoordinator().answerBlock(sessionId, blockId, answer),
  hintTutorBlock: ({ sessionId, blockId }) => requireTutorCoordinator().hint(sessionId, blockId),
  saveTutorDraft: ({ sessionId, blockId, draft }) => requireTutorCoordinator().saveDraft(sessionId, blockId, draft),
  sendTutorMessage: async ({ sessionId, text, messageId }) => {
    return withReadyTutor('talking with your tutor', tutor => tutor.send(sessionId, text, messageId));
  },
  pauseTutorSession: ({ sessionId }) => requireTutorCoordinator().pause(sessionId),
  resumeTutorSession: async ({ sessionId }) => {
    return withReadyTutor('resuming your tutor', tutor => tutor.resume(sessionId));
  },
  cancelTutorSession: ({ sessionId }) => requireTutorCoordinator().cancel(sessionId),
  submitAssignmentByRule: async ({ taskId }) => {
    await requireReadyProvider('handing in your homework');
    await requireAssignmentExecutionCoordinator().submitByRule(taskId);
    requireAppKernel().requestReconcile();
    return requireAppKernel().state();
  },
  addAssignment: async (input) => {
    if (/^https?:\/\//i.test(input.text.trim())) await requireReadyProviderForScan();
    const result = await requireHomeworkCoordinator().addAssignment(input);
    requireAppKernel().requestReconcile();
    return result;
  },
  setAssignmentOwner: async (input) => {
    const result = await requireHomeworkCoordinator().setAssignmentOwner(input);
    requireAppKernel().requestReconcile();
    return result;
  },
  reorderQueue: async (input) => {
    const result = requireManagerCoordinator().reorderQueue(input.taskIds);
    requireAppKernel().requestReconcile();
    return result;
  },
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
    requireAppKernel().requestReconcile();
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
    if (input.scope === 'pattern') requireManagerCoordinator().confirmKindMatches(input.courseId, input.patternId);
    requireManagerCoordinator().reconcileQueue();
    requireAppKernel().requestReconcile();
    return readProductSettings();
  },
  deletePermissionRule: async ({ ruleId }) => {
    requireLocalStore().permissionRules.delete(ruleId);
    requireManagerCoordinator().reconcileQueue();
    requireAppKernel().requestReconcile();
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
        if (!isSelfTest && protectedRuntimeLifecycle.transitioning && ![
          'getAuthState', 'getRuntimeInfo', 'getContractManifest', 'signIn', 'signOut',
          'retryEntitlement', 'submitFeedback', 'getTelemetryState', 'captureUiTelemetry',
        ].includes(method)) throw new Error('Studi is switching accounts. Try again in a moment.');
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

  if (isSelfTest) {
    window.webContents.once("did-finish-load", () => {
      window.show();
      window.focus();
      process.stdout.write(`STUDI_SELF_TEST_READY ${JSON.stringify({
        storage: storageSelfTestObservation,
        agent: agentSelfTestObservation,
        window: {
          // Electron exposes the per-window menu visibility API on Windows/Linux only.
          menuBarVisible: process.platform === 'darwin' ? null : window.isMenuBarVisible(),
          applicationMenuAttached: Menu.getApplicationMenu() !== null,
        },
      })}\n`);
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
      if (window.isDestroyed()) return;
      window.show();
      window.focus();
    });
  }
  mainWindow = window;

  return window;
}

function initializeAuthCoordinator(): void {
  if (isSelfTest) return;
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
  if (isSelfTest) return selfTestAuthState;
  return projectProtectedAuthState(authCoordinator?.state() ?? { status: "checking" }, appKernel !== null);
}

function ensureGateTray(): void {
  if (isSelfTest || gateTray) return;
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
    if (isSelfTest) {
      finishSelfTestFailure(`renderer load rejected: ${formatError(error)}`);
    } else {
      process.stderr.write(`STUDI_RENDERER_LOAD_FAILED ${formatError(error)}\n`);
    }
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
  if (runtimeLoginAttempt?.handoff) return null;
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
    const notifications = await collectNotificationReceipt();
    const closeCount = requireAppKernel().lifecycleReceipt().closeInterceptions;
    window.close();
    const hiddenAfterClose = await waitForWindowVisibility(window, false);
    const closeHides = hiddenAfterClose && !window.isDestroyed() && requireAppKernel().lifecycleReceipt().closeInterceptions === closeCount + 1;
    const openCount = requireAppKernel().lifecycleReceipt().openRequests;
    requireAppKernel().open();
    const trayOpenHandled = requireAppKernel().lifecycleReceipt().openRequests === openCount + 1 && !window.isDestroyed();
    const lifecycle: LifecycleSelfTestObservation = {
      unpackagedCoexistsWithInstalled: (!app.isPackaged && !app.hasSingleInstanceLock()) as true,
      closeHides: closeHides as true,
      trayOpenHandled: trayOpenHandled as true,
    };
    const observation: unknown = {
      ...(rendererObservation as Record<string, unknown>),
      storage: storageSelfTestObservation,
      agent: agentSelfTestObservation,
      browser: browserSelfTestObservation,
      lifecycle,
      notifications,
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
    isSuccessfulNotificationObservation(record.notifications) &&
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
  return record.unpackagedCoexistsWithInstalled === true && record.closeHides === true && record.trayOpenHandled === true;
}

function isSuccessfulNotificationObservation(value: unknown): value is NotificationSelfTestObservation {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.persistedWhenMuted === true &&
    record.mutedShown === false &&
    record.mutedDelivered === false &&
    typeof record.enabledShown === "boolean" &&
    record.enabledDelivered === record.enabledShown &&
    record.sound === "inky_nudge";
}

async function collectNotificationReceipt(): Promise<NotificationSelfTestObservation> {
  const kernel = requireAppKernel();
  const store = requireLocalStore();
  const current = await store.productPreferences.get();
  const enabled = await kernel.preview("handoff");
  await store.productPreferences.put({
    ...current,
    notifications: {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      enabled: false,
    },
    updatedAt: new Date().toISOString(),
  });
  const muted = await kernel.preview("handoff");
  await store.productPreferences.put({
    ...current,
    notifications: DEFAULT_NOTIFICATION_PREFERENCES,
    updatedAt: new Date().toISOString(),
  });
  if (muted.shown || muted.notification.deliveredAt) {
    throw new Error("muted notification preview still delivered a toast");
  }
  if (enabled.shown !== Boolean(enabled.notification.deliveredAt)) {
    throw new Error("notification delivery flag does not match the toast receipt");
  }
  return {
    persistedWhenMuted: true,
    mutedShown: false,
    mutedDelivered: false,
    enabledShown: enabled.shown,
    enabledDelivered: Boolean(enabled.notification.deliveredAt),
    sound: "inky_nudge",
  };
}

function isSuccessfulOnboardingUiObservation(
  value: unknown,
): value is OnboardingUiSelfTestObservation {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.passwordFieldCount !== 0) return false;
  if (uiScenario === "partial-dashboard" || uiScenario === "desk-handoff") return true;
  if (uiScenario === "onboarding-welcome" || uiScenario === "onboarding-reconnect") return record.fableConversation === true && record.browserHandoff === false && record.scanAction === false;
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
    store.lifecycle.putExecution({ schemaVersion: STUDI_SCHEMA_VERSION, taskId, assignmentId: "assignment-problems", phase: "needs_user", taskBudget: { maxAgentTurns: 24, maxRecoveryAttempts: 2 }, turnCount: 1, attemptCount: 1, returnPredicate: "The linked homework page shows the signed-in student account.", lastError: "Please sign in to the linked homework system in the visible browser.", updatedAt: "2026-09-01T14:00:03.000Z" });
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
    record.sdkVersion === PiAgentRuntime.sdkVersion &&
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
    record.schemaVersion === STORAGE_SCHEMA_VERSION &&
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
    backupValidated: backup.schemaVersion === STORAGE_SCHEMA_VERSION,
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
  const identity = isSelfTest ? selfTestAuthState : authCoordinator?.state();
  const ownerSubject = identity && (identity.status === "approved" || identity.status === "offline") ? identity.user.subject : undefined;
  if (!ownerSubject) throw new Error('Sign in before opening your learning workspace.');
  learnRepository = new LearnRepository(requireLocalStore().database, ownerSubject);
  memoryCoordinator = new MemoryCoordinator(requireLocalStore().notes, ownerSubject);
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
  const reportLearningError = (error: unknown) => telemetryService?.captureError(error, 'runtime', 'session_start');
  tutorCoordinator = new TutorCoordinator(requireLearnRepository(), agentRuntime, { onError: reportLearningError });
  learnExtractionWorker = new LearnExtractionWorker(requireLearnRepository(), agentRuntime, { onError: reportLearningError });
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
    {
      connectedAppTools: loadConnectedAppTools, ownerSubject,
      learning: createLearningConversationHooks(requireLearnRepository()),
    },
  );
  unsubscribeConversationTrace = requireTelemetryService().subscribeToTrace(conversationCoordinator.trace);
  visibleBrowserWork = new VisibleBrowserWork(requireLocalStore());
  schoolScanCoordinator = new SchoolScanCoordinator(
    requireLocalStore(),
    agentRuntime,
    schoolBrowserPage("school").controller,
    {
      browserWork: requireVisibleBrowserWork(), manager: requireManagerCoordinator(), ownerSubject,
      recordSyllabus: async (source) => {
        const repository = requireLearnRepository();
        const prior = repository.sources().find(item => item.courseId === source.courseId && item.sourceTarget === source.sourceTarget);
        return repository.importSource({ ...source, kind: 'scan', ...(prior ? { sourceId: prior.sourceId } : {}) });
      },
      onError: (error, scanId, toolName) => requireTelemetryService().captureError(error, "scan", "school_scan", {
        ...currentAgentSelection(), scan_id: scanId, ...(toolName ? { tool_name: toolName } : {}),
      }),
    },
  );
  homeworkCoordinator = new HomeworkCoordinator(requireLocalStore(), requireManagerCoordinator(), schoolScanCoordinator);
}

async function synchronizeProtectedRuntime(state: AuthState): Promise<void> {
  if (state.status !== "approved" && state.status !== "offline") {
    await disposeProtectedRuntime();
    ensureGateTray();
    return;
  }
  await protectedRuntimeLifecycle.activate(state.user.subject);
}

function disposeProtectedRuntime(): Promise<void> {
  return isSelfTest ? disposeProtectedRuntimeNow() : protectedRuntimeLifecycle.deactivate();
}

function disposeProtectedRuntimeNow(): Promise<void> {
  tutorTimelineCache = null;
  const memories = memoryCoordinator;
  memoryCoordinator = null;
  const tutor = tutorCoordinator;
  const extractor = learnExtractionWorker;
  tutorCoordinator = null;
  learnExtractionWorker = null;
  const stopped = Promise.all([
    tutor?.dispose(), extractor?.dispose(), memories?.dispose(),
  ]).then(() => undefined);
  learnRepository = null;
  homeworkCoordinator = null;
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
  return stopped;
}

function loadConnectedAppTools() {
  if (isSelfTest) return Promise.resolve([]);
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

async function initializeAppKernel(window: BrowserWindow, isCurrent = () => true): Promise<void> {
  const productPreferences = await requireLocalStore().productPreferences.get();
  assignmentExecutionCoordinator = await AssignmentExecutionCoordinator.create(
    requireLocalStore(),
    requireManagerCoordinator(),
    requireBrowserController(),
    {
      ownerSubject: requireLearnRepository().ownerSubject,
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
  if (!isCurrent()) return;
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
          if (result) {
            captureScanFinished("scheduled", result.state, startedAt);
            queueLearnExtraction();
          }
          return result;
        } catch (error) {
          service.captureError(error, "scan", "school_scan", currentAgentSelection());
          throw error;
        }
      },
      focusBrowser: () => browserView?.webContents.focus(),
      runScheduledAssignment: async (taskId) => {
        await requireReadyProvider('starting your homework');
        await requireAssignmentExecutionCoordinator().start(taskId);
      },
      iconPath: appIconPath,
    },
  );
  const profile = requireLocalStore().school.getProfile();
  if (profile && !requireLocalStore().lifecycle.getSchedule()) {
    appKernel.configureSchedule(profile.scanCadence);
  }
  await appKernel.start();
  for (const intent of pendingNotifications.splice(0)) await appKernel.notify(intent);
  queueLearnExtraction();
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
    requireAppKernel().requestReconcile();
    captureScanFinished(mode, state, startedAt);
    queueLearnExtraction();
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
  if (uiScenario === "onboarding-ready" || uiScenario === "onboarding-welcome" || uiScenario === "onboarding-reconnect") {
    return {
      browser: { ...requireBrowserController().state, driver: currentBrowserDriver() },
      providers: AGENT_PROVIDERS.map((provider) => ({
        schemaVersion: STUDI_SCHEMA_VERSION,
        providerId: provider.id,
        providerName: provider.name,
        state: provider.id === runtime.selectedProviderId && uiScenario !== "onboarding-reconnect" ? "ready" as const : "needs_login" as const,
        loginMethods: ["oauth" as const],
        reason: "Deterministic UI scenario is using the same typed provider projection.",
      })),
      selectedProviderId: runtime.selectedProviderId,
      providerLogin: null,
      models: [{ providerId: runtime.selectedProviderId, id: runtime.selectedModelId, name: runtime.selectedModelId }],
      selectedModelId: runtime.selectedModelId,
      selectedReasoningEffort: runtime.selectedReasoningEffort,
    };
  }
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
  schoolScanCoordinator?.providerReconnected();
  const telemetry = requireTelemetryService();
  telemetry.capture("studi_provider_connection", { provider: providerId, state: "connected" });
  queueLearnExtraction();
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
  readonly unpackagedCoexistsWithInstalled: true;
  readonly closeHides: true;
  readonly trayOpenHandled: true;
}

interface NotificationSelfTestObservation {
  readonly persistedWhenMuted: true;
  readonly mutedShown: false;
  readonly mutedDelivered: false;
  readonly enabledShown: boolean;
  readonly enabledDelivered: boolean;
  readonly sound: "inky_nudge";
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

function requireHomeworkCoordinator(): HomeworkCoordinator {
  if (!homeworkCoordinator) throw new Error('Homework controls are not ready');
  return homeworkCoordinator;
}

function requireLearnRepository(): LearnRepository {
  if (!learnRepository) throw new Error('Your learning workspace is not ready');
  return learnRepository;
}

function requireTutorCoordinator(): TutorCoordinator {
  if (!tutorCoordinator) throw new Error('Your tutor is not ready. Sign in to continue.');
  return tutorCoordinator;
}

async function withReadyTutor<T>(purpose: string, action: (tutor: TutorCoordinator) => Promise<T>): Promise<T> {
  const tutor = requireTutorCoordinator();
  await requireReadyProvider(purpose);
  if (tutor !== tutorCoordinator) throw new Error('Your account changed. Sign in to continue.');
  return action(tutor);
}

function requireMemoryCoordinator(): MemoryCoordinator {
  if (!memoryCoordinator) throw new Error('Your memories are not ready. Sign in to continue.');
  return memoryCoordinator;
}

function validateLearnCourse(courseId: string | null): void {
  if (courseId && !requireLocalStore().school.listCourses().some(course => course.courseId === courseId)) {
    throw new Error('Choose a course from your connected school.');
  }
}

function createLearningConversationHooks(repository: LearnRepository): import('./agent/learn-conversation.js').LearningConversationHooks {
  const assertCurrent = () => {
    if (repository !== learnRepository) throw new Error('Your account changed. Sign in to continue.');
  };
  return {
    state: () => {
      assertCurrent();
      const state = currentLearnState();
      return {
        plan: state.plan,
        sources: state.sources.slice(0, 30),
        exams: state.exams.slice(0, 30),
        topics: state.topics.slice(0, 100),
        mastery: state.mastery.slice(0, 100).map(item => ({ topicId: item.topicId, level: item.level })),
        sessions: [...state.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10).map(item => ({
          sessionId: item.sessionId, topicId: item.topicId, goal: item.goal, status: item.status,
        })),
        truncated: state.sources.length > 30 || state.exams.length > 30 || state.topics.length > 100 || state.sessions.length > 10,
      };
    },
    setExam: input => {
      assertCurrent(); validateLearnCourse(input.courseId);
      repository.setExam(input);
      return { saved: true, exams: repository.exams().slice(0, 30) };
    },
    startSession: async input => {
      assertCurrent(); await requireReadyProvider('starting your tutor'); assertCurrent();
      return requireTutorCoordinator().start(input);
    },
    importSource: input => {
      assertCurrent(); validateLearnCourse(input.courseId);
      const source = repository.importSource(input);
      queueLearnExtraction();
      return { sourceId: source.sourceId, status: source.status, title: source.title };
    },
  };
}

function currentLearnState(selectedExamId?: string) {
  const repository = requireLearnRepository();
  const store = requireLocalStore();
  const worked = new Set(store.tasks.listAll().filter(task => {
    const execution = store.lifecycle.getExecution(task.taskId);
    return execution?.ownerSubject === repository.ownerSubject
      && Boolean(execution.answerSnapshot && execution.reviewCheckpoint);
  }).map(task => task.assignmentId));
  repository.syncHomeworkHints(store.assignments.listAll().filter(assignment =>
    worked.has(assignment.assignmentId) && Boolean(assignment.sourceTarget && assignment.requirementEvidence?.length),
  ).map(({ assignmentId, courseId, title }) => ({ assignmentId, courseId, title })));
  const now = new Date();
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  return repository.learnState(today, selectedExamId);
}

function queueLearnExtraction(sourceId?: string): void {
  const worker = learnExtractionWorker;
  if (!worker) return;
  void (async () => {
    // Keep imported sources pending while disconnected; the student can retry after signing in.
    try { await requireReadyProvider('reading your syllabus'); } catch { return; }
    if (worker !== learnExtractionWorker) return;
    await worker.processPendingSources(sourceId ? { forceSourceId: sourceId } : {});
  })().catch(error => telemetryService?.captureError(error, 'runtime', 'session_start'));
}

function tutorTimelineEntries(repository: LearnRepository): import('../shared/index.js').TimelineEntry[] {
  // Reads poll frequently. SQLite's connection counter invalidates on every
  // write, including two writes in one millisecond; idle reads reuse projection.
  const changes = Number(requireLocalStore().database.handle.prepare('SELECT total_changes() AS count').get()?.count);
  if (tutorTimelineCache?.repository === repository && tutorTimelineCache.changes === changes) return tutorTimelineCache.entries;
  const entries = repository.sessions().flatMap(session => {
    const context = { kind: 'tutor', sessionId: session.sessionId } as const;
    const title = session.goal;
    const entries: import('../shared/index.js').TimelineEntry[] = session.messages.map(message => ({
      id: 'tutor-message:' + message.messageId, kind: 'message', role: 'user',
      context, title, text: message.text, createdAt: message.createdAt,
    }));
    for (const block of session.blocks) {
      if (block.tool === 'tutor_say') entries.push({
        id: 'tutor-block:' + block.blockId, kind: 'message', role: 'assistant', context,
        title, text: block.args.text, createdAt: block.createdAt,
      });
    }
    if (session.status === 'completed' && session.result && session.finishedAt) entries.push({
      id: 'tutor-finished:' + session.sessionId, kind: 'event', event: 'session_finished',
      context, title, text: session.result.summary, createdAt: session.finishedAt,
    });
    return entries;
  });
  tutorTimelineCache = { repository, changes, entries };
  return entries;
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

async function requireSchoolBrowserTelemetryIsolation(): Promise<boolean> {
  if (!browserView || browserView.webContents.isDestroyed()) return false;
  return browserView.webContents.executeJavaScript(
    "typeof globalThis.posthog === 'undefined' && typeof globalThis.studi === 'undefined'",
  ) as Promise<boolean>;
}

async function requireReadyProviderForScan(): Promise<void> {
  await requireReadyProvider("scanning the school");
}

/** Checks configured subscription status; the subsequent real turn proves connectivity. */
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

function configureStartupProfile(): boolean {
  try {
    if (isSelfTest) {
      assertOwnedSelfTestDirectory(selfTestDirectory);
      app.disableHardwareAcceleration();
      app.setPath("userData", selfTestDirectory);
    } else if (
      !app.isPackaged
      && app.commandLine.hasSwitch("studi-development-url")
      && !app.commandLine.hasSwitch("user-data-dir")
    ) {
      app.setPath("userData", join(app.getPath("appData"), "Studi Development"));
    }
    return true;
  } catch (error) {
    const failurePrefix = isSelfTest
      ? "STUDI_SELF_TEST_CONFIGURATION_FAILED"
      : "STUDI_STARTUP_PROFILE_FAILED";
    process.stderr.write(`${failurePrefix} ${formatError(error)}\n`);
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
      updates().start();
      startRenderer(window);
      if (!isSelfTest) {
        const state = await requireAuthCoordinator().start();
        observeAuthState(state);
        await synchronizeProtectedRuntime(state);
        await finishPendingDesktopConnect();
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
  // Disposal removes the kernel before windows close; do not turn that close into a tray hide.
  gateQuitting = true;
  if (appShutdownFinished) return;
  event.preventDefault();
  if (appShutdown) return;
  appShutdown = (async () => {
    await disposeProtectedRuntime();
    if (telemetryService && !telemetryShutdownFinished) await telemetryService.shutdown();
  })().catch(error => console.error('Studi shutdown failed', error)).finally(() => {
    telemetryShutdownFinished = true;
    appShutdownFinished = true;
    app.quit();
  });
});

app.on("will-quit", () => {
  gateQuitting = true;
  updateService?.dispose();
  disposeGateTray();
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
  if (isSelfTest) return;
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
