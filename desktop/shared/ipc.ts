import { z } from "zod";

import {
  AddressedSendResultSchema,
  AssignmentReferenceSchema,
  ConversationStateSchema,
  ConversationTargetSchema,
  SelectedConversationSchema,
} from "./agent-job.js";
import { AgentReasoningEffortSchema } from "./agent-runtime.js";
import { ArtifactDocumentSchema } from "./artifact.js";
import { AuthStateSchema, FeedbackReceiptSchema } from "./auth.js";
import { StudiWorkspaceStateSchema } from "./browser-agent.js";
import { ConnectedAppConnectionSchema, ConnectedAppsStateSchema } from "./composio.js";
import { DiagnosticsExportReceiptSchema } from "./diagnostics.js";
import { LifecycleStateSchema, NotificationIntentSchema, type NotificationIntent } from "./lifecycle.js";
import { ManagerStateSchema } from "./manager.js";
import {
  BrowserLayoutModeSchema,
  LibraryStateSchema,
  NotificationKindSchema,
  NotificationTestReceiptSchema,
  ProductPreferencesSchema,
  ProductSettingsStateSchema,
  ReadArtifactInputSchema,
  SaveNotificationPreferencesInputSchema,
  SavePermissionRuleInputSchema,
  SaveProductPreferencesInputSchema,
  SchoolPageBoundsSchema,
  TaskDetailSchema,
} from "./product.js";
import { AgentProviderIdSchema } from "./providers.js";
import { SaveSchoolProfileInputSchema, SchoolOnboardingStateSchema } from "./school-scan.js";
import {
  TelemetryDebugInputSchema,
  TelemetryPreferencesInputSchema,
  TelemetryStateSchema,
  UiTelemetryInputSchema,
} from "./telemetry.js";
import { UpdateStateSchema } from "./updates.js";
import { UsageStateSchema } from "./usage.js";

export const RuntimeInfoSchema = z.strictObject({
  app: z.string().min(1),
  electron: z.string().min(1),
  chrome: z.string().min(1),
  node: z.string().min(1),
});

export type RuntimeInfo = z.infer<typeof RuntimeInfoSchema>;

export type IpcMethodDefinition = Readonly<{
  channel: string;
  requestSchema: z.ZodType;
  resultSchema: z.ZodType;
}>;

export type IpcRegistryDefinition = Readonly<Record<string, IpcMethodDefinition>>;

export type IpcInvoke = (channel: string, request: unknown) => Promise<unknown>;

type RequestArguments<Definition extends IpcMethodDefinition> =
  Definition["requestSchema"] extends z.ZodUndefined
    ? []
    : Definition["requestSchema"] extends z.ZodOptional<z.ZodType>
      ? [request?: z.input<Definition["requestSchema"]>]
      : [request: z.input<Definition["requestSchema"]>];

type IpcMethod<Definition extends IpcMethodDefinition> = (
  ...args: RequestArguments<Definition>
) => Promise<z.output<Definition["resultSchema"]>>;

export type IpcApi<Registry extends IpcRegistryDefinition> = Readonly<{
  [Method in keyof Registry]: IpcMethod<Registry[Method]>;
}>;

type IpcHandler<Definition extends IpcMethodDefinition> = (
  request: z.output<Definition["requestSchema"]>,
) => z.input<Definition["resultSchema"]> | Promise<z.input<Definition["resultSchema"]>>;

export type IpcHandlers<Registry extends IpcRegistryDefinition> = Readonly<{
  [Method in keyof Registry]: IpcHandler<Registry[Method]>;
}>;

export type IpcHandlerRegistration = Readonly<{
  channel: string;
  handle: (rawRequest: unknown) => Promise<unknown>;
}>;

function ipc<Request extends z.ZodType, Result extends z.ZodType>(
  channel: string,
  requestSchema: Request,
  resultSchema: Result,
) {
  return Object.freeze({ channel, requestSchema, resultSchema });
}

const none = z.undefined();
const Id = z.string().min(1).max(256);
const TaskId = z.strictObject({ taskId: Id });
const AssignmentId = z.strictObject({ assignmentId: Id });
const Toolkit = z.strictObject({ toolkit: z.string().trim().min(1).max(128) });
const ProviderId = z.strictObject({ providerId: AgentProviderIdSchema });
const BrowserPage = z.union([ConversationTargetSchema, z.strictObject({ kind: z.literal("school") })]);
const RelativePath = z.string().min(1).max(2_048);

