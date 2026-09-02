import { randomUUID } from "node:crypto";

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  ManagerStateSchema,
  STUDI_SCHEMA_VERSION,
  resolvePermission,
  transitionTask,
  type AgentRunEvent,
  type BrowserWorkerLease,
  type ManagerQueueEntry,
  type ManagerState,
  type ManagerTurnResult,
  type TaskState,
} from "../../shared/index.js";
import type {
  AgentSession,
  AgentSessionTarget,
} from "../agent/runtime.js";
import type { LocalStore } from "../storage/index.js";

export interface ManagerSessionRuntime {
  createManagerSession(
    tools: readonly ToolDefinition[],
    target?: AgentSessionTarget,
  ): Promise<AgentSession>;
  createWorkerSession(target?: AgentSessionTarget): Promise<AgentSession>;
  createAssignmentSession?(
    tools: readonly ToolDefinition[],
    target?: AgentSessionTarget,
  ): Promise<AgentSession>;
}

export interface EnqueueAssignmentInput {
  readonly taskId: string;
  readonly priority?: number;
}

export interface ManagerCoordinatorOptions {
  readonly now?: () => string;
  readonly startAssignment?: (taskId: string) => Promise<unknown>;
}

export class ManagerCoordinator {
  readonly #store: LocalStore;
  readonly #runtime: ManagerSessionRuntime;
  readonly #now: () => string;
  readonly #startAssignment: ((taskId: string) => Promise<unknown>) | null;
  #managerSession: AgentSession | null = null;
  #workerSession: AgentSession | null = null;
  #disposed = false;

  private constructor(
    store: LocalStore,
    runtime: ManagerSessionRuntime,
    now: () => string,
    startAssignment: ((taskId: string) => Promise<unknown>) | null,
  ) {
    this.#store = store;
    this.#runtime = runtime;
    this.#now = now;
    this.#startAssignment = startAssignment;
  }

  static async create(
    store: LocalStore,
    runtime: ManagerSessionRuntime,
    options: ManagerCoordinatorOptions = {},
  ): Promise<ManagerCoordinator> {
    const coordinator = new ManagerCoordinator(
      store,
      runtime,
      options.now ?? (() => new Date().toISOString()),
      options.startAssignment ?? null,
    );
    await coordinator.#recover();
    await coordinator.#openManagerSession();
    return coordinator;
  }

  state(): ManagerState {
    this.#assertUsable();
    return ManagerStateSchema.parse({
      entries: this.#store.manager.listQueue(),
      lease: this.#store.manager.getLease(),
    });
  }

