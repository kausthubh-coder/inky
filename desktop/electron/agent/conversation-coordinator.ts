import { randomUUID } from "node:crypto";

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { buildAgentTurn, buildAgentTurnForTools } from "../../agent-system/turn-builder.js";
import { noteIsAllowed, retrieveNoteIndex, type NoteRetrievalContext } from "../../agent-system/retrieve.js";
import { AgentTrace } from "../../agent-system/trace.js";
import {
  AddressedSendResultSchema,
  AgentJobSchema,
  AgentMessageSchema,
  ConversationTargetSchema,
  SelectedConversationSchema,
  type AddressedSendResult,
  type AgentJob,
  type AgentRunEvent,
  type ConversationTarget,
  type SelectedConversation,
} from "../../shared/index.js";
import type { ManagerCoordinator } from "../manager/coordinator.js";
import type { LocalStore } from "../storage/index.js";
import { addUsage, emptyUsage, type AgentUsageSnapshot } from "../telemetry/usage.js";
import type { AgentSession, AgentSessionTarget } from "./runtime.js";

export interface ConversationRuntime {
  readonly selectedModelId?: string;
  readonly selectedReasoningEffort?: string;
  takeLastUsage?(): AgentUsageSnapshot;
  createJobSession(
    target: ConversationTarget,
    tools: readonly ToolDefinition[],
    sessionTarget?: AgentSessionTarget,
  ): Promise<AgentSession>;
}

export interface ConversationCoordinatorOptions {
  readonly now?: () => string;
  readonly trace?: AgentTrace;
}

export type AssignmentWorkRunner = (
  taskId: string,
  prompt: string,
  observe: (event: AgentRunEvent) => void,
) => Promise<{ readonly outcome: "completed" | "failed" | "aborted"; readonly text: string }>;

export class ConversationCoordinator {
  readonly trace: AgentTrace;
  readonly #store: LocalStore;
  readonly #runtime: ConversationRuntime;
  readonly #manager: ManagerCoordinator;
  readonly #now: () => string;
  readonly #sessions = new Map<string, AgentSession>();
  readonly #running = new Set<string>();
  #cumulativeUsage = emptyUsage();
  #assignmentWorkRunner: AssignmentWorkRunner | null = null;
  #disposed = false;