/** Every renderer-to-main call. The key is the renderer method name; the channel is the wire name. */
export const studiIpcRegistry = Object.freeze({
  getRuntimeInfo: ipc("studi:runtime-info", none, RuntimeInfoSchema),
  getUpdateState: ipc("studi:update-state", none, UpdateStateSchema),
  checkForUpdates: ipc("studi:update-check", none, UpdateStateSchema),
  installUpdate: ipc("studi:update-install", none, UpdateStateSchema),

  getAuthState: ipc("studi:auth-state", none, AuthStateSchema),
  signIn: ipc("studi:sign-in", none, AuthStateSchema),
  signOut: ipc("studi:sign-out", none, AuthStateSchema),
  retryEntitlement: ipc("studi:retry-entitlement", none, AuthStateSchema),
  submitFeedback: ipc("studi:submit-feedback", z.strictObject({ message: z.string().trim().min(1).max(1_000) }), FeedbackReceiptSchema),
  getUsageState: ipc("studi:usage-state", none, UsageStateSchema),

  getConnectedApps: ipc("studi:connected-apps", none, ConnectedAppsStateSchema),
  connectApp: ipc("studi:connect-app", Toolkit, ConnectedAppConnectionSchema),
  refreshConnectedApp: ipc("studi:refresh-connected-app", Toolkit, ConnectedAppConnectionSchema),

  getWorkspaceState: ipc("studi:workspace-state", none, StudiWorkspaceStateSchema),
  navigateBrowser: ipc("studi:navigate-browser", z.strictObject({ url: z.string().min(1).max(2_048), target: BrowserPage.optional() }), StudiWorkspaceStateSchema),
  selectBrowserPage: ipc("studi:browser-page", BrowserPage, StudiWorkspaceStateSchema),
  setBrowserLayout: ipc("studi:set-browser-layout", z.strictObject({ mode: BrowserLayoutModeSchema, bounds: SchoolPageBoundsSchema.optional() }), BrowserLayoutModeSchema),

  loginProvider: ipc("studi:login-provider", ProviderId, StudiWorkspaceStateSchema),
  completeProviderLogin: ipc("studi:complete-provider-login", z.strictObject({ providerId: AgentProviderIdSchema, code: z.string().trim().min(1).max(4_096) }), StudiWorkspaceStateSchema),
  cancelProviderLogin: ipc("studi:cancel-provider-login", none, StudiWorkspaceStateSchema),
  logoutProvider: ipc("studi:logout-provider", ProviderId, StudiWorkspaceStateSchema),
  selectAgentModel: ipc("studi:select-agent-model", z.strictObject({ providerId: AgentProviderIdSchema, modelId: z.string().min(1), reasoningEffort: AgentReasoningEffortSchema }), StudiWorkspaceStateSchema),

  getManagerState: ipc("studi:manager-state", none, ManagerStateSchema),
  send: ipc("studi:send", z.strictObject({
    target: ConversationTargetSchema,
    text: z.string().trim().min(1).max(100_000),
    clientMessageId: z.string().uuid().optional(),
    assignmentRefs: z.array(AssignmentReferenceSchema).max(20).optional(),
  }), AddressedSendResultSchema),
  selectAssignment: ipc("studi:select-assignment", z.strictObject({ assignmentId: z.string().trim().min(1).max(256).nullable() }), SelectedConversationSchema),
  getConversationState: ipc("studi:conversation-state", none, ConversationStateSchema),
  stopConversation: ipc("studi:conversation-stop", none, ConversationStateSchema),
  getScopedConversation: ipc("studi:scoped-conversation", ConversationTargetSchema, ConversationStateSchema),
  stopScopedConversation: ipc("studi:scoped-conversation-stop", ConversationTargetSchema, ConversationStateSchema),

  getSchoolOnboardingState: ipc("studi:school-onboarding-state", none, SchoolOnboardingStateSchema),
  saveSchoolProfile: ipc("studi:save-school-profile", SaveSchoolProfileInputSchema, SchoolOnboardingStateSchema),
  startSchoolScan: ipc("studi:start-school-scan", AssignmentId.optional(), SchoolOnboardingStateSchema),
  resumeSchoolScan: ipc("studi:resume-school-scan", none, SchoolOnboardingStateSchema),
  replaySchoolScan: ipc("studi:replay-school-scan", none, SchoolOnboardingStateSchema),
  pauseSchoolScan: ipc("studi:scan-pause", none, SchoolOnboardingStateSchema),
  sendScanMessage: ipc("studi:scan-message", z.strictObject({ scanId: Id, text: z.string().trim().min(1).max(20_000), clientMessageId: z.string().uuid() }), SchoolOnboardingStateSchema),
  recordMissedCourseFeedback: ipc("studi:record-missed-course-feedback", z.strictObject({ feedback: z.string().trim().min(1).max(500) }), SchoolOnboardingStateSchema),

  getLifecycleState: ipc("studi:lifecycle-state", none, LifecycleStateSchema),
  setAutomationPaused: ipc("studi:set-automation-paused", z.strictObject({ paused: z.boolean() }), LifecycleStateSchema),
  startNextAssignment: ipc("studi:start-next-assignment", none, LifecycleStateSchema),
  startAssignment: ipc("studi:start-assignment", TaskId, LifecycleStateSchema),
  resumeAssignment: ipc("studi:resume-assignment", TaskId, LifecycleStateSchema),
  requestAssignmentTakeover: ipc("studi:request-assignment-takeover", TaskId, LifecycleStateSchema),
  cancelAssignment: ipc("studi:cancel-assignment", TaskId, LifecycleStateSchema),
  verifyStudentSubmission: ipc("studi:verify-student-submission", z.strictObject({ taskId: Id, confirmationText: z.string().trim().min(1).max(500) }), LifecycleStateSchema),
  openAnswerArtifact: ipc("studi:open-answer-artifact", TaskId, z.boolean()),

  getAssignmentFiles: ipc("studi:assignment-files", AssignmentId, z.array(z.strictObject({ path: z.string(), kind: z.enum(["file", "directory"]), size: z.number(), modifiedAt: z.string() }))),
  readAssignmentFile: ipc("studi:assignment-file", z.strictObject({ assignmentId: Id, path: RelativePath }), z.strictObject({ path: z.string(), content: z.string(), modifiedAt: z.string() })),
  importAssignmentFiles: ipc("studi:assignment-files-import", AssignmentId, z.strictObject({ imported: z.array(z.string()), errors: z.array(z.strictObject({ name: z.string(), message: z.string() })) })),
  openAssignmentFolder: ipc("studi:assignment-folder", z.strictObject({ assignmentId: Id, path: RelativePath.optional() }), z.boolean()),

  getNotifications: ipc("studi:notifications", none, z.array(NotificationIntentSchema)),
  readNotification: ipc("studi:notification-read", z.strictObject({ notificationId: Id }), z.array(NotificationIntentSchema)),
  testNotification: ipc("studi:test-notification", z.strictObject({ kind: NotificationKindSchema }), NotificationTestReceiptSchema),

  getProductSettings: ipc("studi:product-settings", none, ProductSettingsStateSchema),
  saveProductPreferences: ipc("studi:save-product-preferences", SaveProductPreferencesInputSchema, ProductPreferencesSchema),
  saveNotificationPreferences: ipc("studi:save-notification-preferences", SaveNotificationPreferencesInputSchema, ProductPreferencesSchema),
  selectHomeworkRoot: ipc("studi:select-homework-root", none, ProductPreferencesSchema),
  savePermissionRule: ipc("studi:save-permission-rule", SavePermissionRuleInputSchema, ProductSettingsStateSchema),
  deletePermissionRule: ipc("studi:delete-permission-rule", z.strictObject({ ruleId: Id }), ProductSettingsStateSchema),
  configureScanSchedule: ipc("studi:configure-scan-schedule", z.strictObject({
    cadence: z.enum(["manual", "daily", "weekly"]),
    localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    weekday: z.number().int().min(0).max(6).optional(),
  }), ProductSettingsStateSchema),

  getLibraryState: ipc("studi:library-state", none, LibraryStateSchema),
  getTaskDetail: ipc("studi:task-detail", TaskId, TaskDetailSchema),
  readArtifact: ipc("studi:read-artifact", ReadArtifactInputSchema, ArtifactDocumentSchema.nullable()),

  getTelemetryState: ipc("studi:telemetry-state", none, TelemetryStateSchema),
  setTelemetryPreferences: ipc("studi:set-telemetry-preferences", TelemetryPreferencesInputSchema, TelemetryStateSchema),
  setTelemetryDebug: ipc("studi:set-telemetry-debug", TelemetryDebugInputSchema, TelemetryStateSchema),
  captureUiTelemetry: ipc("studi:capture-ui-telemetry", UiTelemetryInputSchema, z.boolean()),
  exportDiagnostics: ipc("studi:export-diagnostics", none, DiagnosticsExportReceiptSchema),
});