  enqueue(input: EnqueueAssignmentInput): ManagerQueueEntry {
    this.#assertUsable();
    if (input.priority !== undefined && (!Number.isInteger(input.priority) || input.priority < 0)) {
      throw new TypeError("Queue priority must be a non-negative integer");
    }
    const task = this.#requiredTask(input.taskId);
    const assignment = this.#store.assignments.get(task.assignmentId);
    if (!assignment) {
      throw new Error(`Assignment ${task.assignmentId} does not exist`);
    }
    if (task.state !== "discovered" && task.state !== "queued") {
      throw new Error(`Task ${task.taskId} cannot be queued from ${task.state}`);
    }
    const permission = this.#resolvePermission(assignment.assignmentId, assignment.courseId);
    if (!permission.mayAttempt) {
      throw new Error(`Task ${task.taskId} is blocked by stored permission rules`);
    }
    if (task.state === "discovered") {
      this.#transition(task.taskId, "queued", "Queued by the Studi manager", `manager-${randomUUID()}`);
    }
    const existing = this.#store.manager.getQueueEntry(task.taskId);
    return this.#store.manager.putQueueEntry({
      schemaVersion: STUDI_SCHEMA_VERSION,
      taskId: task.taskId,
      assignmentId: assignment.assignmentId,
      courseId: assignment.courseId,
      ...(assignment.dueAt === undefined ? {} : { dueAt: assignment.dueAt }),
      priority: input.priority ?? existing?.priority ?? 0,
      enqueuedAt: existing?.enqueuedAt ?? this.#now(),
      permission,
    });
  }

  steerNext(taskId: string): ManagerQueueEntry {
    this.#assertUsable();
    return this.#store.manager.steerNext(taskId);
  }

  cancel(taskId: string): void {
    this.#assertUsable();
    const task = this.#requiredTask(taskId);
    if (!["queued", "working", "needs_user", "ready_review"].includes(task.state)) {
      throw new Error(`Task ${taskId} cannot be cancelled from ${task.state}`);
    }
    this.#transition(taskId, "cancelled", "Cancelled by the Studi manager", `manager-${randomUUID()}`);
    if (this.#store.manager.getLease()?.taskId === taskId) {
      this.#workerSession?.dispose();
      this.#workerSession = null;
      this.#store.manager.releaseLease(taskId);
    }
    this.#store.manager.removeQueueEntry(taskId);
  }

  async pauseForStudent(taskId: string, reason: string): Promise<void> {
    this.#assertActiveLease(taskId);
    const task = this.#requiredTask(taskId);
    if (task.state !== "working") throw new Error(`Task ${taskId} cannot be taken over from ${task.state}`);
    await this.#workerSession?.abort();
    this.pause(taskId, "needs_user", reason);
  }

  async startNext(
    assignmentTools: readonly ToolDefinition[] = [],
    resumeSessionPath?: string,
  ): Promise<BrowserWorkerLease | null> {
    this.#assertUsable();
    if (this.#store.manager.getLease()) {
      throw new Error("The visible school browser already has an active worker lease");
    }

    for (const entry of this.#store.manager.listQueue()) {
      const permittedEntry = this.#refreshStartPermission(entry);
      if (!permittedEntry) continue;
      return this.#startEntry(permittedEntry, assignmentTools, resumeSessionPath);
    }
    return null;
  }

  async startTask(
    taskId: string,
    assignmentTools: readonly ToolDefinition[] = [],
    resumeSessionPath?: string,
  ): Promise<BrowserWorkerLease> {
    this.#assertUsable();
    if (this.#store.manager.getLease()) {
      throw new Error("The visible school browser already has an active worker lease");
    }
    const entry = this.#store.manager.getQueueEntry(taskId);
    if (!entry) throw new Error(`Task ${taskId} is not in the manager queue`);
    const permittedEntry = this.#refreshStartPermission(entry);
    if (!permittedEntry) {
      throw new Error(`Task ${taskId} is blocked by stored permission rules`);
    }
    return this.#startEntry(permittedEntry, assignmentTools, resumeSessionPath);
  }

  finish(taskId: string, outcome: "needs_user" | "ready_review" | "failed"): void {
    this.#assertUsable();
    const lease = this.#store.manager.getLease();
    if (!lease || lease.taskId !== taskId || lease.state !== "active") {
      throw new Error(`Task ${taskId} does not own the browser worker lease`);
    }
    this.#transition(taskId, outcome, "Assignment worker released the browser", lease.workerSessionId!);
    this.#workerSession?.dispose();
    this.#workerSession = null;
    this.#store.manager.releaseLease(taskId);
    this.#store.manager.removeQueueEntry(taskId);
  }

  pause(taskId: string, outcome: "needs_user" | "ready_review", reason: string): void {
    this.#assertActiveLease(taskId);
    this.#transition(taskId, outcome, reason, this.#store.manager.getLease()!.workerSessionId!);
  }

  resumePaused(taskId: string, reason: string): void {
    this.#assertActiveLease(taskId);
    const task = this.#requiredTask(taskId);
    if (task.state !== "needs_user") {
      throw new Error(`Task ${taskId} cannot resume from ${task.state}`);
    }
    this.#transition(taskId, "working", reason, this.#store.manager.getLease()!.workerSessionId!);
  }

  beginSubmission(taskId: string): void {
    this.#assertActiveLease(taskId);
    const task = this.#requiredTask(taskId);
    if (task.state !== "working" && task.state !== "ready_review") {
      throw new Error(`Task ${taskId} cannot submit from ${task.state}`);
    }
    this.#transition(taskId, "submitting", "Fresh permission and pre-submit evidence recorded", this.#store.manager.getLease()!.workerSessionId!);
  }

  completeActive(taskId: string, outcome: "submitted" | "preserved" | "failed", reason: string): void {
    this.#assertActiveLease(taskId);
    this.#transition(taskId, outcome, reason, this.#store.manager.getLease()!.workerSessionId!);
    this.#releaseActive(taskId);
  }

  async runWorkerTurn(
    prompt: string,
    observe?: (event: AgentRunEvent) => void,
  ): Promise<{ readonly outcome: "completed" | "failed" | "aborted"; readonly text: string }> {
    this.#assertUsable();
    if (!this.#workerSession) throw new Error("No assignment worker session owns the browser");
    let text = "";
    let outcome: "completed" | "failed" | "aborted" = "failed";
    const unsubscribe = this.#workerSession.subscribe((event) => {
      observe?.(event);
      if (event.type === "text") text += event.delta;
      if (event.type === "terminal") outcome = event.outcome;
    });
    try {
      await this.#workerSession.prompt(prompt);
      return { outcome, text };
    } finally {
      unsubscribe();
    }
  }

  async restoreAssignmentWorker(tools: readonly ToolDefinition[]): Promise<void> {
    this.#assertUsable();
    const lease = this.#store.manager.getLease();
    if (!lease || lease.state !== "active" || !lease.workerSessionPath) return;
    const runtime = this.#requiredAssignmentRuntime();
    this.#workerSession?.dispose();
    this.#workerSession = await runtime.createAssignmentSession!(tools, { resumeSessionPath: lease.workerSessionPath });
  }

  async runManagerTurn(
    prompt: string,
    memoryArtifactIds: readonly string[] = [],
  ): Promise<ManagerTurnResult> {
    this.#assertUsable();
    if (!prompt.trim()) {
      throw new TypeError("Manager prompt cannot be empty");
    }
    const session = await this.#requiredManagerSession();
    const managerPrompt = await this.#buildManagerPrompt(prompt, memoryArtifactIds);
    let text = "";
    let outcome: "completed" | "failed" | "aborted" = "failed";
    const unsubscribe = session.subscribe((event: AgentRunEvent) => {
      if (event.type === "text") {
        text += event.delta;
      } else if (event.type === "terminal") {
        outcome = event.outcome;
      }
    });
    try {
      await session.prompt(managerPrompt);
      return { outcome, text, state: this.state() };
    } finally {
      unsubscribe();
    }
  }

  async replaceManagerSession(): Promise<void> {
    this.#assertUsable();
    const session = await this.#requiredManagerSession();
    await session.replace();
    this.#saveManagerSession(session);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#managerSession?.dispose();
    this.#managerSession = null;
    this.#workerSession?.dispose();
    this.#workerSession = null;
  }

  async #recover(): Promise<void> {
    const lease = this.#store.manager.getLease();
    if (lease?.state === "acquiring") {
      this.#store.manager.releaseLease(lease.taskId);
    } else if (lease?.state === "active") {
      const task = this.#store.tasks.get(lease.taskId);
      if (
        task &&
        ["working", "needs_user", "ready_review", "submitting"].includes(task.state) &&
        lease.workerSessionPath
      ) {
        this.#workerSession = await this.#runtime.createWorkerSession({
          resumeSessionPath: lease.workerSessionPath,
        });
      } else {
        this.#store.manager.releaseLease(lease.taskId);
      }
    }

    for (const entry of this.#store.manager.listQueue()) {
      const task = this.#store.tasks.get(entry.taskId);
      const activeTask = this.#store.manager.getLease()?.taskId;
      if (!task || (task.state !== "queued" && !(task.state === "working" && activeTask === task.taskId))) {
        this.#store.manager.removeQueueEntry(entry.taskId);
      }
    }

    for (const task of this.#store.tasks.listByState("queued")) {
      if (!this.#store.manager.getQueueEntry(task.taskId)) {
        const assignment = this.#store.assignments.get(task.assignmentId);
        if (!assignment) {
          throw new Error(`Assignment ${task.assignmentId} does not exist`);
        }
        const permission = this.#resolvePermission(assignment.assignmentId, assignment.courseId);
        if (!permission.mayAttempt) {
          this.#transition(
            task.taskId,
            "cancelled",
            "Stored permission no longer allows recovery into the queue",
            `manager-${randomUUID()}`,
          );
          continue;
        }
        this.#store.manager.putQueueEntry({
          schemaVersion: STUDI_SCHEMA_VERSION,
          taskId: task.taskId,
          assignmentId: assignment.assignmentId,
          courseId: assignment.courseId,
          ...(assignment.dueAt === undefined ? {} : { dueAt: assignment.dueAt }),
          priority: 0,
          enqueuedAt: task.updatedAt,
          permission,
        });
      }
    }
  }

  async #openManagerSession(): Promise<void> {
    const tools = this.#createManagerTools();
    const stored = this.#store.manager.getManagerSession();
    try {
      this.#managerSession = await this.#runtime.createManagerSession(
        tools,
        stored ? { resumeSessionPath: stored.sessionPath } : {},
      );
    } catch (error) {
      if (!stored) throw error;
      this.#managerSession = await this.#runtime.createManagerSession(tools);
    }
    this.#saveManagerSession(this.#managerSession);
  }

  #createManagerTools(): ToolDefinition[] {
    const inspect = defineTool({
      name: "manager_queue_inspect",
      label: "Inspect Studi queue",
      description: "Read the durable Studi queue and current browser-worker lease.",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async () => toolResult(this.state()),
    });
    const steer = defineTool({
      name: "manager_queue_steer_next",
      label: "Steer queued task next",
      description: "Move one already queued task ahead of other queued tasks. Pattern provenance cannot be supplied here.",
      parameters: Type.Object(
        { taskId: Type.String({ minLength: 1, maxLength: 256 }) },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, input) => toolResult(this.steerNext(input.taskId)),
    });
    const cancel = defineTool({
      name: "manager_queue_cancel",
      label: "Cancel queued task",
      description: "Cancel one queued or working task and release its lease if it owns the browser.",
      parameters: Type.Object(
        { taskId: Type.String({ minLength: 1, maxLength: 256 }) },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, input) => {
        this.cancel(input.taskId);
        return toolResult(this.state());
      },
    });
    const start = this.#startAssignment
      ? defineTool({
          name: "manager_assignment_start",
          label: "Start verified queued assignment",
          description: "Select one verified task already in the durable queue and ask Studi's existing assignment execution owner to start it.",
          parameters: Type.Object(
            { taskId: Type.String({ minLength: 1, maxLength: 256 }) },
            { additionalProperties: false },
          ),
          execute: async (_toolCallId, input) => {
            const entry = this.#store.manager.getQueueEntry(input.taskId);
            if (!entry) throw new Error(`Task ${input.taskId} is not in the manager queue`);
            const assignment = this.#store.assignments.get(entry.assignmentId);
            if (!assignment?.lastVerifiedScanId || assignment.evidence.length === 0) {
              throw new Error(`Task ${input.taskId} is not backed by a verified scanned assignment`);
            }
            this.steerNext(input.taskId);
            const execution = await this.#startAssignment!(input.taskId);
            return toolResult({ taskId: input.taskId, execution, state: this.state() });
          },
        })
      : null;
    return start ? [inspect, steer, cancel, start] : [inspect, steer, cancel];
  }

  #resolvePermission(assignmentId: string, courseId: string) {
    const matchedPatternIds = this.#store.manager
      .listConfirmedPatterns(assignmentId, courseId)
      .map((match) => match.patternId);
    return resolvePermission(
      { assignmentId, courseId, matchedPatternIds },
      this.#store.permissionRules.listAll(),
    );
  }

  resolvePermission(assignmentId: string, courseId: string) {
    this.#assertUsable();
    return this.#resolvePermission(assignmentId, courseId);
  }

  #refreshStartPermission(entry: ManagerQueueEntry): ManagerQueueEntry | null {
    const permission = this.#resolvePermission(entry.assignmentId, entry.courseId);
    if (!permission.mayAttempt) {
      this.#transition(
        entry.taskId,
        "cancelled",
        "Stored permission no longer allows an attempt",
        `manager-${randomUUID()}`,
      );
      this.#store.manager.removeQueueEntry(entry.taskId);
      return null;
    }
    return JSON.stringify(permission) === JSON.stringify(entry.permission)
      ? entry
      : this.#store.manager.putQueueEntry({ ...entry, permission });
  }

  async #startEntry(
    entry: ManagerQueueEntry,
    assignmentTools: readonly ToolDefinition[],
    resumeSessionPath?: string,
  ): Promise<BrowserWorkerLease> {
    const acquiring = this.#store.manager.acquireLease(entry.taskId, this.#now());
    if (!acquiring) {
      throw new Error("The visible school browser already has an active worker lease");
    }
    let worker: AgentSession | null = null;
    try {
      const managerSession = await this.#requiredManagerSession();
      if (!managerSession.sessionPath) {
        throw new Error("Pi did not persist the manager session");
      }
      const target = resumeSessionPath
        ? { resumeSessionPath }
        : { parentSessionPath: managerSession.sessionPath };
      worker = assignmentTools.length > 0
        ? await this.#requiredAssignmentRuntime().createAssignmentSession!(assignmentTools, target)
        : await this.#runtime.createWorkerSession(target);
      if (!worker.sessionPath) {
        throw new Error("Pi did not persist the assignment worker session");
      }
      const lease = this.#store.manager.activateLease(
        entry.taskId,
        worker.sessionId,
        worker.sessionPath,
      );
      this.#transition(entry.taskId, "working", "Browser worker lease acquired", worker.sessionId);
      this.#workerSession = worker;
      return lease;
    } catch (error) {
      worker?.dispose();
      this.#store.manager.releaseLease(entry.taskId);
      throw error;
    }
  }

  #transition(taskId: string, to: TaskState, reason: string, runId: string): void {
    const current = this.#requiredTask(taskId);
    const sequence = this.#store.tasks.listEvents(taskId).length;
    const result = transitionTask(current, {
      type: "transition",
      to,
      eventId: `event-${randomUUID()}`,
      runId,
      sequence,
      occurredAt: this.#now(),
      reason,
    });
    if (!result.ok) {
      throw new Error(`Task ${taskId} cannot move from ${current.state} to ${to}`);
    }
    this.#store.tasks.append({
      event: result.event,
      projection: result.task,
      expectedRevision: current.revision,
    });
  }

  #requiredTask(taskId: string) {
    const task = this.#store.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} does not exist`);
    return task;
  }

  async #buildManagerPrompt(prompt: string, memoryArtifactIds: readonly string[]): Promise<string> {
    const preferences = await this.#store.artifacts.list("preference");
    const memoryVisibility = (await this.#store.productPreferences.get()).memoryVisibility;
    const visibleMemoryIds = memoryVisibility === "none"
      ? []
      : memoryVisibility === "all"
        ? (await this.#store.artifacts.list("memory")).map((memory) => memory.frontmatter.artifactId)
        : [...new Set(memoryArtifactIds)];
    const memories = [];
    for (const artifactId of visibleMemoryIds) {
      const memory = await this.#store.artifacts.read("memory", artifactId);
      if (!memory) throw new Error(`Scoped memory ${artifactId} does not exist`);
      memories.push(memory);
    }
    return [
      "# Global preferences",
      preferences.length === 0
        ? "No global preferences are stored."
        : preferences.map((item) => `## ${item.frontmatter.artifactId}\n${item.content}`).join("\n\n"),
      "# Scoped memories",
      memories.length === 0
        ? "No scoped memories were requested for this turn."
        : memories.map((item) => `## ${item.frontmatter.artifactId}\n${item.content}`).join("\n\n"),
      "# Student request",
      prompt.trim(),
    ].join("\n\n");
  }

  async #requiredManagerSession(): Promise<AgentSession> {
    if (!this.#managerSession) await this.#openManagerSession();
    return this.#managerSession!;
  }

  #saveManagerSession(session: AgentSession): void {
    if (!session.sessionPath) throw new Error("Pi did not persist the manager session");
    this.#store.manager.saveManagerSession({
      schemaVersion: STUDI_SCHEMA_VERSION,
      sessionId: session.sessionId,
      sessionPath: session.sessionPath,
      updatedAt: this.#now(),
    });
  }

  #assertUsable(): void {
    if (this.#disposed) throw new Error("Manager coordinator is disposed");
  }

  #assertActiveLease(taskId: string): BrowserWorkerLease {
    const lease = this.#store.manager.getLease();
    if (!lease || lease.taskId !== taskId || lease.state !== "active") {
      throw new Error(`Task ${taskId} does not own the browser worker lease`);
    }
    return lease;
  }

  #releaseActive(taskId: string): void {
    this.#workerSession?.dispose();
    this.#workerSession = null;
    this.#store.manager.releaseLease(taskId);
    this.#store.manager.removeQueueEntry(taskId);
  }

  #requiredAssignmentRuntime(): ManagerSessionRuntime & Required<Pick<ManagerSessionRuntime, "createAssignmentSession">> {
    if (!this.#runtime.createAssignmentSession) {
      throw new Error("The agent runtime cannot create an assignment session");
    }
    return this.#runtime as ManagerSessionRuntime & Required<Pick<ManagerSessionRuntime, "createAssignmentSession">>;
  }
}

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: value,
  };
}
