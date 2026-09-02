import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  VERSION,
  createAgentSession,
  defineTool,
  type AgentSession as PiAgentSession,
  type AgentSessionEvent,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import {
  AgentRunEventSchema,
  DEFAULT_AGENT_MODEL_ID,
  DEFAULT_AGENT_REASONING_EFFORT,
  ProviderStatusSchema,
  STUDI_SCHEMA_VERSION,
  type AgentReasoningEffort,
  type AgentRunEvent,
  type AgentModel,
  type ProviderLoginMethod,
  type ProviderStatus,
} from "../../shared/index.js";
import type { BrowserController } from "../browser/controller.js";
import { createBrowserTools } from "../browser/tools.js";

type PiSessionOptions = NonNullable<Parameters<typeof createAgentSession>[0]>;
type PiModel = NonNullable<PiSessionOptions["model"]>;

export interface AgentSessionTarget {
  readonly resumeSessionPath?: string;
  readonly parentSessionPath?: string;
}

export type AgentRunEventListener = (event: AgentRunEvent) => void;

export interface AgentSession {
  readonly sessionId: string;
  readonly sessionPath: string | null;
  readonly toolNames: readonly string[];
  subscribe(listener: AgentRunEventListener): () => void;
  prompt(text: string): Promise<void>;
  compact(instructions?: string): Promise<void>;
  abort(): Promise<void>;
  replace(target?: AgentSessionTarget): Promise<void>;
  dispose(): void;
}

export interface AgentRuntime {
  createSession(target?: AgentSessionTarget): Promise<AgentSession>;
  createManagerSession(
    tools: readonly ToolDefinition[],
    target?: AgentSessionTarget,
  ): Promise<AgentSession>;
  createWorkerSession(target?: AgentSessionTarget): Promise<AgentSession>;
  createAssignmentSession(
    tools: readonly ToolDefinition[],
    target?: AgentSessionTarget,
  ): Promise<AgentSession>;
  createScanSession(
    recordingTools: readonly ToolDefinition[],
    target?: AgentSessionTarget,
  ): Promise<AgentSession>;
  getProviderStatus(providerId: string): Promise<ProviderStatus>;
}

export interface ProviderLoginCallbacks {
  openExternal(url: string): Promise<void>;
  notify?(event: AuthEvent): void;
}

export type OpenAiCodexLoginMethod = "browser" | "device_code";

export interface PiAgentRuntimeOptions {
  readonly cwd: string;
  readonly agentDir: string;
  readonly sessionDirectory?: string;
  readonly modelRuntime?: ModelRuntime;
  readonly model?: PiModel;
  readonly browserController?: BrowserController;
}

const studiProbe = defineTool({
  name: "studi_probe",
  label: "Studi probe",
  description: "Reports that the Studi agent runtime and its custom tool channel are ready.",
  parameters: Type.Object({}, { additionalProperties: false }),
  execute: async () => ({
    content: [{ type: "text" as const, text: "Studi probe ready." }],
    details: { ready: true },
  }),
});

export class PiAgentRuntime implements AgentRuntime {
  static readonly sdkVersion = VERSION;

  readonly #cwd: string;
  readonly #agentDir: string;
  readonly #sessionDirectory: string;
  readonly #modelRuntime: ModelRuntime;
  readonly #workerTools: ToolDefinition[];
  readonly #browserTools: ToolDefinition[] | null;
  readonly #assignmentBrowserTools: ToolDefinition[] | null;
  #model?: PiModel;
  #thinkingLevel: AgentReasoningEffort = DEFAULT_AGENT_REASONING_EFFORT;

  private constructor(options: PiAgentRuntimeOptions, modelRuntime: ModelRuntime) {
    this.#cwd = options.cwd;
    this.#agentDir = options.agentDir;
    this.#sessionDirectory = options.sessionDirectory ?? join(options.agentDir, "sessions");
    this.#modelRuntime = modelRuntime;
    this.#browserTools = options.browserController
      ? createBrowserTools(options.browserController)
      : null;
    this.#assignmentBrowserTools = options.browserController
      ? createBrowserTools(options.browserController, { includeSubmit: false })
      : null;
    this.#workerTools = this.#browserTools ?? [studiProbe];
    const initialModel = options.model ?? selectDefaultModel(modelRuntime);
    if (initialModel) {
      this.#model = initialModel;
    }
  }

