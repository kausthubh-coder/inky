import {
  CONTRACT_MANIFEST,
  DEFAULT_AGENT_MODEL_ID,
  DEFAULT_AGENT_REASONING_EFFORT,
  DEFAULT_NOTIFICATION_PREFERENCES,
  isLivePhase,
  type Assignment,
  type AgentJob,
  type ConversationTarget,
  type LifecycleState,
  type LibraryState,
  type ProductSettingsState,
  type SchoolOnboardingState,
  type StudiRendererApi,
  type StudiWorkspaceState,
  type TaskDetail,
} from "../../shared/index.js";
import type { DeskPanel } from "./DeskScreen.js";
import type { AppScreen } from "./Ui.js";

const now = "2026-09-03T16:00:00.000Z";

export type DevPreviewScenarioId =
  | "auth"
  | "onboarding-welcome" | "onboarding-chatgpt" | "onboarding-connections" | "onboarding-folder"
  | "onboarding-school" | "onboarding-permission" | "onboarding-schedule" | "onboarding-signin"
  | "onboarding-scan" | "onboarding-handoff" | "onboarding-ready"
  | "week" | "assignment" | "desk-working" | "desk-needs-user" | "desk-review" | "desk-submitted"
  | "settings-inky" | "settings-school" | "settings-privacy" | "settings-account";

export interface DevPreviewConfig {
  readonly id: DevPreviewScenarioId;
  readonly screen: AppScreen;
  readonly panel: DeskPanel;
  readonly onboardingStep?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  readonly settingsSection?: "inky" | "school" | "privacy" | "account";
}

export const DEV_PREVIEW_SCENARIOS: readonly { readonly id: DevPreviewScenarioId; readonly group: string; readonly title: string; readonly note: string }[] = [
  { id: "auth", group: "Entry", title: "Private beta gate", note: "Signed-out entry and feedback" },
  { id: "onboarding-welcome", group: "Onboarding", title: "Meet Inky", note: "Welcome" },
  { id: "onboarding-chatgpt", group: "Onboarding", title: "Connect ChatGPT", note: "Agent runtime" },
  { id: "onboarding-connections", group: "Onboarding", title: "Connected apps", note: "Gmail, Drive, Docs, Notion, GitHub" },
  { id: "onboarding-folder", group: "Onboarding", title: "Homework folder", note: "Bounded file access" },
  { id: "onboarding-school", group: "Onboarding", title: "School link", note: "Class site" },
  { id: "onboarding-permission", group: "Onboarding", title: "Work permission", note: "Attempt and submission default" },
  { id: "onboarding-schedule", group: "Onboarding", title: "Scan schedule", note: "Automatic checks" },
  { id: "onboarding-signin", group: "Onboarding", title: "School sign-in", note: "Browser handoff" },
  { id: "onboarding-scan", group: "Onboarding", title: "Scanning school", note: "Live progress" },
  { id: "onboarding-handoff", group: "Onboarding", title: "Needs student", note: "Linked-site sign-in" },
  { id: "onboarding-ready", group: "Onboarding", title: "Week ready", note: "Partial but truthful completion" },
  { id: "week", group: "Workspace", title: "This week", note: "Dashboard and assignments" },
  { id: "assignment", group: "Workspace", title: "Assignment details", note: "Peek drawer" },
  { id: "desk-working", group: "Workspace", title: "Inky working", note: "Visible school work" },
  { id: "desk-needs-user", group: "Workspace", title: "Inky needs you", note: "Resume handoff" },
  { id: "desk-review", group: "Workspace", title: "Ready for review", note: "Completion checklist" },
  { id: "desk-submitted", group: "Workspace", title: "Submitted", note: "Verified receipt" },
  { id: "settings-inky", group: "Settings", title: "Inky & apps", note: "Models, connected apps, files" },
  { id: "settings-school", group: "Settings", title: "School", note: "Schedule and permissions" },
  { id: "settings-privacy", group: "Settings", title: "Privacy", note: "Telemetry and diagnostics" },
  { id: "settings-account", group: "Settings", title: "Account", note: "Runtime and sign-out" },
];

