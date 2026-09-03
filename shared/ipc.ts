import { z } from "zod";

import { AgentReasoningEffortSchema } from "./agent-runtime.js";
import { SchemaVersionSchema, STUDI_SCHEMA_VERSION } from "./schema-version.js";
import { AuthStateSchema, FeedbackReceiptSchema } from "./auth.js";
import { DiagnosticsExportReceiptSchema } from "./diagnostics.js";
import { StudiWorkspaceStateSchema } from "./browser-agent.js";
import { ManagerStateSchema, ManagerTurnResultSchema } from "./manager.js";
import { LifecycleStateSchema } from "./lifecycle.js";
import { ArtifactDocumentSchema } from "./artifact.js";
import {
  BrowserLayoutModeSchema,
  LibraryStateSchema,
  ProductPreferencesSchema,
  ProductSettingsStateSchema,
  ReadArtifactInputSchema,
  SavePermissionRuleInputSchema,
  SaveProductPreferencesInputSchema,
  TaskDetailSchema,
} from "./product.js";
import {
  TelemetryDebugInputSchema,
  TelemetryPreferencesInputSchema,
  TelemetryStateSchema,
  UiTelemetryInputSchema,
} from "./telemetry.js";
import {
  SaveSchoolProfileInputSchema,
  SchoolOnboardingStateSchema,
} from "./school-scan.js";

const runtimeInfoMethod = "getRuntimeInfo" as const;
const runtimeInfoChannel = "studi:runtime-info" as const;
const contractManifestMethod = "getContractManifest" as const;
const contractManifestChannel = "studi:contract-manifest" as const;
const getAuthStateMethod = "getAuthState" as const;
const getAuthStateChannel = "studi:auth-state" as const;
const signInMethod = "signIn" as const;
const signInChannel = "studi:sign-in" as const;
const signOutMethod = "signOut" as const;
const signOutChannel = "studi:sign-out" as const;
const retryEntitlementMethod = "retryEntitlement" as const;
const retryEntitlementChannel = "studi:retry-entitlement" as const;
const submitFeedbackMethod = "submitFeedback" as const;
const submitFeedbackChannel = "studi:submit-feedback" as const;
const workspaceStateMethod = "getWorkspaceState" as const;
const workspaceStateChannel = "studi:workspace-state" as const;
const navigateBrowserMethod = "navigateBrowser" as const;
const navigateBrowserChannel = "studi:navigate-browser" as const;
const loginOpenAiCodexMethod = "loginOpenAiCodex" as const;
const loginOpenAiCodexChannel = "studi:login-openai-codex" as const;
const cancelOpenAiCodexLoginMethod = "cancelOpenAiCodexLogin" as const;
const cancelOpenAiCodexLoginChannel = "studi:cancel-openai-codex-login" as const;
const selectAgentModelMethod = "selectAgentModel" as const;
const selectAgentModelChannel = "studi:select-agent-model" as const;
const getManagerStateMethod = "getManagerState" as const;
const getManagerStateChannel = "studi:manager-state" as const;
const runManagerMethod = "runManager" as const;
const runManagerChannel = "studi:run-manager" as const;
const getSchoolOnboardingStateMethod = "getSchoolOnboardingState" as const;
const getSchoolOnboardingStateChannel = "studi:school-onboarding-state" as const;
const saveSchoolProfileMethod = "saveSchoolProfile" as const;
const saveSchoolProfileChannel = "studi:save-school-profile" as const;
const startSchoolScanMethod = "startSchoolScan" as const;
const startSchoolScanChannel = "studi:start-school-scan" as const;
const resumeSchoolScanMethod = "resumeSchoolScan" as const;
const resumeSchoolScanChannel = "studi:resume-school-scan" as const;
const replaySchoolScanMethod = "replaySchoolScan" as const;
const replaySchoolScanChannel = "studi:replay-school-scan" as const;
const recordMissedCourseFeedbackMethod = "recordMissedCourseFeedback" as const;
const recordMissedCourseFeedbackChannel = "studi:record-missed-course-feedback" as const;
const getLifecycleStateMethod = "getLifecycleState" as const;
const getLifecycleStateChannel = "studi:lifecycle-state" as const;
const setAutomationPausedMethod = "setAutomationPaused" as const;
const setAutomationPausedChannel = "studi:set-automation-paused" as const;
const startNextAssignmentMethod = "startNextAssignment" as const;
const startNextAssignmentChannel = "studi:start-next-assignment" as const;
const startAssignmentMethod = "startAssignment" as const;
const startAssignmentChannel = "studi:start-assignment" as const;
const resumeAssignmentMethod = "resumeAssignment" as const;
const resumeAssignmentChannel = "studi:resume-assignment" as const;
const verifyStudentSubmissionMethod = "verifyStudentSubmission" as const;
const verifyStudentSubmissionChannel = "studi:verify-student-submission" as const;
const openAnswerArtifactMethod = "openAnswerArtifact" as const;
const openAnswerArtifactChannel = "studi:open-answer-artifact" as const;
const getProductSettingsMethod = "getProductSettings" as const;
const getProductSettingsChannel = "studi:product-settings" as const;
const saveProductPreferencesMethod = "saveProductPreferences" as const;
const saveProductPreferencesChannel = "studi:save-product-preferences" as const;
const savePermissionRuleMethod = "savePermissionRule" as const;
const savePermissionRuleChannel = "studi:save-permission-rule" as const;
const deletePermissionRuleMethod = "deletePermissionRule" as const;
const deletePermissionRuleChannel = "studi:delete-permission-rule" as const;
const configureScanScheduleMethod = "configureScanSchedule" as const;
const configureScanScheduleChannel = "studi:configure-scan-schedule" as const;
const getLibraryStateMethod = "getLibraryState" as const;
const getLibraryStateChannel = "studi:library-state" as const;
const getTaskDetailMethod = "getTaskDetail" as const;
const getTaskDetailChannel = "studi:task-detail" as const;
const readArtifactMethod = "readArtifact" as const;
const readArtifactChannel = "studi:read-artifact" as const;
const requestAssignmentTakeoverMethod = "requestAssignmentTakeover" as const;
const requestAssignmentTakeoverChannel = "studi:request-assignment-takeover" as const;
const cancelAssignmentMethod = "cancelAssignment" as const;
const cancelAssignmentChannel = "studi:cancel-assignment" as const;
const setBrowserLayoutMethod = "setBrowserLayout" as const;
const setBrowserLayoutChannel = "studi:set-browser-layout" as const;
const getTelemetryStateMethod = "getTelemetryState" as const;
const getTelemetryStateChannel = "studi:telemetry-state" as const;
const setTelemetryPreferencesMethod = "setTelemetryPreferences" as const;
const setTelemetryPreferencesChannel = "studi:set-telemetry-preferences" as const;
const setTelemetryDebugMethod = "setTelemetryDebug" as const;
const setTelemetryDebugChannel = "studi:set-telemetry-debug" as const;
const captureUiTelemetryMethod = "captureUiTelemetry" as const;
const captureUiTelemetryChannel = "studi:capture-ui-telemetry" as const;
const exportDiagnosticsMethod = "exportDiagnostics" as const;
const exportDiagnosticsChannel = "studi:export-diagnostics" as const;