  static async create(options: PiAgentRuntimeOptions): Promise<PiAgentRuntime> {
    await mkdir(options.agentDir, { recursive: true });
    const modelRuntime =
      options.modelRuntime ??
      (await ModelRuntime.create({
        authPath: join(options.agentDir, "auth.json"),
        modelsPath: join(options.agentDir, "models.json"),
        allowModelNetwork: false,
        refreshOnCreate: false,
        signal: AbortSignal.timeout(5_000),
      }));
    return new PiAgentRuntime(options, modelRuntime);
  }

  async createSession(target: AgentSessionTarget = {}): Promise<AgentSession> {
    return this.createWorkerSession(target);
  }

  async createWorkerSession(target: AgentSessionTarget = {}): Promise<AgentSession> {
    const createPiSession = (nextTarget: AgentSessionTarget) =>
      this.#createPiSession(nextTarget, this.#workerTools, workerSystemPrompt);
    return new PiBackedAgentSession(await createPiSession(target), createPiSession);
  }

  async createAssignmentSession(
    recordingTools: readonly ToolDefinition[],
    target: AgentSessionTarget = {},
  ): Promise<AgentSession> {
    if (!this.#assignmentBrowserTools) {
      throw new Error("The Studi assignment session requires the visible school browser");
    }
    const tools = [...this.#assignmentBrowserTools, ...recordingTools];
    if (new Set(tools.map((tool) => tool.name)).size !== tools.length) {
      throw new Error("The Studi assignment session received a duplicate tool name");
    }
    const createPiSession = (nextTarget: AgentSessionTarget) =>
      this.#createPiSession(nextTarget, tools, assignmentSystemPrompt);
    return new PiBackedAgentSession(await createPiSession(target), createPiSession);
  }

  async createScanSession(
    recordingTools: readonly ToolDefinition[],
    target: AgentSessionTarget = {},
  ): Promise<AgentSession> {
    if (!this.#browserTools) {
      throw new Error("The Studi scan session requires the visible school browser");
    }
    const tools = [...this.#browserTools, ...recordingTools];
    if (new Set(tools.map((tool) => tool.name)).size !== tools.length) {
      throw new Error("The Studi scan session received a duplicate tool name");
    }
    const createPiSession = (nextTarget: AgentSessionTarget) =>
      this.#createPiSession(nextTarget, tools, scanSystemPrompt);
    return new PiBackedAgentSession(await createPiSession(target), createPiSession);
  }

  async createManagerSession(
    tools: readonly ToolDefinition[],
    target: AgentSessionTarget = {},
  ): Promise<AgentSession> {
    if (tools.length === 0) {
      throw new Error("The Studi manager session requires at least one queue tool");
    }
    const managerTools = [...tools];
    const createPiSession = (nextTarget: AgentSessionTarget) =>
      this.#createPiSession(nextTarget, managerTools, managerSystemPrompt);
    return new PiBackedAgentSession(await createPiSession(target), createPiSession);
  }

  async getProviderStatus(providerId: string): Promise<ProviderStatus> {
    const provider = this.#modelRuntime.getProvider(providerId);
    if (!provider) {
      return ProviderStatusSchema.parse({
        schemaVersion: STUDI_SCHEMA_VERSION,
        providerId: "unknown",
        providerName: "Unknown provider",
        state: "unavailable",
        loginMethods: [],
        reason: "This provider is not registered in the Pi runtime.",
      });
    }

    const loginMethods: ProviderLoginMethod[] = [];
    if (provider.auth.apiKey?.login) {
      loginMethods.push("api_key");
    }
    if (provider.auth.oauth) {
      loginMethods.push("oauth");
    }

    try {
      const auth = await this.#modelRuntime.checkAuth(provider.id, {
        signal: AbortSignal.timeout(5_000),
      });
      if (auth) {
        return ProviderStatusSchema.parse({
          schemaVersion: STUDI_SCHEMA_VERSION,
          providerId: provider.id,
          providerName: provider.name,
          state: "ready",
          loginMethods,
          reason: `${provider.name} is ready to use.`,
        });
      }

      const canLogin = loginMethods.length > 0;
      return ProviderStatusSchema.parse({
        schemaVersion: STUDI_SCHEMA_VERSION,
        providerId: provider.id,
        providerName: provider.name,
        state: canLogin ? "needs_login" : "unavailable",
        loginMethods,
        reason: canLogin
          ? `${provider.name} needs authentication.`
          : `${provider.name} has no usable authentication configured.`,
      });
    } catch {
      return ProviderStatusSchema.parse({
        schemaVersion: STUDI_SCHEMA_VERSION,
        providerId: provider.id,
        providerName: provider.name,
        state: "unavailable",
        loginMethods,
        reason: `Studi could not check ${provider.name} authentication.`,
      });
    }
  }