export function readDevPreviewConfig(): DevPreviewConfig | null {
  const id = new URLSearchParams(window.location.search).get("preview") as DevPreviewScenarioId | null;
  if (!id || !DEV_PREVIEW_SCENARIOS.some((scenario) => scenario.id === id)) return null;
  const settingsSection = id.startsWith("settings-") ? id.slice("settings-".length) as DevPreviewConfig["settingsSection"] : undefined;
  const onboardingStep = ({
    "onboarding-welcome": 0,
    "onboarding-chatgpt": 1,
    "onboarding-connections": 2,
    "onboarding-folder": 3,
    "onboarding-school": 4,
    "onboarding-permission": 5,
    "onboarding-schedule": 6,
  } as Partial<Record<DevPreviewScenarioId, DevPreviewConfig["onboardingStep"]>>)[id];
  const panel: DeskPanel = id === "assignment"
    ? { kind: "assignment", assignmentId: "assignment-sort" }
    : id.startsWith("desk-") ? { kind: "desk" } : { kind: "closed" };
  return { id, screen: settingsSection ? "settings" : "week", panel, ...(onboardingStep === undefined ? {} : { onboardingStep }), ...(settingsSection ? { settingsSection } : {}) };
}
const evidence = {
  schemaVersion: 1 as const,
  evidenceId: "preview-evidence",
  reference: "preview-evidence",
  kind: "text_snapshot" as const,
  sourceTarget: "https://school.example.edu/courses/csc316",
  capturedAt: now,
  summary: "Visible school page checked for preview.",
};

function assignment(assignmentId: string, title: string, dueAt: string): Assignment {
  return {
    schemaVersion: 1,
    assignmentId,
    courseId: "course-csc316",
    title,
    sourceTarget: `https://school.example.edu/courses/csc316/${assignmentId}`,
    dueAt,
    discoveredAt: now,
    lastVerifiedScanId: "preview-scan",
    evidence: [evidence],
  };
}

const assignments = [
  assignment("assignment-sort", "IBM Sorting Machine", "2026-09-03T23:59:00.000Z"),
  assignment("assignment-hw3", "HW 3", "2026-09-04T23:45:00.000Z"),
  assignment("assignment-hw1", "Homework 1", "2026-09-05T23:59:00.000Z"),
];

const permission = { mode: "attempt" as const, mayAttempt: true, maySubmit: false, matchedRuleId: "preview-global", rationale: "A saved rule lets Inky try this and stop before submit." };