export const RuntimeInfoSchema = z.strictObject({
  app: z.string().min(1),
  electron: z.string().min(1),
  chrome: z.string().min(1),
  node: z.string().min(1),
});

export type RuntimeInfo = z.infer<typeof RuntimeInfoSchema>;

const RuntimeInfoManifestEntrySchema = z.strictObject({
  method: z.literal(runtimeInfoMethod),
  channel: z.literal(runtimeInfoChannel),
});
const ContractManifestEntrySchema = z.strictObject({
  method: z.literal(contractManifestMethod),
  channel: z.literal(contractManifestChannel),
});
const GetAuthStateManifestEntrySchema = z.strictObject({ method: z.literal(getAuthStateMethod), channel: z.literal(getAuthStateChannel) });
const SignInManifestEntrySchema = z.strictObject({ method: z.literal(signInMethod), channel: z.literal(signInChannel) });
const SignOutManifestEntrySchema = z.strictObject({ method: z.literal(signOutMethod), channel: z.literal(signOutChannel) });
const RetryEntitlementManifestEntrySchema = z.strictObject({ method: z.literal(retryEntitlementMethod), channel: z.literal(retryEntitlementChannel) });
const SubmitFeedbackManifestEntrySchema = z.strictObject({ method: z.literal(submitFeedbackMethod), channel: z.literal(submitFeedbackChannel) });
const WorkspaceStateManifestEntrySchema = z.strictObject({
  method: z.literal(workspaceStateMethod),
  channel: z.literal(workspaceStateChannel),
});
const NavigateBrowserManifestEntrySchema = z.strictObject({
  method: z.literal(navigateBrowserMethod),
  channel: z.literal(navigateBrowserChannel),
});
const LoginOpenAiCodexManifestEntrySchema = z.strictObject({
  method: z.literal(loginOpenAiCodexMethod),
  channel: z.literal(loginOpenAiCodexChannel),
});
const CancelOpenAiCodexLoginManifestEntrySchema = z.strictObject({
  method: z.literal(cancelOpenAiCodexLoginMethod),
  channel: z.literal(cancelOpenAiCodexLoginChannel),
});
const SelectAgentModelManifestEntrySchema = z.strictObject({
  method: z.literal(selectAgentModelMethod),
  channel: z.literal(selectAgentModelChannel),
});
const GetManagerStateManifestEntrySchema = z.strictObject({
  method: z.literal(getManagerStateMethod),
  channel: z.literal(getManagerStateChannel),
});
const RunManagerManifestEntrySchema = z.strictObject({
  method: z.literal(runManagerMethod),
  channel: z.literal(runManagerChannel),
});
const GetSchoolOnboardingStateManifestEntrySchema = z.strictObject({
  method: z.literal(getSchoolOnboardingStateMethod),
  channel: z.literal(getSchoolOnboardingStateChannel),
});
const SaveSchoolProfileManifestEntrySchema = z.strictObject({
  method: z.literal(saveSchoolProfileMethod),
  channel: z.literal(saveSchoolProfileChannel),
});
const StartSchoolScanManifestEntrySchema = z.strictObject({
  method: z.literal(startSchoolScanMethod),
  channel: z.literal(startSchoolScanChannel),
});
const ResumeSchoolScanManifestEntrySchema = z.strictObject({
  method: z.literal(resumeSchoolScanMethod),
  channel: z.literal(resumeSchoolScanChannel),
});
const ReplaySchoolScanManifestEntrySchema = z.strictObject({
  method: z.literal(replaySchoolScanMethod),
  channel: z.literal(replaySchoolScanChannel),
});
const RecordMissedCourseFeedbackManifestEntrySchema = z.strictObject({
  method: z.literal(recordMissedCourseFeedbackMethod),
  channel: z.literal(recordMissedCourseFeedbackChannel),
});
const GetLifecycleStateManifestEntrySchema = z.strictObject({ method: z.literal(getLifecycleStateMethod), channel: z.literal(getLifecycleStateChannel) });
const SetAutomationPausedManifestEntrySchema = z.strictObject({ method: z.literal(setAutomationPausedMethod), channel: z.literal(setAutomationPausedChannel) });
const StartNextAssignmentManifestEntrySchema = z.strictObject({ method: z.literal(startNextAssignmentMethod), channel: z.literal(startNextAssignmentChannel) });
const StartAssignmentManifestEntrySchema = z.strictObject({ method: z.literal(startAssignmentMethod), channel: z.literal(startAssignmentChannel) });
const ResumeAssignmentManifestEntrySchema = z.strictObject({ method: z.literal(resumeAssignmentMethod), channel: z.literal(resumeAssignmentChannel) });
const VerifyStudentSubmissionManifestEntrySchema = z.strictObject({ method: z.literal(verifyStudentSubmissionMethod), channel: z.literal(verifyStudentSubmissionChannel) });
const OpenAnswerArtifactManifestEntrySchema = z.strictObject({ method: z.literal(openAnswerArtifactMethod), channel: z.literal(openAnswerArtifactChannel) });
const GetProductSettingsManifestEntrySchema = z.strictObject({ method: z.literal(getProductSettingsMethod), channel: z.literal(getProductSettingsChannel) });
const SaveProductPreferencesManifestEntrySchema = z.strictObject({ method: z.literal(saveProductPreferencesMethod), channel: z.literal(saveProductPreferencesChannel) });
const SavePermissionRuleManifestEntrySchema = z.strictObject({ method: z.literal(savePermissionRuleMethod), channel: z.literal(savePermissionRuleChannel) });
const DeletePermissionRuleManifestEntrySchema = z.strictObject({ method: z.literal(deletePermissionRuleMethod), channel: z.literal(deletePermissionRuleChannel) });
const ConfigureScanScheduleManifestEntrySchema = z.strictObject({ method: z.literal(configureScanScheduleMethod), channel: z.literal(configureScanScheduleChannel) });
const GetLibraryStateManifestEntrySchema = z.strictObject({ method: z.literal(getLibraryStateMethod), channel: z.literal(getLibraryStateChannel) });
const GetTaskDetailManifestEntrySchema = z.strictObject({ method: z.literal(getTaskDetailMethod), channel: z.literal(getTaskDetailChannel) });
const ReadArtifactManifestEntrySchema = z.strictObject({ method: z.literal(readArtifactMethod), channel: z.literal(readArtifactChannel) });
const RequestAssignmentTakeoverManifestEntrySchema = z.strictObject({ method: z.literal(requestAssignmentTakeoverMethod), channel: z.literal(requestAssignmentTakeoverChannel) });
const CancelAssignmentManifestEntrySchema = z.strictObject({ method: z.literal(cancelAssignmentMethod), channel: z.literal(cancelAssignmentChannel) });
const SetBrowserLayoutManifestEntrySchema = z.strictObject({ method: z.literal(setBrowserLayoutMethod), channel: z.literal(setBrowserLayoutChannel) });
const GetTelemetryStateManifestEntrySchema = z.strictObject({ method: z.literal(getTelemetryStateMethod), channel: z.literal(getTelemetryStateChannel) });
const SetTelemetryPreferencesManifestEntrySchema = z.strictObject({ method: z.literal(setTelemetryPreferencesMethod), channel: z.literal(setTelemetryPreferencesChannel) });
const SetTelemetryDebugManifestEntrySchema = z.strictObject({ method: z.literal(setTelemetryDebugMethod), channel: z.literal(setTelemetryDebugChannel) });
const CaptureUiTelemetryManifestEntrySchema = z.strictObject({ method: z.literal(captureUiTelemetryMethod), channel: z.literal(captureUiTelemetryChannel) });
const ExportDiagnosticsManifestEntrySchema = z.strictObject({ method: z.literal(exportDiagnosticsMethod), channel: z.literal(exportDiagnosticsChannel) });