  getProviderModels(providerId: string): readonly AgentModel[] {
    return this.#modelRuntime.getModels(providerId).map((model) => ({
      id: model.id,
      name: model.name,
    }));
  }

  get selectedModelId(): string {
    if (!this.#model) {
      throw new Error("Pi has no model available for a Studi session");
    }
    return this.#model.id;
  }

  get selectedReasoningEffort(): AgentReasoningEffort {
    return this.#thinkingLevel;
  }

  selectModel(providerId: string, modelId: string): void {
    const model = this.#modelRuntime.getModel(providerId, modelId);
    if (!model) {
      throw new Error(`Unknown ${providerId} model: ${modelId}`);
    }
    this.#model = model;
  }

  setReasoningEffort(effort: AgentReasoningEffort): void {
    this.#thinkingLevel = effort;
  }

  async loginOpenAiCodex(
    method: OpenAiCodexLoginMethod,
    signal: AbortSignal,
    callbacks: ProviderLoginCallbacks,
  ): Promise<void> {
    await this.#modelRuntime.login("openai-codex", "oauth", {
      signal,
      prompt: (prompt) => answerCodexPrompt(prompt, method),
      notify: (event) => {
        if (event.type === "auth_url" || event.type === "device_code") {
          const url = new URL(
            event.type === "auth_url" ? event.url : event.verificationUri,
          );
          if (url.protocol !== "https:") {
            throw new Error("OpenAI returned an unsafe authorization URL");
          }
          void callbacks.openExternal(url.href).catch(() => undefined);
        }
        callbacks.notify?.(event);
      },
    });
  }

  async #createPiSession(
    target: AgentSessionTarget,
    tools: readonly ToolDefinition[],
    systemPrompt: string,
  ): Promise<PiAgentSession> {
    const settingsManager = SettingsManager.inMemory();
    const resourceLoader = new DefaultResourceLoader({
      cwd: this.#cwd,
      agentDir: this.#agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt,
    });
    await resourceLoader.reload();

    const sessionManager = target.resumeSessionPath
      ? SessionManager.open(target.resumeSessionPath, this.#sessionDirectory, this.#cwd)
      : SessionManager.create(
          this.#cwd,
          this.#sessionDirectory,
          target.parentSessionPath ? { parentSession: target.parentSessionPath } : undefined,
        );
    const options: PiSessionOptions = {
      cwd: this.#cwd,
      agentDir: this.#agentDir,
      modelRuntime: this.#modelRuntime,
      sessionManager,
      settingsManager,
      resourceLoader,
      noTools: "all",
      tools: tools.map((tool) => tool.name),
      customTools: [...tools],
      thinkingLevel: this.#thinkingLevel,
    };
    if (!this.#model) {
      throw new Error("Pi has no model available for a Studi session");
    }
    options.model = this.#model;

    const { session } = await createAgentSession(options);
    const activeTools = session.getActiveToolNames();
    const configuredTools = session.getAllTools().map((tool) => tool.name);
    const expectedTools = tools.map((tool) => tool.name);
    if (!sameNames(activeTools, expectedTools) || !sameNames(configuredTools, expectedTools)) {
      session.dispose();
      throw new Error("Pi session did not preserve the Studi-only tool boundary");
    }
    return session;
  }
}