export type StudiIpcRegistry = typeof studiIpcRegistry;
export type StudiIpcMethod = keyof StudiIpcRegistry;

export const studiIpcMethods = Object.freeze(Object.keys(studiIpcRegistry) as StudiIpcMethod[]);

export type StudiApi = IpcApi<StudiIpcRegistry>;

export type StudiIpcHandlers = IpcHandlers<StudiIpcRegistry>;

export type StudiRendererApi = StudiApi & {
  readonly onLifecycleActivated: (listener: (target: NotificationIntent["target"]) => void) => () => void;
  readonly onNotificationSound: (listener: (fileUrl: string) => void) => () => void;
};

function createIpcMethod<Definition extends IpcMethodDefinition>(
  method: string,
  contract: Definition,
  invoke: IpcInvoke,
): IpcMethod<Definition> {
  return async (...args: RequestArguments<Definition>) => {
    const suppliedArguments: readonly unknown[] = args;
    const expectsNoArguments = contract.requestSchema instanceof z.ZodUndefined;
    const expectedArgumentCount = expectsNoArguments ? 0 : 1;

    const optionalRequest = contract.requestSchema instanceof z.ZodOptional;
    if (suppliedArguments.length !== expectedArgumentCount && !(optionalRequest && suppliedArguments.length === 0)) {
      throw new TypeError(
        `IPC method ${method} expects ${expectedArgumentCount} argument${expectedArgumentCount === 1 ? "" : "s"}; received ${suppliedArguments.length}`,
      );
    }

    const rawRequest = expectsNoArguments ? undefined : suppliedArguments[0];
    return invoke(contract.channel, rawRequest) as Promise<z.output<Definition["resultSchema"]>>;
  };
}

