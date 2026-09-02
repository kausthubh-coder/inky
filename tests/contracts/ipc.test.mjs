import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { z } from "zod";

import {
  CONTRACT_MANIFEST,
  ContractManifestSchema,
  RuntimeInfoSchema,
  createIpcApi,
  createIpcHandlerRegistrations,
  studiIpcMethods,
  studiIpcRegistry,
} from "../../dist/shared/index.js";

const execFileAsync = promisify(execFile);

function composeIpc(registry, handlers, calls) {
  const registrations = createIpcHandlerRegistrations(registry, handlers);
  return createIpcApi(registry, async (channel, request) => {
    calls.push({ channel, request });
    const registration = registrations.find((candidate) => candidate.channel === channel);
    assert.ok(registration, `unregistered IPC channel: ${channel}`);
    return registration.handle(request);
  });
}

test("composed IPC validates and forwards request-bearing and void methods", async () => {
  const calls = [];
  let malformedResponse = false;
  const registry = Object.freeze({
    findAssignment: Object.freeze({
      channel: "synthetic:find-assignment",
      requestSchema: z.strictObject({ assignmentId: z.string().min(1) }),
      resultSchema: z.strictObject({ title: z.string().min(1) }),
    }),
    getStatus: Object.freeze({
      channel: "synthetic:get-status",
      requestSchema: z.undefined(),
      resultSchema: z.strictObject({ ready: z.boolean() }),
    }),
  });
  const api = composeIpc(registry, {
    findAssignment: (request) =>
      malformedResponse ? { title: 17 } : { title: `Assignment ${request.assignmentId}` },
    getStatus: () => ({ ready: true }),
  }, calls);

  await assert.rejects(
    api.findAssignment(),
    /IPC method findAssignment expects 1 argument; received 0/,
  );
  await assert.rejects(
    api.findAssignment({ assignmentId: "assignment-1" }, "extra"),
    /IPC method findAssignment expects 1 argument; received 2/,
  );
  await assert.rejects(api.findAssignment({ assignmentId: "" }), z.ZodError);
  assert.equal(calls.length, 1, "invalid requests cross transport once and fail before handler");

  assert.deepEqual(await api.findAssignment({ assignmentId: "assignment-1" }), {
    title: "Assignment assignment-1",
  });
  assert.deepEqual(calls[1], {
    channel: "synthetic:find-assignment",
    request: { assignmentId: "assignment-1" },
  });

  malformedResponse = true;
  await assert.rejects(api.findAssignment({ assignmentId: "assignment-2" }), z.ZodError);
  assert.deepEqual(calls[2], {
    channel: "synthetic:find-assignment",
    request: { assignmentId: "assignment-2" },
  });

  await assert.rejects(
    api.getStatus({ unexpected: true }),
    /IPC method getStatus expects 0 arguments; received 1/,
  );
  assert.equal(calls.length, 3, "void methods must reject extra arguments before invoke");
  assert.deepEqual(await api.getStatus(), { ready: true });
  assert.deepEqual(calls[3], { channel: "synthetic:get-status", request: undefined });
});