const workerSystemPrompt =
  "You are Studi's local assignment worker. Use only the tools supplied by Studi. The visible browser is the source of truth. Take a snapshot before acting and after any stale-ref error. Never claim a course, assignment, sign-in, or action succeeded without browser evidence. Never submit work unless the student explicitly asks in the current conversation; ordinary browser_click cannot submit.";

const assignmentSystemPrompt =
  "You are Studi's local assignment worker. Use only the supplied browser and assignment tools. The visible page and durable assignment tools are the sources of truth. Ordinary browser_click cannot submit. Finish by recording review-ready work, requesting a truthful handoff, marking unsupported work, or using the gated browser_submit tool. Record at most two meaningfully different recovery plans. Never claim completion or submission without fresh browser evidence.";

const managerSystemPrompt =
  "You are Studi's local work manager. Use only the queue tools supplied by Studi. Durable queue state is the source of truth. Inspect it before steering or starting work. Never claim a task moved, started, or stopped unless a Studi tool confirms it. You cannot supply pattern permission provenance or control the school browser directly; the start tool delegates only a verified queued task to Studi's existing assignment execution owner.";

const scanSystemPrompt =
  "You are Studi's school onboarding scanner. Use only the supplied general browser and scan-recording tools. The visible browser is the source of truth. Record a course, assignment, linked system, coverage result, or sign-in handoff only after observing the current page. Never ask for a password in chat. Request a sign-in handoff only when the current page requires a student login Studi cannot complete, then stop. Do not request a handoff while the same school site already shows the student signed in. Do not mark linked systems incomplete merely because none appeared. Re-observe all items on replay. Finish only after recording explicit coverage; old stored rows are hints, never current evidence.";

async function answerCodexPrompt(
  prompt: AuthPrompt,
  method: OpenAiCodexLoginMethod,
): Promise<string> {
  if (prompt.type === "select") {
    const selectedOption = prompt.options.find((option) => option.id === method);
    if (!selectedOption) {
      throw new Error(`OpenAI Codex ${method} login is unavailable`);
    }
    return selectedOption.id;
  }
  if (prompt.type !== "manual_code") {
    throw new Error("OpenAI Codex requested unsupported interactive input");
  }
  return new Promise<string>((_resolve, reject) => {
    const signal = prompt.signal;
    if (signal?.aborted) {
      reject(new Error("Login callback completed"));
      return;
    }
    signal?.addEventListener(
      "abort",
      () => reject(new Error("Login callback completed")),
      { once: true },
    );
  });
}

function sameNames(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((name, index) => name === expected[index]);
}

function selectDefaultModel(modelRuntime: ModelRuntime): PiModel | undefined {
  if (typeof modelRuntime.getModel !== "function" || typeof modelRuntime.getModels !== "function") {
    return undefined;
  }
  return (
    modelRuntime.getModel("openai-codex", DEFAULT_AGENT_MODEL_ID) ??
    modelRuntime.getModel("openai-codex", "gpt-5.6-terra") ??
    modelRuntime.getModels("openai-codex")[0] ??
    modelRuntime.getModels()[0]
  );
}

class PiBackedAgentSession implements AgentSession {
  readonly #listeners = new Set<AgentRunEventListener>();
  readonly #createPiSession: (target: AgentSessionTarget) => Promise<PiAgentSession>;
  readonly #normalizer = new PiEventNormalizer();
  #piSession: PiAgentSession;
  #unsubscribePi: (() => void) | null = null;
  #disposed = false;

  constructor(
    piSession: PiAgentSession,
    createPiSession: (target: AgentSessionTarget) => Promise<PiAgentSession>,
  ) {
    this.#piSession = piSession;
    this.#createPiSession = createPiSession;
    this.#bindPiSubscription();
  }

  get sessionId(): string {
    return this.#piSession.sessionId;
  }

  get sessionPath(): string | null {
    return this.#piSession.sessionFile ?? null;
  }

  get toolNames(): readonly string[] {
    return this.#piSession.getActiveToolNames();
  }

