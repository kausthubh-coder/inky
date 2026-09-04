import { randomUUID } from "node:crypto";

import {
  AgentHostSnapshotSchema,
  AgentJobSchema,
  HarnessCommandSchema,
  HarnessReplySchema,
  type AgentHostSnapshot,
  type AgentJob,
  type AgentTarget,
  type HarnessCommand,
  type HarnessReply,
} from "./contracts.js";
import { buildAgentTurn, type BuiltAgentTurn } from "./turn-builder.js";
import { AgentTrace, type AgentTraceEvent } from "./trace.js";

export interface AgentDriverResult {
  readonly text: string;
  readonly outcome: "completed" | "failed" | "needs_user" | "review";
  readonly usage?: Readonly<Record<string, number | null>>;
  readonly toolCalls?: readonly Readonly<{
    name: string;
    arguments: unknown;
    result: unknown;
    durationMs: number;
  }>[];
}

export interface AgentDriver {
  readonly id: string;
  run(turn: BuiltAgentTurn, signal: AbortSignal): Promise<AgentDriverResult>;
}

export interface AgentJobStore {
  load(): Promise<AgentHostSnapshot | null>;
  save(snapshot: AgentHostSnapshot): Promise<void>;
}

export class MemoryAgentJobStore implements AgentJobStore {
  #snapshot: AgentHostSnapshot | null = null;

  async load(): Promise<AgentHostSnapshot | null> {
    return this.#snapshot ? structuredClone(this.#snapshot) : null;
  }

  async save(snapshot: AgentHostSnapshot): Promise<void> {
    this.#snapshot = structuredClone(snapshot);
  }
}

export interface AgentJobHostOptions {
  readonly driver: AgentDriver;
  readonly store?: AgentJobStore;
  readonly trace?: AgentTrace;
  readonly now?: () => string;
}

function targetKey(target: AgentTarget): string {
  if (target.kind === "assignment") return `assignment:${target.assignmentId}`;
  if (target.kind === "scan") return `scan:${target.scanId}`;
  return target.kind;
}

export class AgentJobHost {
  readonly #driver: AgentDriver;
  readonly #store: AgentJobStore;
  readonly #trace: AgentTrace;
  readonly #now: () => string;
  readonly #jobs = new Map<string, AgentJob>();
  readonly #cumulativeUsage: Record<string, number | null> = {};
  #activeJobId: string | null = null;
  #abortController: AbortController | null = null;