test("composed IPC transforms request and result exactly once at the main boundary", async () => {
  const transportCalls = [];
  const handlerRequests = [];
  let requestTransforms = 0;
  let resultTransforms = 0;
  let handlerCalls = 0;
  let malformedResult = false;
  const registry = Object.freeze({
    measure: Object.freeze({
      channel: "synthetic:measure",
      requestSchema: z.string().transform((value) => {
        requestTransforms += 1;
        return value.length;
      }),
      resultSchema: z.string().transform((value) => {
        resultTransforms += 1;
        return value.length;
      }),
    }),
  });
  const api = composeIpc(registry, {
    measure: (request) => {
      handlerCalls += 1;
      handlerRequests.push(request);
      return malformedResult ? 17 : "accepted";
    },
  }, transportCalls);

  const result = await api.measure("studi");
  assert.equal(result, 8);
  assert.equal(requestTransforms, 1);
  assert.equal(resultTransforms, 1);
  assert.equal(handlerCalls, 1);
  assert.deepEqual(handlerRequests, [5]);
  assert.deepEqual(transportCalls, [{ channel: "synthetic:measure", request: "studi" }]);

  await assert.rejects(api.measure(5), z.ZodError);
  assert.equal(requestTransforms, 1, "invalid base input must not reach the request transform");
  assert.equal(resultTransforms, 1);
  assert.equal(handlerCalls, 1, "invalid request must fail before the typed handler");
  assert.deepEqual(transportCalls[1], { channel: "synthetic:measure", request: 5 });

  malformedResult = true;
  await assert.rejects(api.measure("again"), z.ZodError);
  assert.equal(requestTransforms, 2);
  assert.equal(resultTransforms, 1, "malformed base output must not reach the result transform");
  assert.equal(handlerCalls, 2);
  assert.deepEqual(handlerRequests, [5, 5]);
  assert.deepEqual(transportCalls[2], { channel: "synthetic:measure", request: "again" });
  assert.equal(transportCalls.length, 3, "each call must invoke its fixed channel exactly once");
});

test("IPC API factory keeps exact arity before transport", async () => {
  const calls = [];
  const registry = Object.freeze({
    measure: Object.freeze({
      channel: "synthetic:measure",
      requestSchema: z.string().transform((value) => value.length),
      resultSchema: z.string().transform((value) => value.length),
    }),
  });
  const api = createIpcApi(registry, async (channel, request) => {
    calls.push({ channel, request });
    return 8;
  });

  assert.equal(Object.isFrozen(api), true);
  assert.deepEqual(Object.keys(api), ["measure"]);
  assert.equal(await api.measure("studi"), 8);
  assert.deepEqual(calls, [{ channel: "synthetic:measure", request: "studi" }]);
  await assert.rejects(api.measure(), /expects 1 argument; received 0/);
  await assert.rejects(api.measure("studi", "extra"), /expects 1 argument; received 2/);
  assert.equal(calls.length, 1);
});

test("IPC API factory propagates invoke errors without parsing at the caller", async () => {
  let requestTransforms = 0;
  let resultTransforms = 0;
  const invokeError = new Error("synthetic invoke failure");
  const registry = Object.freeze({
    measure: Object.freeze({
      channel: "synthetic:measure",
      requestSchema: z.string().transform((value) => {
        requestTransforms += 1;
        return value.length;
      }),
      resultSchema: z.string().transform((value) => {
        resultTransforms += 1;
        return value.length;
      }),
    }),
  });
  const api = createIpcApi(registry, async () => {
    throw invokeError;
  });

  await assert.rejects(api.measure("studi"), (error) => error === invokeError);
  assert.equal(requestTransforms, 0);
  assert.equal(resultTransforms, 0);
});

test("composed IPC propagates handler errors after one request parse", async () => {
  const calls = [];
  let requestTransforms = 0;
  const handlerError = new Error("synthetic handler failure");
  const registry = Object.freeze({
    measure: Object.freeze({
      channel: "synthetic:measure",
      requestSchema: z.string().transform((value) => {
        requestTransforms += 1;
        return value.length;
      }),
      resultSchema: z.string().transform((value) => value.length),
    }),
  });
  const api = composeIpc(registry, {
    measure: () => {
      throw handlerError;
    },
  }, calls);

  await assert.rejects(api.measure("studi"), (error) => error === handlerError);
  assert.equal(requestTransforms, 1);
  assert.deepEqual(calls, [{ channel: "synthetic:measure", request: "studi" }]);
});

test("IPC caller types use request schema input and result schema output", async () => {
  const tscPath = fileURLToPath(
    new URL("../../node_modules/typescript/bin/tsc", import.meta.url),
  );
  const configPath = fileURLToPath(new URL("./tsconfig.ipc-types.json", import.meta.url));

  await execFileAsync(process.execPath, [tscPath, "-p", configPath], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
  });
});