  subscribe(listener: AgentRunEventListener): () => void {
    this.#assertUsable();
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async prompt(text: string): Promise<void> {
    this.#assertUsable();
    if (this.#piSession.isStreaming) {
      throw new Error("The agent session is already processing a prompt");
    }
    this.#normalizer.beginRun();
    try {
      await this.#piSession.prompt(text, { expandPromptTemplates: false, source: "rpc" });
    } catch (error) {
      if (!this.#normalizer.hasTerminalEvent) {
        this.#emit({
          schemaVersion: STUDI_SCHEMA_VERSION,
          type: "terminal",
          outcome: "failed",
          reason: "The agent prompt could not start.",
        });
      }
      throw error;
    }
  }

  async compact(instructions?: string): Promise<void> {
    this.#assertUsable();
    await this.#piSession.compact(instructions);
  }

  async abort(): Promise<void> {
    this.#assertUsable();
    await this.#piSession.abort();
  }

  async replace(target: AgentSessionTarget = {}): Promise<void> {
    this.#assertUsable();
    if (this.#piSession.isStreaming) {
      await this.#piSession.abort();
    }
    const nextSession = await this.#createPiSession(target);
    const previousSession = this.#piSession;
    this.#unsubscribePi?.();
    this.#piSession = nextSession;
    this.#normalizer.reset();
    this.#bindPiSubscription();
    previousSession.dispose();
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#unsubscribePi?.();
    this.#unsubscribePi = null;
    this.#listeners.clear();
    this.#piSession.dispose();
  }

  #bindPiSubscription(): void {
    this.#unsubscribePi = this.#piSession.subscribe((event) => {
      for (const normalized of this.#normalizer.accept(event)) {
        this.#emit(normalized);
      }
    });
  }

  #emit(event: AgentRunEvent): void {
    for (const listener of this.#listeners) {
      listener(event);
    }
  }

  #assertUsable(): void {
    if (this.#disposed) {
      throw new Error("Agent session is disposed");
    }
  }
}

export class PiEventNormalizer {
  #lastStopReason: "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred" | null =
    null;
  #hasTerminalEvent = false;
  #hasAbortEvent = false;

  get hasTerminalEvent(): boolean {
    return this.#hasTerminalEvent;
  }

  beginRun(): void {
    this.#lastStopReason = null;
    this.#hasTerminalEvent = false;
    this.#hasAbortEvent = false;
  }

  reset(): void {
    this.beginRun();
  }

  accept(event: AgentSessionEvent): AgentRunEvent[] {
    switch (event.type) {
      case "agent_start":
        this.beginRun();
        return [];
      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          return [
            this.#parse({
              schemaVersion: STUDI_SCHEMA_VERSION,
              type: "text",
              delta: event.assistantMessageEvent.delta,
            }),
          ];
        }
        return [];
      case "message_end": {
        const stopReason = readAssistantStopReason(event.message);
        if (stopReason) {
          this.#lastStopReason = stopReason;
        }
        if (stopReason === "aborted" && !this.#hasAbortEvent) {
          this.#hasAbortEvent = true;
          return [
            this.#parse({
              schemaVersion: STUDI_SCHEMA_VERSION,
              type: "aborted",
            }),
          ];
        }
        return [];
      }
      case "tool_execution_start":
        return [
          this.#parse({
            schemaVersion: STUDI_SCHEMA_VERSION,
            type: "tool_started",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
          }),
        ];
      case "tool_execution_end":
        return [
          this.#parse({
            schemaVersion: STUDI_SCHEMA_VERSION,
            type: "tool_finished",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            outcome: event.isError ? "failed" : "succeeded",
          }),
        ];
      case "auto_retry_start":
        return [
          this.#parse({
            schemaVersion: STUDI_SCHEMA_VERSION,
            type: "retry",
            phase: "started",
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            delayMs: event.delayMs,
            reason: "The provider asked Pi to retry.",
          }),
        ];
      case "auto_retry_end":
        return [
          this.#parse({
            schemaVersion: STUDI_SCHEMA_VERSION,
            type: "retry",
            phase: "finished",
            attempt: event.attempt,
            outcome: event.success ? "succeeded" : "failed",
            ...(event.success ? {} : { reason: "Pi exhausted the provider retry limit." }),
          }),
        ];
      case "compaction_start":
        return [
          this.#parse({
            schemaVersion: STUDI_SCHEMA_VERSION,
            type: "compaction",
            phase: "started",
            reason: event.reason,
          }),
        ];
      case "compaction_end":
        return [
          this.#parse({
            schemaVersion: STUDI_SCHEMA_VERSION,
            type: "compaction",
            phase: "finished",
            reason: event.reason,
            outcome: event.aborted ? "aborted" : event.errorMessage ? "failed" : "completed",
          }),
        ];
      case "agent_settled": {
        const outcome =
          this.#lastStopReason === "aborted"
            ? "aborted"
            : this.#lastStopReason === "error"
              ? "failed"
              : "completed";
        this.#hasTerminalEvent = true;
        return [
          this.#parse({
            schemaVersion: STUDI_SCHEMA_VERSION,
            type: "terminal",
            outcome,
            ...(outcome === "failed" ? { reason: "The provider returned an error." } : {}),
          }),
        ];
      }
      default:
        return [];
    }
  }

  #parse(event: AgentRunEvent): AgentRunEvent {
    return AgentRunEventSchema.parse(event);
  }
}

