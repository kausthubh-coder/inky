import { randomUUID } from "node:crypto";

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

import {
  ManagerStateSchema,
  AgentJobSchema,
  STUDI_SCHEMA_VERSION,
  resolvePermission,
  transitionTask,
  type AgentRunEvent,
  type BrowserWorkerLease,
  type ManagerQueueEntry,
  type ManagerState,
  type TaskState,
} from "../../shared/index.js";
import type {
  AgentSession,
  AgentSessionTarget,
} from "../agent/runtime.js";
import type { LocalStore } from "../storage/index.js";

export interface AssignmentWorkerRuntime {
  createWorkerSession(target?: AgentSessionTarget): Promise<AgentSession>;
  createAssignmentSession?(
    tools: readonly ToolDefinition[],
    target?: AgentSessionTarget,
  ): Promise<AgentSession>;
}

export type AssignmentSessionPlan = Readonly<{
  tools: readonly ToolDefinition[];
  cwd?: string;
}>;

type AssignmentSessionPlanInput =
  | readonly ToolDefinition[]
  | ((assignmentId: string) => Promise<AssignmentSessionPlan>);
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
  readonly #runtime: AssignmentWorkerRuntime;
  readonly #now: () => string;
  readonly #startAssignment: ((taskId: string) => Promise<unknown>) | null;
  #workerSession: AgentSession | null = null;
  #workerRunning = false;
  #disposed = false;
  #beforeAssignmentWork: ((assignmentId: string) => Promise<void>) | null = null;

  private constructor(
    store: LocalStore,
    runtime: AssignmentWorkerRuntime,
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
    runtime: AssignmentWorkerRuntime,
    options: ManagerCoordinatorOptions = {},
  ): Promise<ManagerCoordinator> {
    const coordinator = new ManagerCoordinator(
      store,
      runtime,
      options.now ?? (() => new Date().toISOString()),
      options.startAssignment ?? null,
    );
    await coordinator.#recover();
    return coordinator;
  }

  state(): ManagerState {
    this.#assertUsable();
    return ManagerStateSchema.parse({
      entries: this.#store.manager.listQueue(),
      lease: this.#store.manager.getLease(),
    });
  }

  setBeforeAssignmentWork(handler: ((assignmentId: string) => Promise<void>) | null): void {
    this.#beforeAssignmentWork = handler;
  }

  workerToolNames(): readonly string[] {
    return this.#workerSession?.toolNames ?? [];
  }

  activeTaskForAssignment(assignmentId: string): string | null {
    const lease = this.#store.manager.getLease();
    if (!lease || lease.state !== "active") return null;
    return this.#store.tasks.get(lease.taskId)?.assignmentId === assignmentId ? lease.taskId : null;
  }

  async startFromConversation(taskId: string): Promise<unknown> {
    this.#assertUsable();
    if (!this.#startAssignment) throw new Error("Assignment execution is not ready");
    const entry = this.#store.manager.getQueueEntry(taskId);
    if (!entry) throw new Error(`Task ${taskId} is not in the manager queue`);
    const permittedEntry = this.#refreshStartPermission(entry);
    if (!permittedEntry) throw new Error(`Task ${taskId} is blocked by stored permission rules`);
    const assignment = this.#store.assignments.get(entry.assignmentId);
    if (!assignment?.lastVerifiedScanId || assignment.evidence.length === 0) {
      throw new Error(`Task ${taskId} is not backed by a verified scanned assignment`);
    }
    this.steerNext(taskId);
    return this.#startAssignment(taskId);
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
      this.#releaseAgentClaim(taskId, "aborted");
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
    assignmentTools: AssignmentSessionPlanInput = [],
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
    assignmentTools: AssignmentSessionPlanInput = [],
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
    this.#releaseAgentClaim(taskId, outcome === "failed" ? "failed" : "review");
    this.#store.manager.removeQueueEntry(taskId);
  }

  pause(taskId: string, outcome: "needs_user" | "ready_review", reason: string): void {
    this.#assertActiveLease(taskId);
    this.#transition(taskId, outcome, reason, this.#store.manager.getLease()!.workerSessionId!);
    this.#setAgentPhase(taskId, outcome === "needs_user" ? "needs_user" : "review");
  }

  resumePaused(taskId: string, reason: string): void {
    this.#assertActiveLease(taskId);
    const task = this.#requiredTask(taskId);
    if (task.state !== "needs_user") {
      throw new Error(`Task ${taskId} cannot resume from ${task.state}`);
    }
    this.#transition(taskId, "working", reason, this.#store.manager.getLease()!.workerSessionId!);
    this.#setAgentPhase(taskId, "working");
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
    if (this.#workerRunning) throw new Error("The assignment worker is already handling a turn");
    this.#workerRunning = true;
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
      this.#workerRunning = false;
    }
  }

  async restoreAssignmentWorker(tools: AssignmentSessionPlanInput): Promise<void> {
    this.#assertUsable();
    const lease = this.#store.manager.getLease();
    if (!lease || lease.state !== "active" || !lease.workerSessionPath) return;
    const runtime = this.#requiredAssignmentRuntime();
    this.#workerSession?.dispose();
    const plan = await resolveAssignmentSessionPlan(tools, this.#requiredTask(lease.taskId).assignmentId);
    this.#workerSession = await runtime.createAssignmentSession!(plan.tools, {
      resumeSessionPath: lease.workerSessionPath,
      ...(plan.cwd ? { cwd: plan.cwd } : {}),
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
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
    assignmentTools: AssignmentSessionPlanInput,
    resumeSessionPath?: string,
  ): Promise<BrowserWorkerLease> {
    const acquiring = this.#store.manager.acquireLease(entry.taskId, this.#now());
    if (!acquiring) {
      throw new Error("The visible school browser already has an active worker lease");
    }
    let worker: AgentSession | null = null;
    try {
      await this.#beforeAssignmentWork?.(entry.assignmentId);
      const agentJob = this.#requiredAssignmentJob(entry.assignmentId);
      const target = resumeSessionPath
        ? { resumeSessionPath }
        : agentJob.sessionPath
          ? { resumeSessionPath: agentJob.sessionPath }
          : {};
      const plan = await resolveAssignmentSessionPlan(assignmentTools, entry.assignmentId);
      const sessionTarget = { ...target, ...(plan.cwd ? { cwd: plan.cwd } : {}) };
      worker = plan.tools.length > 0
        ? await this.#requiredAssignmentRuntime().createAssignmentSession!(plan.tools, sessionTarget)
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
      const claim = {
        claimId: randomUUID(),
        jobId: agentJob.job.jobId,
        target: agentJob.job.target,
        acquiredAt: this.#now(),
        revision: (agentJob.job.claim?.revision ?? 0) + 1,
      };
      this.#store.agentJobs.put(AgentJobSchema.parse({
        ...agentJob.job,
        phase: "working",
        turnIndex: agentJob.job.turnIndex + 1,
        runId: randomUUID(),
        sessionId: worker.sessionId,
        claim,
        updatedAt: this.#now(),
      }), worker.sessionPath);
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
    this.#releaseAgentClaim(taskId, "completed");
    this.#store.manager.removeQueueEntry(taskId);
  }

  #requiredAssignmentJob(assignmentId: string) {
    const target = { kind: "assignment" as const, assignmentId };
    const existing = this.#store.agentJobs.getByTarget(target);
    if (existing) return existing;
    const now = this.#now();
    return this.#store.agentJobs.put(AgentJobSchema.parse({
      schemaVersion: 1,
      jobId: randomUUID(),
      target,
      phase: "idle",
      turnIndex: 0,
      runId: randomUUID(),
      sessionId: null,
      claim: null,
      messages: [],
      createdAt: now,
      updatedAt: now,
    }));
  }

  #releaseAgentClaim(taskId: string, phase: "review" | "completed" | "failed" | "aborted"): void {
    const task = this.#store.tasks.get(taskId);
    if (!task) return;
    const persisted = this.#store.agentJobs.getByTarget({ kind: "assignment", assignmentId: task.assignmentId });
    if (!persisted) return;
    this.#store.agentJobs.put(AgentJobSchema.parse({
      ...persisted.job,
      phase,
      claim: null,
      updatedAt: this.#now(),
    }), persisted.sessionPath);
  }

  #setAgentPhase(taskId: string, phase: "working" | "needs_user" | "review"): void {
    const task = this.#store.tasks.get(taskId);
    if (!task) return;
    const persisted = this.#store.agentJobs.getByTarget({ kind: "assignment", assignmentId: task.assignmentId });
    if (!persisted?.job.claim) return;
    this.#store.agentJobs.put(AgentJobSchema.parse({
      ...persisted.job,
      phase,
      updatedAt: this.#now(),
    }), persisted.sessionPath);
  }

  #requiredAssignmentRuntime(): AssignmentWorkerRuntime & Required<Pick<AssignmentWorkerRuntime, "createAssignmentSession">> {
    if (!this.#runtime.createAssignmentSession) {
      throw new Error("The agent runtime cannot create an assignment session");
    }
    return this.#runtime as AssignmentWorkerRuntime & Required<Pick<AssignmentWorkerRuntime, "createAssignmentSession">>;
  }
}

async function resolveAssignmentSessionPlan(
  input: AssignmentSessionPlanInput,
  assignmentId: string,
): Promise<AssignmentSessionPlan> {
  return typeof input === "function" ? input(assignmentId) : { tools: input };
}