test("IPC registry snapshot contains the fixed desktop workspace channels", () => {
  assert.deepEqual(studiIpcMethods, [
    "getRuntimeInfo",
    "getContractManifest",
    "getAuthState",
    "signIn",
    "signOut",
    "retryEntitlement",
    "submitFeedback",
    "getWorkspaceState",
    "navigateBrowser",
    "loginOpenAiCodex",
    "cancelOpenAiCodexLogin",
    "selectAgentModel",
    "getManagerState",
    "runManager",
    "getSchoolOnboardingState",
    "saveSchoolProfile",
    "startSchoolScan",
    "resumeSchoolScan",
    "replaySchoolScan",
    "recordMissedCourseFeedback",
    "getLifecycleState",
    "setAutomationPaused",
    "startNextAssignment",
    "resumeAssignment",
    "verifyStudentSubmission",
    "openAnswerArtifact",
    "getProductSettings",
    "saveProductPreferences",
    "savePermissionRule",
    "deletePermissionRule",
    "configureScanSchedule",
    "getLibraryState",
    "getTaskDetail",
    "readArtifact",
    "requestAssignmentTakeover",
    "cancelAssignment",
    "setBrowserLayout",
    "getTelemetryState",
    "setTelemetryPreferences",
    "setTelemetryDebug",
    "captureUiTelemetry",
    "exportDiagnostics",
  ]);
  assert.deepEqual(
    Object.fromEntries(studiIpcMethods.map((method) => [method, studiIpcRegistry[method].channel])),
    {
      getRuntimeInfo: "studi:runtime-info",
      getContractManifest: "studi:contract-manifest",
      getAuthState: "studi:auth-state",
      signIn: "studi:sign-in",
      signOut: "studi:sign-out",
      retryEntitlement: "studi:retry-entitlement",
      submitFeedback: "studi:submit-feedback",
      getWorkspaceState: "studi:workspace-state",
      navigateBrowser: "studi:navigate-browser",
      loginOpenAiCodex: "studi:login-openai-codex",
      cancelOpenAiCodexLogin: "studi:cancel-openai-codex-login",
      selectAgentModel: "studi:select-agent-model",
      getManagerState: "studi:manager-state",
      runManager: "studi:run-manager",
      getSchoolOnboardingState: "studi:school-onboarding-state",
      saveSchoolProfile: "studi:save-school-profile",
      startSchoolScan: "studi:start-school-scan",
      resumeSchoolScan: "studi:resume-school-scan",
      replaySchoolScan: "studi:replay-school-scan",
      recordMissedCourseFeedback: "studi:record-missed-course-feedback",
      getLifecycleState: "studi:lifecycle-state",
      setAutomationPaused: "studi:set-automation-paused",
      startNextAssignment: "studi:start-next-assignment",
      resumeAssignment: "studi:resume-assignment",
      verifyStudentSubmission: "studi:verify-student-submission",
      openAnswerArtifact: "studi:open-answer-artifact",
      getProductSettings: "studi:product-settings",
      saveProductPreferences: "studi:save-product-preferences",
      savePermissionRule: "studi:save-permission-rule",
      deletePermissionRule: "studi:delete-permission-rule",
      configureScanSchedule: "studi:configure-scan-schedule",
      getLibraryState: "studi:library-state",
      getTaskDetail: "studi:task-detail",
      readArtifact: "studi:read-artifact",
      requestAssignmentTakeover: "studi:request-assignment-takeover",
      cancelAssignment: "studi:cancel-assignment",
      setBrowserLayout: "studi:set-browser-layout",
      getTelemetryState: "studi:telemetry-state",
      setTelemetryPreferences: "studi:set-telemetry-preferences",
      setTelemetryDebug: "studi:set-telemetry-debug",
      captureUiTelemetry: "studi:capture-ui-telemetry",
      exportDiagnostics: "studi:export-diagnostics",
    },
  );
  assert.deepEqual(CONTRACT_MANIFEST, {
    schemaVersion: 1,
    contractVersion: "9",
    ipcMethods: [
      { method: "getRuntimeInfo", channel: "studi:runtime-info" },
      { method: "getContractManifest", channel: "studi:contract-manifest" },
      { method: "getAuthState", channel: "studi:auth-state" },
      { method: "signIn", channel: "studi:sign-in" },
      { method: "signOut", channel: "studi:sign-out" },
      { method: "retryEntitlement", channel: "studi:retry-entitlement" },
      { method: "submitFeedback", channel: "studi:submit-feedback" },
      { method: "getWorkspaceState", channel: "studi:workspace-state" },
      { method: "navigateBrowser", channel: "studi:navigate-browser" },
      { method: "loginOpenAiCodex", channel: "studi:login-openai-codex" },
      { method: "cancelOpenAiCodexLogin", channel: "studi:cancel-openai-codex-login" },
      { method: "selectAgentModel", channel: "studi:select-agent-model" },
      { method: "getManagerState", channel: "studi:manager-state" },
      { method: "runManager", channel: "studi:run-manager" },
      { method: "getSchoolOnboardingState", channel: "studi:school-onboarding-state" },
      { method: "saveSchoolProfile", channel: "studi:save-school-profile" },
      { method: "startSchoolScan", channel: "studi:start-school-scan" },
      { method: "resumeSchoolScan", channel: "studi:resume-school-scan" },
      { method: "replaySchoolScan", channel: "studi:replay-school-scan" },
      { method: "recordMissedCourseFeedback", channel: "studi:record-missed-course-feedback" },
      { method: "getLifecycleState", channel: "studi:lifecycle-state" },
      { method: "setAutomationPaused", channel: "studi:set-automation-paused" },
      { method: "startNextAssignment", channel: "studi:start-next-assignment" },
      { method: "resumeAssignment", channel: "studi:resume-assignment" },
      { method: "verifyStudentSubmission", channel: "studi:verify-student-submission" },
      { method: "openAnswerArtifact", channel: "studi:open-answer-artifact" },
      { method: "getProductSettings", channel: "studi:product-settings" },
      { method: "saveProductPreferences", channel: "studi:save-product-preferences" },
      { method: "savePermissionRule", channel: "studi:save-permission-rule" },
      { method: "deletePermissionRule", channel: "studi:delete-permission-rule" },
      { method: "configureScanSchedule", channel: "studi:configure-scan-schedule" },
      { method: "getLibraryState", channel: "studi:library-state" },
      { method: "getTaskDetail", channel: "studi:task-detail" },
      { method: "readArtifact", channel: "studi:read-artifact" },
      { method: "requestAssignmentTakeover", channel: "studi:request-assignment-takeover" },
      { method: "cancelAssignment", channel: "studi:cancel-assignment" },
      { method: "setBrowserLayout", channel: "studi:set-browser-layout" },
      { method: "getTelemetryState", channel: "studi:telemetry-state" },
      { method: "setTelemetryPreferences", channel: "studi:set-telemetry-preferences" },
      { method: "setTelemetryDebug", channel: "studi:set-telemetry-debug" },
      { method: "captureUiTelemetry", channel: "studi:capture-ui-telemetry" },
      { method: "exportDiagnostics", channel: "studi:export-diagnostics" },
    ],
  });
});