  private constructor(options: AgentJobHostOptions) {
    this.#driver = options.driver;
    this.#store = options.store ?? new MemoryAgentJobStore();
    this.#trace = options.trace ?? new AgentTrace(options.now ? { now: options.now } : {});
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  static async create(options: AgentJobHostOptions): Promise<AgentJobHost> {
    const host = new AgentJobHost(options);
    await host.#reload();
    return host;
  }

  traceEvents(): readonly AgentTraceEvent[] {
    return this.#trace.events();
  }

  snapshot(): AgentHostSnapshot {
    const jobs = [...this.#jobs.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const browserClaim = jobs.find((job) => job.claim)?.claim ?? null;
    return AgentHostSnapshotSchema.parse({ schemaVersion: 1, activeJobId: this.#activeJobId, jobs, browserClaim });
  }

  async execute(rawCommand: unknown): Promise<HarnessReply> {
    let command: HarnessCommand;
    try {
      command = HarnessCommandSchema.parse(rawCommand);
    } catch (error) {
      return HarnessReplySchema.parse({
        schemaVersion: 1,
        ok: false,
        command: "inspect",
        state: this.snapshot(),
        error: error instanceof Error ? error.message : "Invalid harness command",
      });
    }

    try {
      if (command.command === "inspect") return this.#reply(command, {});
      if (command.command === "restart") {
        await this.#reload();
        const active = this.#activeJob();
        if (active) await this.#emit(active, "restart", { restored: true });
        return this.#reply(command, {});
      }
      if (command.command === "abort") {
        await this.#abort();
        return this.#reply(command, {});
      }
      if (command.command === "quit") {
        await this.#persist();
        return this.#reply(command, { quit: true });
      }
      if (command.command === "start_assignment") {
        return await this.#startWork({ kind: "assignment", assignmentId: command.assignmentId }, command);
      }
      if (command.command === "start_scan") {
        return await this.#startWork({ kind: "scan", scanId: command.scanId }, command);
      }
      return await this.#send(command);
    } catch (error) {
      const active = this.#activeJob();
      if (active) await this.#emit(active, "error", { message: error instanceof Error ? error.message : "Agent host failed" });
      return this.#reply(command, { error: error instanceof Error ? error.message : "Agent host failed" });
    }
  }

  async #send(command: Extract<HarnessCommand, { command: "send" }>): Promise<HarnessReply> {
    const job = await this.#requiredJob(command.target);
    this.#activeJobId = job.jobId;
    if (job.target.kind === "tutor") {
      await this.#update(job, { phase: "not_supported" });
      return this.#reply(command, { error: "Tutor is not supported in this release", toolNames: [] });
    }

    const turnIndex = job.turnIndex + 1;
    const userMessage = {
      messageId: randomUUID(),
      role: "user" as const,
      text: command.text.trim(),
      createdAt: this.#now(),
      turnIndex,
    };
    let current = await this.#update(job, {
      phase: job.phase === "working" ? "working" : "conversing",
      turnIndex,
      messages: [...job.messages, userMessage],
    });
    await this.#emit(current, "message_received", { target: current.target, text: userMessage.text });
    const result = await this.#runTurn(current, userMessage.text);
    current = this.#jobs.get(current.jobId)!;
    return this.#reply(command, { reply: result.text, toolNames: result.turn.toolNames, traceId: this.#trace.traceId });
  }

  async #startWork(
    target: Extract<AgentTarget, { kind: "assignment" | "scan" }>,
    command: HarnessCommand,
  ): Promise<HarnessReply> {
    const conflicting = [...this.#jobs.values()].find((job) => job.claim && targetKey(job.target) !== targetKey(target));
    if (conflicting) throw new Error(`Browser is already claimed by ${targetKey(conflicting.target)}`);
    let job = await this.#requiredJob(target);
    this.#activeJobId = job.jobId;
    job = await this.#update(job, { phase: "acquiring" });
    await this.#emit(job, "phase_changed", { phase: "acquiring" });
    const claim = {
      claimId: randomUUID(),
      jobId: job.jobId,
      target,
      acquiredAt: this.#now(),
      revision: (job.claim?.revision ?? 0) + 1,
    };
    job = await this.#update(job, { phase: "working", claim });
    await this.#emit(job, "claim_changed", { state: "acquired", claim });
    await this.#emit(job, "phase_changed", { phase: "working" });
    return this.#reply(command, {
      toolNames: (await buildAgentTurn({ target, phase: "working", hasBrowserClaim: true }, "Begin work.")).toolNames,
      traceId: this.#trace.traceId,
    });
  }

  async #runTurn(job: AgentJob, text: string): Promise<{ text: string; turn: BuiltAgentTurn }> {
    const turn = await buildAgentTurn(
      { target: job.target, phase: job.phase, hasBrowserClaim: Boolean(job.claim) },
      text,
      { sections: [{ title: "Job", content: JSON.stringify({ jobId: job.jobId, runId: job.runId, turnIndex: job.turnIndex }) }] },
    );
    await this.#emit(job, "turn_built", {
      prompt: turn.prompt,
      promptHash: turn.promptHash,
      systemHash: turn.system.hash,
      packs: turn.system.packs.map((pack) => ({ id: pack.id, hash: pack.hash })),
      toolNames: turn.toolNames,
    });
    this.#abortController = new AbortController();
    await this.#emit(job, "model_started", { driver: this.#driver.id });
    const startedAt = Date.now();
    const result = await this.#driver.run(turn, this.#abortController.signal);
    mergeUsage(this.#cumulativeUsage, result.usage);
    const totalDurationMs = Date.now() - startedAt;
    const toolDurationMs = (result.toolCalls ?? []).reduce((total, call) => total + call.durationMs, 0);
    await this.#emit(job, "model_finished", {
      driver: this.#driver.id,
      durationMs: totalDurationMs,
      totalDurationMs,
      toolDurationMs,
      modelDurationMs: Math.max(0, totalDurationMs - toolDurationMs),
      firstTokenMs: null,
      outcome: result.outcome,
      usage: result.usage ?? null,
      cumulativeUsage: { ...this.#cumulativeUsage },
    });
    for (const toolCall of result.toolCalls ?? []) {
      await this.#emit(job, "tool_started", { name: toolCall.name, arguments: toolCall.arguments });
      await this.#emit(job, "tool_finished", { name: toolCall.name, result: toolCall.result, durationMs: toolCall.durationMs });
    }
    const assistantMessage = {
      messageId: randomUUID(),
      role: "assistant" as const,
      text: result.text,
      createdAt: this.#now(),
      turnIndex: job.turnIndex,
    };
    const phase = result.outcome === "completed"
      ? job.claim ? "working" as const : "conversing" as const
      : result.outcome;
    const updated = await this.#update(job, { phase, messages: [...job.messages, assistantMessage] });
    await this.#emit(updated, "reply_recorded", { text: result.text });
    await this.#emit(updated, "phase_changed", { phase });
    this.#abortController = null;
    return { text: result.text, turn };
  }

  async #abort(): Promise<void> {
    this.#abortController?.abort();
    const active = this.#activeJob();
    if (!active) return;
    const updated = await this.#update(active, { phase: "aborted", claim: null });
    await this.#emit(updated, "aborted", {});
  }

  async #requiredJob(target: AgentTarget): Promise<AgentJob> {
    const existing = [...this.#jobs.values()].find((job) => targetKey(job.target) === targetKey(target));
    if (existing) return existing;
    const now = this.#now();
    const job = AgentJobSchema.parse({
      schemaVersion: 1,
      jobId: randomUUID(),
      target,
      phase: target.kind === "tutor" ? "not_supported" : "idle",
      turnIndex: 0,
      runId: randomUUID(),
      sessionId: null,
      claim: null,
      messages: [],
      createdAt: now,
      updatedAt: now,
    });
    this.#jobs.set(job.jobId, job);
    await this.#persist();
    await this.#emit(job, "job_created", { target });
    return job;
  }

  async #update(job: AgentJob, patch: Partial<AgentJob>): Promise<AgentJob> {
    const updated = AgentJobSchema.parse({ ...job, ...patch, updatedAt: this.#now() });
    this.#jobs.set(updated.jobId, updated);
    await this.#persist();
    return updated;
  }

  async #emit(job: AgentJob, type: Parameters<AgentTrace["emit"]>[0]["type"], payload: Readonly<Record<string, unknown>>): Promise<void> {
    await this.#trace.emit({ jobId: job.jobId, runId: job.runId, turnIndex: job.turnIndex, type, payload });
  }

  async #reload(): Promise<void> {
    const snapshot = await this.#store.load();
    this.#jobs.clear();
    if (!snapshot) return;
    const parsed = AgentHostSnapshotSchema.parse(snapshot);
    for (const job of parsed.jobs) this.#jobs.set(job.jobId, job);
    this.#activeJobId = parsed.activeJobId;
  }

  async #persist(): Promise<void> {
    await this.#store.save(this.snapshot());
  }

  #activeJob(): AgentJob | null {
    return this.#activeJobId ? this.#jobs.get(this.#activeJobId) ?? null : null;
  }

  #reply(command: HarnessCommand, fields: { readonly reply?: string; readonly error?: string; readonly toolNames?: readonly string[]; readonly traceId?: string; readonly quit?: boolean }): HarnessReply {
    return HarnessReplySchema.parse({
      schemaVersion: 1,
      ok: !fields.error,
      command: command.command,
      state: this.snapshot(),
      ...fields,
    });
  }
}

function mergeUsage(target: Record<string, number | null>, usage: Readonly<Record<string, number | null>> | undefined): void {
  if (!usage) return;
  for (const [key, value] of Object.entries(usage)) {
    if (value === null) {
      if (!(key in target)) target[key] = null;
      continue;
    }
    target[key] = (target[key] ?? 0) + value;
  }
}
