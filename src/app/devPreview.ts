import {
  CONTRACT_MANIFEST,
  DEFAULT_AGENT_MODEL_ID,
  DEFAULT_AGENT_REASONING_EFFORT,
  isLivePhase,
  type Assignment,
  type LifecycleState,
  type LibraryState,
  type ProductSettingsState,
  type SchoolOnboardingState,
  type StudiApi,
  type StudiWorkspaceState,
  type TaskDetail,
} from "../../shared/index.js";

const now = "2026-09-03T16:00:00.000Z";
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
  if (window.studi || !new URLSearchParams(window.location.search).has("preview")) return;

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
    execution: index === 2 ? { schemaVersion: 1, taskId: `task-${item.assignmentId}`, assignmentId: item.assignmentId, phase: "preserved", taskBudget: { maxAgentTurns: 1, maxRecoveryAttempts: 2 }, attemptCount: 1, answerArtifactId: "preview-answer", updatedAt: now } : null,
    permission,
    events: [],
    runs: [],
    attempts: index === 2 ? [{ schemaVersion: 1, taskId: `task-${item.assignmentId}`, ordinal: 1, plan: "Fill the visible homework from the current page.", result: "Answers stayed on the page and were saved locally.", evidence: { revision: 1, url: item.sourceTarget, title: item.title, capturedAt: now, summary: "Completed work left on the school page." }, recordedAt: now }] : [],
    submissionReceipt: null,
    activity: [],
  }));

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
    preferences: { schemaVersion: 1, reviewMinutes: 15, handoffMinutes: 30, memoryVisibility: "selected", agentModelId: DEFAULT_AGENT_MODEL_ID, agentReasoningEffort: DEFAULT_AGENT_REASONING_EFFORT, updatedAt: now },
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

  const api: StudiApi = {
    getRuntimeInfo: async () => ({ app: "0.1.0-preview", electron: "37.10.3", chrome: "138", node: "22" }),
    getContractManifest: async () => CONTRACT_MANIFEST,
    getAuthState: async () => ({ status: "approved", user: { subject: "preview", email: "preview@studi.local", name: "kausthubh" }, entitlement: { plan: "beta", credits: 0 }, deviceId: "00000000-0000-4000-8000-000000000001", secureStorage: false }),
    signIn: async () => api.getAuthState(),
    signOut: async () => ({ status: "signed_out" }),
    retryEntitlement: async () => api.getAuthState(),
    submitFeedback: async () => ({ accepted: true as const, feedbackId: "00000000-0000-4000-8000-000000000002" }),
    getWorkspaceState: async () => workspace(),
    navigateBrowser: async () => workspace(),
    loginOpenAiCodex: async () => workspace(),
    cancelOpenAiCodexLogin: async () => workspace(),
    selectAgentModel: async ({ modelId, reasoningEffort }) => { settings = { ...settings, preferences: { ...settings.preferences, agentModelId: modelId, agentReasoningEffort: reasoningEffort, updatedAt: new Date().toISOString() } }; return workspace(); },
    getManagerState: async () => lifecycle.manager,
    runManager: async ({ prompt }) => ({ outcome: "completed" as const, text: `Okay — I’ll keep that in mind: ${prompt.slice(0, 140)}`, state: lifecycle.manager }),
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
      item.execution = { schemaVersion: 1, taskId, assignmentId: item.assignment.assignmentId, phase: "working", taskBudget: { maxAgentTurns: 1, maxRecoveryAttempts: 2 }, attemptCount: 0, updatedAt: new Date().toISOString() };
      item.activity = [{ schemaVersion: 1, type: "tool_started", toolCallId: "preview-click", toolName: "click" }];
      lifecycle = { ...lifecycle, execution: item.execution, attempts: item.attempts };
      return lifecycle;
    },
    resumeAssignment: async () => lifecycle,
    verifyStudentSubmission: async () => lifecycle,
    openAnswerArtifact: async () => true,
    getProductSettings: async () => settings,
    saveProductPreferences: async (input) => { settings = { ...settings, preferences: { ...settings.preferences, ...input, updatedAt: new Date().toISOString() } }; return settings.preferences; },
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
  };

  Object.defineProperty(window, "studi", { configurable: true, value: api });
}