test("IPC request and result schemas reject malformed values", () => {
  for (const method of [
    "getRuntimeInfo",
    "getContractManifest",
    "getAuthState",
    "signIn",
    "signOut",
    "retryEntitlement",
    "getWorkspaceState",
    "loginOpenAiCodex",
    "cancelOpenAiCodexLogin",
    "getManagerState",
    "getSchoolOnboardingState",
    "startSchoolScan",
    "resumeSchoolScan",
    "replaySchoolScan",
    "getLifecycleState",
    "startNextAssignment",
    "getProductSettings",
    "getLibraryState",
    "getTelemetryState",
    "exportDiagnostics",
  ]) {
    assert.equal(studiIpcRegistry[method].requestSchema.safeParse(undefined).success, true);
    assert.equal(studiIpcRegistry[method].requestSchema.safeParse({}).success, false);
  }
  assert.equal(studiIpcRegistry.navigateBrowser.requestSchema.safeParse({ url: "" }).success, false);
  assert.equal(studiIpcRegistry.submitFeedback.requestSchema.safeParse({ message: "" }).success, false);
  assert.equal(studiIpcRegistry.submitFeedback.requestSchema.safeParse({ message: "A".repeat(1_001) }).success, false);
  assert.equal(studiIpcRegistry.selectAgentModel.requestSchema.safeParse({ modelId: "" }).success, false);
  assert.equal(studiIpcRegistry.selectAgentModel.requestSchema.safeParse({ modelId: "gpt-5.6-sol" }).success, false);
  assert.equal(studiIpcRegistry.selectAgentModel.requestSchema.safeParse({ modelId: "gpt-5.6-sol", reasoningEffort: "high" }).success, true);
  assert.equal(
    studiIpcRegistry.runManager.requestSchema.safeParse({ prompt: "   ", memoryArtifactIds: [] }).success,
    false,
  );
  assert.equal(
    studiIpcRegistry.runManager.requestSchema.safeParse({ prompt: "Inspect", memoryArtifactIds: [""] }).success,
    false,
  );

  assert.equal(RuntimeInfoSchema.safeParse({ app: "1", electron: "1", chrome: "1" }).success, false);
  assert.equal(
    ContractManifestSchema.safeParse({ ...CONTRACT_MANIFEST, schemaVersion: 2 }).success,
    false,
  );
  assert.equal(
    ContractManifestSchema.safeParse({
      ...CONTRACT_MANIFEST,
      ipcMethods: [...CONTRACT_MANIFEST.ipcMethods].reverse(),
    }).success,
    false,
  );
});