export function createIpcApi<Registry extends IpcRegistryDefinition>(
  registry: Registry,
  invoke: IpcInvoke,
): IpcApi<Registry> {
  const methods: Partial<{ [Method in keyof Registry]: IpcMethod<Registry[Method]> }> = {};

  for (const method of Object.keys(registry) as Array<keyof Registry>) {
    const contract = registry[method];
    methods[method] = createIpcMethod(String(method), contract, invoke);
  }

  // Object.keys above visits every own registry key. The cast records that completeness;
  // createIpcMethod already preserves each key's request and result signature.
  return Object.freeze(methods) as IpcApi<Registry>;
}

function createIpcHandler<Definition extends IpcMethodDefinition>(
  contract: Definition,
  handler: IpcHandler<Definition>,
): (rawRequest: unknown) => Promise<z.output<Definition["resultSchema"]>> {
  return async (rawRequest: unknown) => {
    const request = contract.requestSchema.parse(rawRequest) as z.output<Definition["requestSchema"]>;
    const result = await handler(request);
    return contract.resultSchema.parse(result) as z.output<Definition["resultSchema"]>;
  };
}

export function createIpcHandlerRegistrations<Registry extends IpcRegistryDefinition>(
  registry: Registry,
  handlers: IpcHandlers<Registry>,
): readonly IpcHandlerRegistration[] {
  const registrations = (Object.keys(registry) as Array<keyof Registry>).map((method) => {
    const contract = registry[method];
    const handler = handlers[method];
    if (!contract || !handler) {
      throw new TypeError(`Missing IPC contract or handler for ${String(method)}`);
    }
    const registration: IpcHandlerRegistration = {
      channel: contract.channel,
      handle: createIpcHandler(contract, handler),
    };
    return Object.freeze(registration);
  });

  return Object.freeze(registrations);
}