  constructor(
    store: LocalStore,
    runtime: ConversationRuntime,
    manager: ManagerCoordinator,
    options: ConversationCoordinatorOptions = {},
  ) {
    this.#store = store;
    this.#runtime = runtime;
    this.#manager = manager;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.trace = options.trace ?? new AgentTrace({ now: this.#now });
    this.#manager.setBeforeAssignmentWork(async (assignmentId) => {
      const persisted = this.#store.agentJobs.getByTarget({ kind: "assignment", assignmentId });
      if (!persisted) return;
      this.#sessions.get(persisted.job.jobId)?.dispose();
      this.#sessions.delete(persisted.job.jobId);
    });
  }

  selectAssignment(assignmentId: string | null): SelectedConversation {
    this.#assertUsable();
    const target: ConversationTarget = assignmentId
      ? { kind: "assignment", assignmentId }
      : { kind: "home" };
    return SelectedConversationSchema.parse({ target, job: this.#requiredJob(target) });
  }

  setAssignmentWorkRunner(runner: AssignmentWorkRunner | null): void {
    this.#assignmentWorkRunner = runner;
  }

  async send(rawTarget: unknown, rawText: string): Promise<AddressedSendResult> {
    this.#assertUsable();
    const target = ConversationTargetSchema.parse(rawTarget);
    const text = rawText.trim();
    if (!text) throw new TypeError("Inky needs a message");
    if (text.length > 100_000) throw new TypeError("The message is too long");
    let job = this.#requiredJob(target);
    if (this.#running.has(job.jobId)) throw new Error("Inky is already answering in this conversation");
    this.#running.add(job.jobId);

    const turnIndex = job.turnIndex + 1;
    const runId = randomUUID();
    const userMessage = AgentMessageSchema.parse({
      messageId: randomUUID(),
      role: "user",
      text,
      createdAt: this.#now(),
      turnIndex,
    });
    const hasBrowserClaim = target.kind === "assignment" && Boolean(job.claim);
    job = this.#save({
      ...job,
      phase: hasBrowserClaim ? job.phase : "conversing",
      turnIndex,
      runId,
      messages: [...job.messages, userMessage],
      updatedAt: this.#now(),
    });
    await this.#emit(job, "message_received", { target, text });

    try {
      const activeTaskId = target.kind === "assignment" && job.claim
        ? this.#manager.activeTaskForAssignment(target.assignmentId)
        : null;
      if (job.claim && !activeTaskId) {
        throw new Error("This assignment's browser claim is stale; reopen Studi so it can recover safely");
      }
      const tools = activeTaskId ? [] : this.#tools(target);
      const actualToolNames = activeTaskId
        ? [...this.#manager.workerToolNames()]
        : tools.map((tool) => tool.name);
      const brief = {
        sections: [
          { title: "Current Studi facts", content: JSON.stringify(this.#brief(target)) },
          { title: "Relevant notes", content: JSON.stringify(await this.#automaticNotes(target)) },
        ],
      };
      const turn = activeTaskId
        ? await buildAgentTurnForTools(target, actualToolNames, text, brief)
        : await buildAgentTurn({ target, phase: job.phase, hasBrowserClaim: false }, text, brief);
      if (!activeTaskId && JSON.stringify(turn.toolNames) !== JSON.stringify(actualToolNames)) {
        throw new Error("The conversation tools do not match the selected capability packs");
      }
      await this.#emit(job, "turn_built", {
        prompt: turn.prompt,
        promptHash: turn.promptHash,
        systemHash: turn.system.hash,
        packs: turn.system.packs.map((pack) => ({ id: pack.id, hash: pack.hash })),
        toolNames: actualToolNames,
      });
      let reply = "";
      let observedOutcome: string = "failed";
      const runtimeEvents: AgentRunEvent[] = [];
      const session = activeTaskId ? null : await this.#session(job, tools);
      const sessionId = session?.sessionId ?? job.sessionId;
      if (!sessionId) throw new Error("The assignment job has no persisted worker session");
      this.#runtime.takeLastUsage?.();
      await this.#emit(job, "model_started", {
        sessionId,
        model: this.#runtime.selectedModelId ?? null,
        reasoning: this.#runtime.selectedReasoningEffort ?? null,
      });
      const startedAt = Date.now();
      let firstTokenAt: number | null = null;
      let toolDurationMs = 0;
      let errorCount = 0;
      const observeRuntimeEvent = (event: AgentRunEvent) => {
        const observedAt = Date.now();
        if (event.type === "text" && firstTokenAt === null) firstTokenAt = observedAt;
        if (event.type === "tool_finished") {
          toolDurationMs += event.durationMs ?? 0;
          if (event.outcome === "failed") errorCount += 1;
        }
        runtimeEvents.push(event);
      };
      if (activeTaskId) {
        if (!this.#assignmentWorkRunner) throw new Error("Assignment work is not ready");
        const result = await this.#assignmentWorkRunner(activeTaskId, turn.prompt, observeRuntimeEvent);
        reply = result.text;
        observedOutcome = result.outcome;
      } else {
        const unsubscribe = session!.subscribe((event) => {
          if (event.type === "text") reply += event.delta;
          if (event.type === "terminal") observedOutcome = event.outcome;
          observeRuntimeEvent(event);
        });
        try {
          await session!.prompt(turn.prompt);
        } finally {
          unsubscribe();
        }
      }
      for (const event of runtimeEvents) await this.#recordRuntimeEvent(job, event);
      const outcome = AddressedSendResultSchema.shape.outcome.parse(observedOutcome);
      const usage = this.#runtime.takeLastUsage?.() ?? null;
      if (usage) this.#cumulativeUsage = addUsage(this.#cumulativeUsage, usage);
      const totalDurationMs = Math.max(0, Date.now() - startedAt);
      await this.#emit(job, "model_finished", {
        sessionId,
        outcome,
        durationMs: totalDurationMs,
        totalDurationMs,
        firstTokenMs: firstTokenAt === null ? null : Math.max(0, firstTokenAt - startedAt),
        toolDurationMs,
        modelDurationMs: Math.max(0, totalDurationMs - toolDurationMs),
        errorCount,
        model: this.#runtime.selectedModelId ?? null,
        reasoning: this.#runtime.selectedReasoningEffort ?? null,
        usage: usage ? withTotalTokens(usage) : null,
        cumulativeUsage: withTotalTokens(this.#cumulativeUsage),
      });
      const assistantMessage = reply
        ? AgentMessageSchema.parse({
            messageId: randomUUID(),
            role: "assistant",
            text: reply,
            createdAt: this.#now(),
            turnIndex,
          })
        : null;
      const latest = this.#store.agentJobs.get(job.jobId)?.job ?? job;
      job = this.#save({
        ...latest,
        sessionId,
        phase: activeTaskId
          ? latest.phase
          : outcome === "completed" ? "conversing" : outcome === "aborted" ? "aborted" : "failed",
        messages: assistantMessage ? [...latest.messages, assistantMessage] : latest.messages,
        updatedAt: this.#now(),
      }, session?.sessionPath);
      if (assistantMessage) await this.#emit(job, "reply_recorded", { text: reply });
      await this.#emit(job, "phase_changed", { phase: job.phase });
      return AddressedSendResultSchema.parse({ outcome, text: reply, job });
    } catch (error) {
      const latest = this.#store.agentJobs.get(job.jobId)?.job ?? job;
      job = latest.claim ? latest : this.#save({ ...latest, phase: "failed", updatedAt: this.#now() });
      await this.#emit(job, "error", { message: error instanceof Error ? error.message : "The conversation failed" });
      throw error;
    } finally {
      this.#running.delete(job.jobId);
    }
  }

  async replaceSessions(): Promise<void> {
    this.#assertUsable();
    for (const [jobId, session] of this.#sessions) {
      await session.replace();
      const persisted = this.#store.agentJobs.get(jobId);
      if (!persisted) continue;
      this.#save(
        { ...persisted.job, sessionId: session.sessionId, updatedAt: this.#now() },
        session.sessionPath,
      );
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#manager.setBeforeAssignmentWork(null);
    for (const session of this.#sessions.values()) session.dispose();
    this.#sessions.clear();
    this.#running.clear();
  }

  #requiredJob(target: ConversationTarget): AgentJob {
    if (target.kind === "assignment" && !this.#store.assignments.get(target.assignmentId)) {
      throw new Error(`Assignment ${target.assignmentId} does not exist`);
    }
    const existing = this.#store.agentJobs.getByTarget(target);
    if (existing) return existing.job;
    const now = this.#now();
    const legacyHome = target.kind === "home" ? this.#store.manager.getManagerSession() : null;
    const job = AgentJobSchema.parse({
      schemaVersion: 1,
      jobId: randomUUID(),
      target,
      phase: "idle",
      turnIndex: 0,
      runId: randomUUID(),
      sessionId: legacyHome?.sessionId ?? null,
      claim: null,
      messages: [],
      createdAt: now,
      updatedAt: now,
    });
    this.#store.agentJobs.put(job, legacyHome?.sessionPath ?? null);
    void this.#emit(job, "job_created", { target, migratedLegacySession: Boolean(legacyHome) });
    return job;
  }

  async #session(job: AgentJob, tools: readonly ToolDefinition[]): Promise<AgentSession> {
    const active = this.#sessions.get(job.jobId);
    if (active) return active;
    const persisted = this.#store.agentJobs.get(job.jobId);
    const session = await this.#runtime.createJobSession(
      ConversationTargetSchema.parse(job.target),
      tools,
      persisted?.sessionPath ? { resumeSessionPath: persisted.sessionPath } : {},
    );
    if (!session.sessionPath) {
      session.dispose();
      throw new Error("Pi did not persist the Inky job session");
    }
    this.#sessions.set(job.jobId, session);
    this.#save({ ...job, sessionId: session.sessionId, updatedAt: this.#now() }, session.sessionPath);
    return session;
  }

  #save(job: AgentJob, sessionPath?: string | null): AgentJob {
    const previousPath = this.#store.agentJobs.get(job.jobId)?.sessionPath ?? null;
    return this.#store.agentJobs.put(
      AgentJobSchema.parse(job),
      sessionPath === undefined ? previousPath : sessionPath,
    ).job;
  }

  #brief(target: ConversationTarget): unknown {
    if (target.kind === "home") return { queue: this.#manager.state() };
    const assignment = this.#store.assignments.get(target.assignmentId);
    return {
      assignment,
      tasks: this.#store.tasks.listAll().filter((task) => task.assignmentId === target.assignmentId),
    };
  }

  #tools(target: ConversationTarget): readonly ToolDefinition[] {
    return target.kind === "home" ? this.#homeTools() : this.#assignmentTools(target.assignmentId);
  }

  #homeTools(): readonly ToolDefinition[] {
    const status = defineTool({
      name: "home_status",
      label: "Read Studi status",
      description: "Read the current Studi queue and visible browser work state.",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async () => toolResult(this.#manager.state()),
    });
    const inspect = defineTool({
      name: "queue_inspect",
      label: "Inspect assignment queue",
      description: "Read the verified assignment queue.",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async () => toolResult(this.#manager.state()),
    });
    const start = defineTool({
      name: "queue_start",
      label: "Start assignment",
      description: "Start one verified assignment after the student clearly asks Inky to do it.",
      parameters: Type.Object({ taskId: Type.String({ minLength: 1, maxLength: 256 }) }, { additionalProperties: false }),
      execute: async (_toolCallId, input) => toolResult(await this.#manager.startFromConversation(input.taskId)),
    });
    const cancel = defineTool({
      name: "queue_cancel",
      label: "Cancel assignment",
      description: "Cancel one queued or active assignment after the student asks.",
      parameters: Type.Object({ taskId: Type.String({ minLength: 1, maxLength: 256 }) }, { additionalProperties: false }),
      execute: async (_toolCallId, input) => {
        this.#manager.cancel(input.taskId);
        return toolResult(this.#manager.state());
      },
    });
    const search = defineTool({
      name: "note_search",
      label: "Search Studi notes",
      description: "Search the student's local preference and memory notes.",
      parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false }),
      execute: async (_toolCallId, input) => toolResult(await this.#searchNotes({ kind: "home" }, input.query)),
    });
    return [status, inspect, start, cancel, search];
  }

  #assignmentTools(assignmentId: string): readonly ToolDefinition[] {
    const readAssignment = defineTool({
      name: "assignment_read",
      label: "Read assignment",
      description: "Read the verified details for this addressed assignment.",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async () => toolResult(this.#brief({ kind: "assignment", assignmentId })),
    });
    const search = defineTool({
      name: "note_search",
      label: "Search assignment notes",
      description: "Search local notes available to this assignment conversation.",
      parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false }),
      execute: async (_toolCallId, input) => toolResult(await this.#searchNotes({ kind: "assignment", assignmentId }, input.query)),
    });
    const read = defineTool({
      name: "note_read",
      label: "Read assignment note",
      description: "Read one local memory note selected from note search.",
      parameters: Type.Object({ noteId: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false }),
      execute: async (_toolCallId, input) => {
        const context = this.#noteContext({ kind: "assignment", assignmentId });
        const entry = this.#store.notes.list().find((candidate) => candidate.noteId === input.noteId);
        if (!entry || !noteIsAllowed(entry, context, "search")) throw new Error(`Note ${input.noteId} is not available to this assignment`);
        const note = await this.#store.notes.read(input.noteId);
        if (!note) throw new Error(`Note ${input.noteId} does not exist`);
        return toolResult(note);
      },
    });
    return [readAssignment, search, read];
  }

  async #automaticNotes(target: ConversationTarget): Promise<unknown[]> {
    const entries = retrieveNoteIndex(this.#store.notes.list(), this.#noteContext(target), "automatic");
    return Promise.all(entries.map(async (entry) => ({ entry, content: (await this.#store.notes.read(entry.noteId))?.content ?? null })));
  }

  async #searchNotes(target: ConversationTarget, query: string): Promise<unknown[]> {
    const context = this.#noteContext(target);
    const allowed = retrieveNoteIndex(this.#store.notes.list(), context, "search", 64);
    const terms = query.trim().toLocaleLowerCase().split(/[^\p{L}\p{N}._-]+/u).filter((term) => term.length > 1);
    const matches: Array<{ noteId: string; scope: string; subjectId: string; about: string; title: string; preview: string; score: number }> = [];
    for (const entry of allowed) {
      const document = await this.#store.notes.read(entry.noteId);
      if (!document) continue;
      const haystack = `${entry.title}\n${entry.key}\n${document.content}`.toLocaleLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      if (score) matches.push({ noteId: entry.noteId, scope: entry.scope, subjectId: entry.subjectId, about: entry.about, title: entry.title, preview: document.content.slice(0, 500), score });
    }
    return matches.sort((left, right) => right.score - left.score || left.noteId.localeCompare(right.noteId)).slice(0, 25).map(({ score: _score, ...match }) => match);
  }

  #noteContext(target: ConversationTarget): NoteRetrievalContext {
    if (target.kind === "home") return { kind: "home" };
    const assignment = this.#store.assignments.get(target.assignmentId);
    if (!assignment) throw new Error(`Assignment ${target.assignmentId} does not exist`);
    return {
      kind: "assignment",
      assignmentId: assignment.assignmentId,
      courseId: assignment.courseId,
      confirmedPatternIds: this.#store.manager.listConfirmedPatterns(assignment.assignmentId, assignment.courseId).map((match) => match.patternId),
      courseAssignmentIds: this.#store.assignments.listByCourse(assignment.courseId).map((item) => item.assignmentId),
    };
  }

  async #recordRuntimeEvent(job: AgentJob, event: AgentRunEvent): Promise<void> {
    if (event.type === "tool_started") {
      await this.#emit(job, "tool_started", {
        toolCallId: event.toolCallId,
        name: event.toolName,
        arguments: event.arguments ?? null,
      });
    } else if (event.type === "tool_finished") {
      await this.#emit(job, "tool_finished", {
        toolCallId: event.toolCallId,
        name: event.toolName,
        outcome: event.outcome,
        result: event.result ?? null,
        durationMs: event.durationMs ?? null,
      });
    } else if (event.type === "aborted") {
      await this.#emit(job, "aborted", {});
    }
  }

  async #emit(job: AgentJob, type: Parameters<AgentTrace["emit"]>[0]["type"], payload: Readonly<Record<string, unknown>>): Promise<void> {
    await this.trace.emit({ jobId: job.jobId, runId: job.runId, turnIndex: job.turnIndex, type, payload });
  }

  #assertUsable(): void {
    if (this.#disposed) throw new Error("Conversation coordinator is disposed");
  }
}

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: value,
  };
}

function withTotalTokens(usage: AgentUsageSnapshot): AgentUsageSnapshot & { readonly totalTokens: number } {
  return {
    ...usage,
    totalTokens: usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
  };
}