export const ContractManifestSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  contractVersion: z.literal("10"),
  ipcMethods: z.tuple([
    RuntimeInfoManifestEntrySchema,
    ContractManifestEntrySchema,
    GetAuthStateManifestEntrySchema,
    SignInManifestEntrySchema,
    SignOutManifestEntrySchema,
    RetryEntitlementManifestEntrySchema,
    SubmitFeedbackManifestEntrySchema,
    WorkspaceStateManifestEntrySchema,
    NavigateBrowserManifestEntrySchema,
    LoginOpenAiCodexManifestEntrySchema,
    CancelOpenAiCodexLoginManifestEntrySchema,
    SelectAgentModelManifestEntrySchema,
    GetManagerStateManifestEntrySchema,
    RunManagerManifestEntrySchema,
    GetSchoolOnboardingStateManifestEntrySchema,
    SaveSchoolProfileManifestEntrySchema,
    StartSchoolScanManifestEntrySchema,
    ResumeSchoolScanManifestEntrySchema,
    ReplaySchoolScanManifestEntrySchema,
    RecordMissedCourseFeedbackManifestEntrySchema,
    GetLifecycleStateManifestEntrySchema,
    SetAutomationPausedManifestEntrySchema,
    StartNextAssignmentManifestEntrySchema,
    StartAssignmentManifestEntrySchema,
    ResumeAssignmentManifestEntrySchema,
    VerifyStudentSubmissionManifestEntrySchema,
    OpenAnswerArtifactManifestEntrySchema,
    GetProductSettingsManifestEntrySchema,
    SaveProductPreferencesManifestEntrySchema,
    SavePermissionRuleManifestEntrySchema,
    DeletePermissionRuleManifestEntrySchema,
    ConfigureScanScheduleManifestEntrySchema,
    GetLibraryStateManifestEntrySchema,
    GetTaskDetailManifestEntrySchema,
    ReadArtifactManifestEntrySchema,
    RequestAssignmentTakeoverManifestEntrySchema,
    CancelAssignmentManifestEntrySchema,
    SetBrowserLayoutManifestEntrySchema,
    GetTelemetryStateManifestEntrySchema,
    SetTelemetryPreferencesManifestEntrySchema,
    SetTelemetryDebugManifestEntrySchema,
    CaptureUiTelemetryManifestEntrySchema,
    ExportDiagnosticsManifestEntrySchema,
  ]),
});