export function installDevPreview(): void {
  const preview = readDevPreviewConfig();
  if (window.studi || !preview) return;

  let onboarding: SchoolOnboardingState = {
    profile: {
      schemaVersion: 1,
      profileId: "primary-school",
      studentName: "kausthubh",
      schoolRoot: "https://school.example.edu",
      defaultPermission: "attempt",
      scanCadence: "daily",
      onboardingState: "ready",
      missedCourseFeedback: [],
      updatedAt: now,
    },
    scan: {
      schemaVersion: 1,
      scanId: "preview-scan",
      kind: "first_scan",
      state: "partial",
      startedAt: now,
      updatedAt: now,
      completedAt: now,
      currentStep: "Three verified assignments retained.",
      coverage: [{ target: "CSC 316", status: "verified", evidence }],
      failures: ["A linked homework page still needs a sign-in."],
      handoff: null,
      observedCourseIds: ["course-csc316"],
      observedAssignmentIds: assignments.map((item) => item.assignmentId),
      observedLinkedSystemIds: [],
    },
    courses: [{ schemaVersion: 1, courseId: "course-csc316", label: "CSC 316 Data Structures", sourceTarget: evidence.sourceTarget, lastVerifiedScanId: "preview-scan", lastVerifiedAt: now, evidence }],
    assignments,
    linkedSystems: [],
    workflowRevision: 1,
  };

  const tasks: TaskDetail[] = assignments.map((item, index) => ({
    task: { schemaVersion: 1, taskId: `task-${item.assignmentId}`, assignmentId: item.assignmentId, state: index === 2 ? "preserved" : "discovered", revision: index === 2 ? 2 : 0, createdAt: now, updatedAt: now },
    assignment: item,
    execution: index === 2 ? { schemaVersion: 1, taskId: `task-${item.assignmentId}`, assignmentId: item.assignmentId, phase: "preserved", taskBudget: { maxAgentTurns: 24, maxRecoveryAttempts: 2 }, turnCount: 1, attemptCount: 1, answerArtifactId: "preview-answer", updatedAt: now } : null,
    permission,
    events: [],
    runs: [],
    attempts: index === 2 ? [{ schemaVersion: 1, taskId: `task-${item.assignmentId}`, ordinal: 1, plan: "Fill the visible homework from the current page.", result: "Answers stayed on the page and were saved locally.", evidence: { revision: 1, url: item.sourceTarget, title: item.title, capturedAt: now, summary: "Completed work left on the school page." }, recordedAt: now }] : [],
    submissionReceipt: null,
    activity: [],
  }));

  if (preview.onboardingStep !== undefined) {
    onboarding = { profile: null, scan: null, courses: [], assignments: [], linkedSystems: [], workflowRevision: null };
  } else if (preview.id === "onboarding-signin") {
    onboarding = { ...onboarding, scan: null, workflowRevision: null };
  } else if (preview.id === "onboarding-scan") {
    onboarding = { ...onboarding, scan: { ...onboarding.scan!, state: "running", completedAt: undefined, currentStep: "Checking linked homework pages…", failures: [], handoff: null }, workflowRevision: null };
  } else if (preview.id === "onboarding-handoff") {
    onboarding = {
      ...onboarding,
      scan: {
        ...onboarding.scan!,
        state: "needs_user",
        completedAt: undefined,
        currentStep: "Waiting for a linked homework sign-in.",
        failures: [],
        handoff: { kind: "linked_system_sign_in", reason: "WebAssign needs you to sign in before I can keep checking.", requestedAt: now, evidence },
      },
      workflowRevision: null,
    };
  }

  let lifecycle: LifecycleState = {
    windowVisible: true,
    schedule: { schemaVersion: 1, scheduleId: "school-scan", cadence: "daily", state: "enabled", timezone: "America/New_York", localTime: "09:00", nextRunAt: "2026-09-04T13:00:00.000Z", updatedAt: now },
    execution: null,
    attempts: [],
    submissionReceipt: null,
    latestNotification: null,
    manager: { entries: [], lease: null },
  };

  let settings: ProductSettingsState = {
    preferences: { schemaVersion: 1, reviewMinutes: 15, handoffMinutes: 30, memoryVisibility: "selected", homeworkRoot: null, agentModelId: DEFAULT_AGENT_MODEL_ID, agentReasoningEffort: DEFAULT_AGENT_REASONING_EFFORT, notifications: DEFAULT_NOTIFICATION_PREFERENCES, updatedAt: now },
    permissionRules: [{ schemaVersion: 1, ruleId: "preview-global", scope: "global", mode: "attempt", updatedAt: now }],
    schedule: lifecycle.schedule,
  };

  const workspace = (): StudiWorkspaceState => ({
    browser: { url: "https://school.example.edu", title: "School", revision: 1, driver: lifecycle.execution?.phase === "working" ? "inky" : "none" },
    provider: { schemaVersion: 1, providerId: "openai-codex", providerName: "Codex", state: "ready", loginMethods: ["oauth"], reason: "ChatGPT is connected." },
    providerLogin: null,
    models: [{ id: DEFAULT_AGENT_MODEL_ID, name: "gpt-5.6-sol" }],
    selectedModelId: settings.preferences.agentModelId,
    selectedReasoningEffort: settings.preferences.agentReasoningEffort,
  });

  const library = (): LibraryState => ({
    tasks: tasks.map(({ events: _events, runs: _runs, attempts: _attempts, submissionReceipt: _receipt, activity: _activity, ...summary }) => summary),
    artifacts: [],
  });

  const detail = (taskId: string) => tasks.find((item) => item.task.taskId === taskId) ?? null;
  const conversations = new Map<string, AgentJob>();
  let conversationSequence = 0;
  const conversation = (target: ConversationTarget): AgentJob => {
    const key = target.kind === "home" ? "home" : `assignment:${target.assignmentId}`;
    const existing = conversations.get(key);
    if (existing) return existing;
    conversationSequence += 1;
    const job: AgentJob = {
      schemaVersion: 1,
      jobId: `preview-job-${conversationSequence}`,
      target,
      phase: "idle",
      turnIndex: 0,
      runId: `preview-run-${conversationSequence}-0`,
      sessionId: null,
      claim: null,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    conversations.set(key, job);
    return job;
  };

  if (preview.id.startsWith("desk-")) {
    const item = tasks[0]!;
    const phase = preview.id === "desk-needs-user" ? "needs_user" : preview.id === "desk-review" ? "ready_review" : preview.id === "desk-submitted" ? "submitted" : "working";
    const checkpoint = { revision: 4, url: item.assignment.sourceTarget, title: item.assignment.title, capturedAt: now, summary: "All six written answers are visible on the assignment page." };
    item.task = { ...item.task, state: phase, revision: 4 };
    item.execution = {
      schemaVersion: 1,
      taskId: item.task.taskId,
      assignmentId: item.assignment.assignmentId,
      phase,
      taskBudget: { maxAgentTurns: 24, maxRecoveryAttempts: 2 },
      turnCount: 8,
      attemptCount: 1,
      ...(phase === "needs_user" ? { returnPredicate: "Attach the three JPG graphs in Show My Work, then tell me to keep going.", lastError: "The assignment requires graph files that are not in the homework folder." } : {}),
      ...(phase === "ready_review" ? { reviewDeadline: "2026-09-03T16:15:00.000Z", reviewCheckpoint: checkpoint, answerSnapshot: "Six written responses filled; three graphs attached.", completionChecklist: [{ requirement: "Six written answers", evidence: "All six response boxes contain an answer." }, { requirement: "Three JPG graphs", evidence: "Three attachments are listed in Show My Work." }] } : {}),
      ...(phase === "submitted" ? { submissionReceiptId: "preview-receipt" } : {}),
      updatedAt: now,
    };
    item.activity = phase === "working" ? [
      { schemaVersion: 1, type: "tool_started", toolCallId: "preview-read", toolName: "browser_read" },
      { schemaVersion: 1, type: "tool_finished", toolCallId: "preview-read", toolName: "browser_read", outcome: "succeeded" },
      { schemaVersion: 1, type: "tool_started", toolCallId: "preview-fill", toolName: "browser_fill" },
    ] : [];
    if (phase === "submitted") {
      const receipt = { schemaVersion: 1 as const, receiptId: "preview-receipt", taskId: item.task.taskId, preSubmit: checkpoint, postSubmit: { ...checkpoint, revision: 5, summary: "The school page shows Submitted." }, verifiedStatus: "Submitted", submittedAt: now };
      item.submissionReceipt = receipt;
      lifecycle = { ...lifecycle, execution: item.execution, submissionReceipt: receipt };
    } else {
      lifecycle = { ...lifecycle, execution: item.execution };
    }
  }

  const api: StudiRendererApi = {
    getRuntimeInfo: async () => ({ app: "0.1.0-preview", electron: "37.10.3", chrome: "138", node: "22" }),
    getContractManifest: async () => CONTRACT_MANIFEST,
    getAuthState: async () => preview.id === "auth" ? { status: "signed_out" } : ({ status: "approved", user: { subject: "preview", email: "preview@studi.local", name: "kausthubh" }, entitlement: { plan: "beta", credits: 0 }, deviceId: "00000000-0000-4000-8000-000000000001", secureStorage: false }),
    signIn: async () => api.getAuthState(),
    signOut: async () => ({ status: "signed_out" }),
    retryEntitlement: async () => api.getAuthState(),
    submitFeedback: async () => ({ accepted: true as const, feedbackId: "00000000-0000-4000-8000-000000000002" }),
    getUsageState: async () => ({
      schemaVersion: 1,
      period: "2026-09",
      plan: "beta" as const,
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
    }),
    getConnectedApps: async () => ({ configured: true, toolkits: [
      ["gmail", "20260902_00"], ["googledrive", "20260902_00"], ["googledocs", "20260826_00"], ["notion", "20260819_00"], ["github", "20260902_00"], ["canvas", "20260729_00"], ["googlecalendar", "20260902_00"], ["googlesheets", "20260902_00"], ["outlook", "20260903_00"], ["dropbox", "20260903_00"], ["slack", "20260826_00"], ["discord", "20260826_00"], ["todoist", "20260731_00"],
    ].map(([toolkit, version]) => ({ toolkit: toolkit!, version: version!, access: "all" as const })) }),
    connectApp: async ({ toolkit }) => ({ toolkit, sessionId: "preview-composio", connectedAccountId: null, status: "INITIATED", redirectUrl: "https://example.com/connect" }),
    refreshConnectedApp: async ({ toolkit }) => ({ toolkit, sessionId: "preview-composio", connectedAccountId: "preview-account", status: "ACTIVE", redirectUrl: null }),
    getWorkspaceState: async () => workspace(),
    navigateBrowser: async () => workspace(),
    loginOpenAiCodex: async () => workspace(),
    cancelOpenAiCodexLogin: async () => workspace(),
    selectAgentModel: async ({ modelId, reasoningEffort }) => { settings = { ...settings, preferences: { ...settings.preferences, agentModelId: modelId, agentReasoningEffort: reasoningEffort, updatedAt: new Date().toISOString() } }; return workspace(); },
    getManagerState: async () => lifecycle.manager,
    send: async ({ target, text }) => {
      const current = conversation(target);
      const turnIndex = current.turnIndex + 1;
      const reply = target.kind === "home"
        ? `Okay, I will keep that in mind: ${text.slice(0, 140)}`
        : `I checked this assignment: ${text.slice(0, 140)}`;
      const job: AgentJob = {
        ...current,
        phase: "conversing",
        turnIndex,
        runId: `preview-run-${current.jobId}-${turnIndex}`,
        sessionId: current.sessionId ?? `preview-session-${current.jobId}`,
        messages: [
          ...current.messages,
          { messageId: `preview-user-${current.jobId}-${turnIndex}`, role: "user", text, createdAt: now, turnIndex },
          { messageId: `preview-inky-${current.jobId}-${turnIndex}`, role: "assistant", text: reply, createdAt: now, turnIndex },
        ],
        updatedAt: now,
      };
      conversations.set(target.kind === "home" ? "home" : `assignment:${target.assignmentId}`, job);
      return { outcome: "completed", text: reply, job };
    },
    selectAssignment: async ({ assignmentId }) => {
      const target: ConversationTarget = assignmentId ? { kind: "assignment", assignmentId } : { kind: "home" };
      return { target, job: conversation(target) };
    },
    getSchoolOnboardingState: async () => onboarding,
    saveSchoolProfile: async (input) => { onboarding = { ...onboarding, profile: onboarding.profile ? { ...onboarding.profile, ...input, updatedAt: new Date().toISOString() } : onboarding.profile }; return onboarding; },
    startSchoolScan: async () => onboarding,
    resumeSchoolScan: async () => onboarding,
    replaySchoolScan: async () => onboarding,
    recordMissedCourseFeedback: async () => onboarding,
    getLifecycleState: async () => lifecycle,
    setAutomationPaused: async () => lifecycle,
    startNextAssignment: async () => api.startAssignment({ taskId: tasks[0]!.task.taskId }),
    startAssignment: async ({ taskId }) => {
      if (lifecycle.execution && isLivePhase(lifecycle.execution.phase)) {
        throw new Error("Inky is already on another page.");
      }
      const item = tasks.find((task) => task.task.taskId === taskId);
      if (!item) throw new Error("That assignment is not in the preview.");
      item.task = { ...item.task, state: "working", revision: item.task.revision + 1, updatedAt: new Date().toISOString() };
      item.execution = { schemaVersion: 1, taskId, assignmentId: item.assignment.assignmentId, phase: "working", taskBudget: { maxAgentTurns: 24, maxRecoveryAttempts: 2 }, turnCount: 0, attemptCount: 0, updatedAt: new Date().toISOString() };
      item.activity = [{ schemaVersion: 1, type: "tool_started", toolCallId: "preview-click", toolName: "click" }];
      lifecycle = { ...lifecycle, execution: item.execution, attempts: item.attempts };
      return lifecycle;
    },
    resumeAssignment: async () => lifecycle,
    verifyStudentSubmission: async () => lifecycle,
    openAnswerArtifact: async () => true,
    getProductSettings: async () => settings,
    saveProductPreferences: async (input) => { settings = { ...settings, preferences: { ...settings.preferences, ...input, updatedAt: new Date().toISOString() } }; return settings.preferences; },
    selectHomeworkRoot: async () => { settings = { ...settings, preferences: { ...settings.preferences, homeworkRoot: "C:\\Studi Preview Homework", updatedAt: new Date().toISOString() } }; return settings.preferences; },
    saveNotificationPreferences: async (input) => { settings = { ...settings, preferences: { ...settings.preferences, notifications: input, updatedAt: new Date().toISOString() } }; return settings.preferences; },
    testNotification: async ({ kind }) => ({
      notification: {
        schemaVersion: 1,
        notificationId: "preview-ping",
        kind,
        target: { type: "task", id: "task-1" },
        title: "Preview ping",
        body: "This is a preview ping.",
        createdAt: now,
      },
      shown: false,
      sound: settings.preferences.notifications.kinds[kind].sound,
      supported: false,
    }),
    savePermissionRule: async () => settings,
    deletePermissionRule: async () => settings,
    configureScanSchedule: async () => settings,
    getLibraryState: async () => library(),
    getTaskDetail: async ({ taskId }) => { const value = detail(taskId); if (!value) throw new Error("Missing task"); return value; },
    readArtifact: async () => null,
    requestAssignmentTakeover: async ({ taskId }) => {
      if (lifecycle.execution?.taskId === taskId && lifecycle.execution) {
        lifecycle = { ...lifecycle, execution: { ...lifecycle.execution, phase: "needs_user", returnPredicate: "You have the page.", updatedAt: new Date().toISOString() } };
      }
      return lifecycle;
    },
    cancelAssignment: async () => { lifecycle = { ...lifecycle, execution: null }; return lifecycle; },
    setBrowserLayout: async ({ mode }) => mode,
    getTelemetryState: async () => ({ configured: false, enabled: false, replayEnabled: false, identity: "anonymous", distinctId: "preview", debugUntil: null, rendererConfig: null, inspector: [] }),
    setTelemetryPreferences: async () => api.getTelemetryState(),
    setTelemetryDebug: async () => api.getTelemetryState(),
    captureUiTelemetry: async () => true,
    exportDiagnostics: async () => ({ status: "cancelled" as const }),
    onLifecycleActivated: () => () => undefined,
    onNotificationSound: () => () => undefined,
  };

  Object.defineProperty(window, "studi", { configurable: true, value: api });
}