type NormalizedStopReason =
  | "stop"
  | "length"
  | "toolUse"
  | "error"
  | "aborted"
  | "deferred";

function readAssistantStopReason(message: unknown): NormalizedStopReason | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const record = message as Record<string, unknown>;
  if (record.role !== "assistant") {
    return null;
  }
  switch (record.stopReason) {
    case "stop":
    case "length":
    case "toolUse":
    case "error":
    case "aborted":
    case "deferred":
      return record.stopReason;
    default:
      return null;
  }
}

const DEFAULT_FAKE_TURN: readonly AgentRunEvent[] = Object.freeze([
  {
    schemaVersion: STUDI_SCHEMA_VERSION,
    type: "tool_started",
    toolCallId: "studi-probe-call",
    toolName: "studi_probe",
  },
  {
    schemaVersion: STUDI_SCHEMA_VERSION,
    type: "tool_finished",
    toolCallId: "studi-probe-call",
    toolName: "studi_probe",
    outcome: "succeeded",
  },
  { schemaVersion: STUDI_SCHEMA_VERSION, type: "text", delta: "Prob" },
  { schemaVersion: STUDI_SCHEMA_VERSION, type: "text", delta: "e co" },
  { schemaVersion: STUDI_SCHEMA_VERSION, type: "text", delta: "mple" },
  { schemaVersion: STUDI_SCHEMA_VERSION, type: "text", delta: "te." },
  { schemaVersion: STUDI_SCHEMA_VERSION, type: "terminal", outcome: "completed" },
] satisfies readonly AgentRunEvent[]);

export class FakeAgentRuntime implements AgentRuntime {
  readonly #turns: readonly (readonly AgentRunEvent[])[];
  #sessionNumber = 0;

  constructor(turns: readonly (readonly AgentRunEvent[])[] = [DEFAULT_FAKE_TURN]) {
    this.#turns = turns.map((turn) => turn.map((event) => AgentRunEventSchema.parse(event)));
  }

  async createSession(target: AgentSessionTarget = {}): Promise<AgentSession> {
    return this.createWorkerSession(target);
  }

  async createWorkerSession(target: AgentSessionTarget = {}): Promise<AgentSession> {
    this.#sessionNumber += 1;
    return new FakeAgentSession(
      `fake-session-${this.#sessionNumber}`,
      target.resumeSessionPath ?? `fake-session-${this.#sessionNumber}.jsonl`,
      this.#turns,
    );
  }

  async createAssignmentSession(
    tools: readonly ToolDefinition[],
    target: AgentSessionTarget = {},
  ): Promise<AgentSession> {
    this.#sessionNumber += 1;
    return new FakeAgentSession(
      `fake-assignment-session-${this.#sessionNumber}`,
      target.resumeSessionPath ?? `fake-assignment-session-${this.#sessionNumber}.jsonl`,
      this.#turns,
      tools.map((tool) => tool.name),
    );
  }