export type ContractManifest = z.infer<typeof ContractManifestSchema>;

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
    : [request: z.input<Definition["requestSchema"]>];

type IpcMethod<Definition extends IpcMethodDefinition> = (
  ...args: RequestArguments<Definition>
) => Promise<z.output<Definition["resultSchema"]>>;

export type IpcApi<Registry extends IpcRegistryDefinition> = Readonly<{
  [Method in keyof Registry]: IpcMethod<Registry[Method]>;
}>;

type IpcHandler<Definition extends IpcMethodDefinition> = (
  request: z.output<Definition["requestSchema"]>,
) =>
  | z.input<Definition["resultSchema"]>
  | Promise<z.input<Definition["resultSchema"]>>;

export type IpcHandlers<Registry extends IpcRegistryDefinition> = Readonly<{
  [Method in keyof Registry]: IpcHandler<Registry[Method]>;
}>;

export type IpcHandlerRegistration = Readonly<{
  channel: string;
  handle: (rawRequest: unknown) => Promise<unknown>;
}>;

export const studiIpcRegistry = Object.freeze({
  [runtimeInfoMethod]: Object.freeze({
    channel: runtimeInfoChannel,
    requestSchema: z.undefined(),
    resultSchema: RuntimeInfoSchema,
  }),
  [contractManifestMethod]: Object.freeze({
    channel: contractManifestChannel,
    requestSchema: z.undefined(),
    resultSchema: ContractManifestSchema,
  }),
  [getAuthStateMethod]: Object.freeze({
    channel: getAuthStateChannel,
    requestSchema: z.undefined(),
    resultSchema: AuthStateSchema,
  }),
  [signInMethod]: Object.freeze({
    channel: signInChannel,
    requestSchema: z.undefined(),
    resultSchema: AuthStateSchema,
  }),
  [signOutMethod]: Object.freeze({
    channel: signOutChannel,
    requestSchema: z.undefined(),
    resultSchema: AuthStateSchema,
  }),
  [retryEntitlementMethod]: Object.freeze({
    channel: retryEntitlementChannel,
    requestSchema: z.undefined(),
    resultSchema: AuthStateSchema,
  }),
  [submitFeedbackMethod]: Object.freeze({
    channel: submitFeedbackChannel,
    requestSchema: z.strictObject({ message: z.string().trim().min(1).max(1_000) }),
    resultSchema: FeedbackReceiptSchema,
  }),
  [workspaceStateMethod]: Object.freeze({
    channel: workspaceStateChannel,
    requestSchema: z.undefined(),
    resultSchema: StudiWorkspaceStateSchema,
  }),
  [navigateBrowserMethod]: Object.freeze({
    channel: navigateBrowserChannel,
    requestSchema: z.strictObject({ url: z.string().min(1).max(2_048) }),
    resultSchema: StudiWorkspaceStateSchema,
  }),
  [loginOpenAiCodexMethod]: Object.freeze({
    channel: loginOpenAiCodexChannel,
    requestSchema: z.undefined(),
    resultSchema: StudiWorkspaceStateSchema,
  }),
  [cancelOpenAiCodexLoginMethod]: Object.freeze({
    channel: cancelOpenAiCodexLoginChannel,
    requestSchema: z.undefined(),
    resultSchema: StudiWorkspaceStateSchema,
  }),
  [selectAgentModelMethod]: Object.freeze({
    channel: selectAgentModelChannel,
    requestSchema: z.strictObject({
      modelId: z.string().min(1),
      reasoningEffort: AgentReasoningEffortSchema,
    }),
    resultSchema: StudiWorkspaceStateSchema,
  }),
  [getManagerStateMethod]: Object.freeze({
    channel: getManagerStateChannel,
    requestSchema: z.undefined(),
    resultSchema: ManagerStateSchema,
  }),
  [runManagerMethod]: Object.freeze({
    channel: runManagerChannel,
    requestSchema: z.strictObject({
      prompt: z.string().trim().min(1).max(20_000),
      memoryArtifactIds: z.array(z.string().min(1).max(128)).max(20),
    }),
    resultSchema: ManagerTurnResultSchema,
  }),
  [getSchoolOnboardingStateMethod]: Object.freeze({
    channel: getSchoolOnboardingStateChannel,
    requestSchema: z.undefined(),
    resultSchema: SchoolOnboardingStateSchema,
  }),
  [saveSchoolProfileMethod]: Object.freeze({
    channel: saveSchoolProfileChannel,
    requestSchema: SaveSchoolProfileInputSchema,
    resultSchema: SchoolOnboardingStateSchema,
  }),
  [startSchoolScanMethod]: Object.freeze({
    channel: startSchoolScanChannel,
    requestSchema: z.undefined(),
    resultSchema: SchoolOnboardingStateSchema,
  }),
  [resumeSchoolScanMethod]: Object.freeze({
    channel: resumeSchoolScanChannel,
    requestSchema: z.undefined(),
    resultSchema: SchoolOnboardingStateSchema,
  }),
  [replaySchoolScanMethod]: Object.freeze({
    channel: replaySchoolScanChannel,
    requestSchema: z.undefined(),
    resultSchema: SchoolOnboardingStateSchema,
  }),
  [recordMissedCourseFeedbackMethod]: Object.freeze({
    channel: recordMissedCourseFeedbackChannel,
    requestSchema: z.strictObject({ feedback: z.string().trim().min(1).max(500) }),
    resultSchema: SchoolOnboardingStateSchema,
  }),
  [getLifecycleStateMethod]: Object.freeze({
    channel: getLifecycleStateChannel,
    requestSchema: z.undefined(),
    resultSchema: LifecycleStateSchema,
  }),
  [setAutomationPausedMethod]: Object.freeze({
    channel: setAutomationPausedChannel,
    requestSchema: z.strictObject({ paused: z.boolean() }),
    resultSchema: LifecycleStateSchema,
  }),
  [startNextAssignmentMethod]: Object.freeze({
    channel: startNextAssignmentChannel,
    requestSchema: z.undefined(),
    resultSchema: LifecycleStateSchema,
  }),
  [startAssignmentMethod]: Object.freeze({
    channel: startAssignmentChannel,
    requestSchema: z.strictObject({ taskId: z.string().min(1).max(256) }),
    resultSchema: LifecycleStateSchema,
  }),
  [resumeAssignmentMethod]: Object.freeze({
    channel: resumeAssignmentChannel,
    requestSchema: z.strictObject({ taskId: z.string().min(1).max(256) }),
    resultSchema: LifecycleStateSchema,
  }),
  [verifyStudentSubmissionMethod]: Object.freeze({
    channel: verifyStudentSubmissionChannel,
    requestSchema: z.strictObject({ taskId: z.string().min(1).max(256), confirmationText: z.string().trim().min(1).max(500) }),
    resultSchema: LifecycleStateSchema,
  }),
  [openAnswerArtifactMethod]: Object.freeze({
    channel: openAnswerArtifactChannel,
    requestSchema: z.strictObject({ taskId: z.string().min(1).max(256) }),
    resultSchema: z.boolean(),
  }),
  [getProductSettingsMethod]: Object.freeze({
    channel: getProductSettingsChannel,
    requestSchema: z.undefined(),
    resultSchema: ProductSettingsStateSchema,
  }),
  [saveProductPreferencesMethod]: Object.freeze({
    channel: saveProductPreferencesChannel,
    requestSchema: SaveProductPreferencesInputSchema,
    resultSchema: ProductPreferencesSchema,
  }),
  [savePermissionRuleMethod]: Object.freeze({
    channel: savePermissionRuleChannel,
    requestSchema: SavePermissionRuleInputSchema,
    resultSchema: ProductSettingsStateSchema,
  }),
  [deletePermissionRuleMethod]: Object.freeze({
    channel: deletePermissionRuleChannel,
    requestSchema: z.strictObject({ ruleId: z.string().min(1).max(256) }),
    resultSchema: ProductSettingsStateSchema,
  }),
  [configureScanScheduleMethod]: Object.freeze({
    channel: configureScanScheduleChannel,
    requestSchema: z.strictObject({
      cadence: z.enum(["manual", "daily", "weekly"]),
      localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
      weekday: z.number().int().min(0).max(6).optional(),
    }),
    resultSchema: ProductSettingsStateSchema,
  }),
  [getLibraryStateMethod]: Object.freeze({
    channel: getLibraryStateChannel,
    requestSchema: z.undefined(),
    resultSchema: LibraryStateSchema,
  }),
  [getTaskDetailMethod]: Object.freeze({
    channel: getTaskDetailChannel,
    requestSchema: z.strictObject({ taskId: z.string().min(1).max(256) }),
    resultSchema: TaskDetailSchema,
  }),
  [readArtifactMethod]: Object.freeze({
    channel: readArtifactChannel,
    requestSchema: ReadArtifactInputSchema,
    resultSchema: ArtifactDocumentSchema.nullable(),
  }),
  [requestAssignmentTakeoverMethod]: Object.freeze({
    channel: requestAssignmentTakeoverChannel,
    requestSchema: z.strictObject({ taskId: z.string().min(1).max(256) }),
    resultSchema: LifecycleStateSchema,
  }),
  [cancelAssignmentMethod]: Object.freeze({
    channel: cancelAssignmentChannel,
    requestSchema: z.strictObject({ taskId: z.string().min(1).max(256) }),
    resultSchema: LifecycleStateSchema,
  }),
  [setBrowserLayoutMethod]: Object.freeze({
    channel: setBrowserLayoutChannel,
    requestSchema: z.strictObject({ mode: BrowserLayoutModeSchema }),
    resultSchema: BrowserLayoutModeSchema,
  }),
  [getTelemetryStateMethod]: Object.freeze({
    channel: getTelemetryStateChannel,
    requestSchema: z.undefined(),
    resultSchema: TelemetryStateSchema,
  }),
  [setTelemetryPreferencesMethod]: Object.freeze({
    channel: setTelemetryPreferencesChannel,
    requestSchema: TelemetryPreferencesInputSchema,
    resultSchema: TelemetryStateSchema,
  }),
  [setTelemetryDebugMethod]: Object.freeze({
    channel: setTelemetryDebugChannel,
    requestSchema: TelemetryDebugInputSchema,
    resultSchema: TelemetryStateSchema,
  }),
  [captureUiTelemetryMethod]: Object.freeze({
    channel: captureUiTelemetryChannel,
    requestSchema: UiTelemetryInputSchema,
    resultSchema: z.boolean(),
  }),
  [exportDiagnosticsMethod]: Object.freeze({
    channel: exportDiagnosticsChannel,
    requestSchema: z.undefined(),
    resultSchema: DiagnosticsExportReceiptSchema,
  }),
});