test("preload derives named methods and exposes no caller-selected channel primitive", async () => {
  const preload = await readFile(new URL("../../electron/preload.cts", import.meta.url), "utf8");
  const main = await readFile(new URL("../../electron/main.ts", import.meta.url), "utf8");
  const ipcSource = await readFile(new URL("../../shared/ipc.ts", import.meta.url), "utf8");
  const rendererTypes = await readFile(new URL("../../src/types/window.d.ts", import.meta.url), "utf8");

  assert.match(preload, /createIpcApi\(studiIpcRegistry/);
  assert.match(preload, /ipcRenderer\.invoke\(channel, request\)/);
  assert.doesNotMatch(preload, /studi:/);
  assert.doesNotMatch(preload, /ipcRenderer\.(?:send|sendSync|on|once)\s*\(/);
  assert.doesNotMatch(preload, /\b(?:invoke|send|on)\s*:\s*\([^)]*channel/);
  assert.match(ipcSource, /getRuntimeInfo/);
  assert.match(ipcSource, /getContractManifest/);
  assert.match(ipcSource, /createIpcHandlerRegistrations/);
  assert.match(main, /createIpcHandlerRegistrations\(studiIpcRegistry, ipcHandlers\)/);
  assert.match(rendererTypes, /shared\/index\.js/);
});

test("runtime-info shape is declared only by the shared schema", async () => {
  const sources = await Promise.all(
    ["../../electron/main.ts", "../../electron/preload.cts", "../../src/app/StudiApp.tsx"].map((path) =>
      readFile(new URL(path, import.meta.url), "utf8"),
    ),
  );
  for (const source of sources) {
    assert.doesNotMatch(source, /interface\s+(?:Studi)?RuntimeInfo/);
  }
});