  async createManagerSession(
    tools: readonly ToolDefinition[],
    target: AgentSessionTarget = {},
  ): Promise<AgentSession> {
    this.#sessionNumber += 1;
    return new FakeAgentSession(
      `fake-manager-session-${this.#sessionNumber}`,
      target.resumeSessionPath ?? `fake-manager-session-${this.#sessionNumber}.jsonl`,
      this.#turns,
      tools.map((tool) => tool.name),
    );
  }

  async createScanSession(
    recordingTools: readonly ToolDefinition[],
    target: AgentSessionTarget = {},
  ): Promise<AgentSession> {
    this.#sessionNumber += 1;
    return new FakeAgentSession(
      `fake-scan-session-${this.#sessionNumber}`,
      target.resumeSessionPath ?? `fake-scan-session-${this.#sessionNumber}.jsonl`,
      this.#turns,
      recordingTools.map((tool) => tool.name),
    );
  }

  async getProviderStatus(providerId: string): Promise<ProviderStatus> {
    if (providerId === "fake") {
      return ProviderStatusSchema.parse({
        schemaVersion: STUDI_SCHEMA_VERSION,
        providerId: "fake",
        providerName: "Deterministic fake",
        state: "ready",
        loginMethods: [],
        reason: "The deterministic fake is ready to use.",
      });
    }
    return ProviderStatusSchema.parse({
      schemaVersion: STUDI_SCHEMA_VERSION,
      providerId: "unknown",
      providerName: "Unknown provider",
      state: "unavailable",
      loginMethods: [],
      reason: "This provider is not registered in the fake runtime.",
    });
  }
}

class FakeAgentSession implements AgentSession {
  readonly #listeners = new Set<AgentRunEventListener>();
  readonly #turns: readonly (readonly AgentRunEvent[])[];
  #turnIndex = 0;
  #sessionId: string;
  #sessionPath: string;
  #replacementNumber = 0;
  #disposed = false;
  readonly #toolNames: readonly string[];

  constructor(
    sessionId: string,
    sessionPath: string,
    turns: readonly (readonly AgentRunEvent[])[],
    toolNames: readonly string[] = ["studi_probe"],
  ) {
    this.#sessionId = sessionId;
    this.#sessionPath = sessionPath;
    this.#turns = turns;
    this.#toolNames = toolNames;
  }

  get sessionId(): string {
    return this.#sessionId;
  }

  get sessionPath(): string {
    return this.#sessionPath;
  }

  get toolNames(): readonly string[] {
    return this.#toolNames;
  }

  subscribe(listener: AgentRunEventListener): () => void {
    this.#assertUsable();
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async prompt(_text: string): Promise<void> {
    this.#assertUsable();
    const turn = this.#turns[this.#turnIndex] ?? this.#turns.at(-1) ?? [];
    this.#turnIndex += 1;
    for (const event of turn) {
      this.#emit(event);
    }
  }

  async compact(_instructions?: string): Promise<void> {
    this.#assertUsable();
    this.#emit({
      schemaVersion: STUDI_SCHEMA_VERSION,
      type: "compaction",
      phase: "started",
      reason: "manual",
    });
    this.#emit({
      schemaVersion: STUDI_SCHEMA_VERSION,
      type: "compaction",
      phase: "finished",
      reason: "manual",
      outcome: "completed",
    });
  }

  async abort(): Promise<void> {
    this.#assertUsable();
    this.#emit({ schemaVersion: STUDI_SCHEMA_VERSION, type: "aborted" });
    this.#emit({ schemaVersion: STUDI_SCHEMA_VERSION, type: "terminal", outcome: "aborted" });
  }

  async replace(target: AgentSessionTarget = {}): Promise<void> {
    this.#assertUsable();
    this.#replacementNumber += 1;
    this.#sessionId = `fake-replacement-${this.#replacementNumber}`;
    this.#sessionPath =
      target.resumeSessionPath ?? `fake-replacement-${this.#replacementNumber}.jsonl`;
  }

  dispose(): void {
    this.#disposed = true;
    this.#listeners.clear();
  }

  #emit(event: AgentRunEvent): void {
    for (const listener of this.#listeners) {
      listener(event);
    }
  }

  #assertUsable(): void {
    if (this.#disposed) {
      throw new Error("Agent session is disposed");
    }
  }
}