export type StudiIpcRegistry = typeof studiIpcRegistry;
export type StudiIpcMethod = keyof StudiIpcRegistry;

export const studiIpcMethods = Object.freeze(
  Object.keys(studiIpcRegistry) as StudiIpcMethod[],
);

export type StudiApi = IpcApi<StudiIpcRegistry>;

export type StudiIpcHandlers = IpcHandlers<StudiIpcRegistry>;

function createIpcMethod<Definition extends IpcMethodDefinition>(
  method: string,
  contract: Definition,
  invoke: IpcInvoke,
): IpcMethod<Definition> {
  return async (...args: RequestArguments<Definition>) => {
    const suppliedArguments: readonly unknown[] = args;
    const expectsNoArguments = contract.requestSchema instanceof z.ZodUndefined;
    const expectedArgumentCount = expectsNoArguments ? 0 : 1;

    if (suppliedArguments.length !== expectedArgumentCount) {
      throw new TypeError(
        `IPC method ${method} expects ${expectedArgumentCount} argument${expectedArgumentCount === 1 ? "" : "s"}; received ${suppliedArguments.length}`,
      );
    }

    const rawRequest = expectsNoArguments ? undefined : suppliedArguments[0];
    return invoke(contract.channel, rawRequest) as Promise<
      z.output<Definition["resultSchema"]>
    >;
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
    const request = contract.requestSchema.parse(rawRequest) as z.output<
      Definition["requestSchema"]
    >;
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

const contractManifest = ContractManifestSchema.parse({
  schemaVersion: STUDI_SCHEMA_VERSION,
  contractVersion: "10",
  ipcMethods: studiIpcMethods.map((method) => ({
    method,
    channel: studiIpcRegistry[method].channel,
  })),
});
for (const entry of contractManifest.ipcMethods) {
  Object.freeze(entry);
}
Object.freeze(contractManifest.ipcMethods);
export const CONTRACT_MANIFEST: ContractManifest = Object.freeze(contractManifest);
