import { randomUUID } from "node:crypto";

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

import {
  ManagerStateSchema,
  AgentJobSchema,
  STUDI_SCHEMA_VERSION,
  resolvePermission,
  assignmentWorkEligibility,
  AssignmentKindSchema,
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
import { plannedAssignmentStart } from "../lifecycle/schedule.js";

export interface AssignmentWorkerRuntime {
  createWorkerSession(target?: AgentSessionTarget): Promise<AgentSession>;
  createAssignmentSession?(
    tools: readonly ToolDefinition[],
    target?: AgentSessionTarget,
    control?: { readonly assertActive: () => void },
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
  readonly retry?: boolean;
  readonly requestOrigin?: "student" | "automatic";
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
  #workStartMode: "manual" | "automatic" = "manual";
  #schedulingEnabled = false;
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
    coordinator.#workStartMode = (await store.productPreferences.get()).workStartMode ?? "manual";
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
    if (this.#store.manager.getLease()) throw new Error("Inky is already on another page.");
    const task = this.#requiredTask(taskId);
    const assignment = this.#store.assignments.get(task.assignmentId);
    if (!assignment?.lastVerifiedScanId || assignment.evidence.length === 0) {
      throw new Error(`Task ${taskId} is not backed by a verified scanned assignment`);
    }
    const existing = this.#store.manager.getQueueEntry(taskId);
    if (existing && !this.#refreshStartPermission(existing)) {
      throw new Error(`Task ${taskId} is blocked by stored permission rules`);
    }
    this.enqueue({ taskId, retry: true });
    this.steerNext(taskId);
    return this.#startAssignment(taskId);
  }

  enqueue(input: EnqueueAssignmentInput): ManagerQueueEntry {
    this.#assertUsable();
    if (input.priority !== undefined && (!Number.isInteger(input.priority) || input.priority < 0)) {
      throw new TypeError("Queue priority must be a non-negative integer");
    }
    const task = this.#requiredTask(input.taskId);
    const requestOrigin = input.requestOrigin ?? "student";
    if (requestOrigin === "automatic" && this.#workStartMode !== "automatic") throw new Error("Inky starts homework only when you ask.");
    const assignment = this.#store.assignments.get(task.assignmentId);
    if (!assignment) {
      throw new Error(`Assignment ${task.assignmentId} does not exist`);
    }
    const retrying = input.retry === true && (task.state === "failed" || task.state === "cancelled");
    if (task.state !== "discovered" && task.state !== "queued" && !retrying) {
      throw new Error(`Task ${task.taskId} cannot be queued from ${task.state}`);
    }
    const permission = this.#resolvePermission(assignment.assignmentId, assignment.courseId);
    if (!permission.mayAttempt) {
      throw new Error(`Task ${task.taskId} is blocked by stored permission rules`);
    }
    const eligibility = assignmentWorkEligibility(assignment, this.#now());
    if (!eligibility.eligible) throw new Error(eligibility.reason);
    if (task.state === "discovered" || retrying) {
      this.#transition(task.taskId, "queued", retrying ? "Retried at the student’s request" : "Queued by the Studi manager", `manager-${randomUUID()}`);
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
      requestOrigin: existing?.requestOrigin === "student" ? "student" : requestOrigin,
      scheduledStartAt: this.#plannedStart(assignment, existing?.enqueuedAt ?? this.#now()),
    });
  }

  steerNext(taskId: string): ManagerQueueEntry {
    this.#assertUsable();
    return this.#store.manager.steerNext(taskId);
  }

  reorderQueue(taskIds: readonly string[]): ManagerState {
    this.#assertUsable();
    if (taskIds.some(id => this.#requiredTask(id).state !== "queued")) throw new Error("Only waiting homework can be reordered.");
    this.#store.manager.reorderQueue(taskIds);
    return this.state();
  }

  async setAssignmentOwner(assignmentId: string, owner: "student" | "inky"): Promise<void> {
    this.#assertUsable();
    const assignment = this.#store.assignments.get(assignmentId);
    if (!assignment) throw new Error("This assignment is no longer available.");
    const tasks = this.#store.tasks.listAll().filter(task => task.assignmentId === assignment.assignmentId);
    if (tasks.some(task => task.state === "submitting")) throw new Error("Submission has begun. Wait for its result before changing who does this work.");
    const ruleId = `owner-${assignment.assignmentId}`.slice(0, 256);
    this.#store.database.transaction(() => {
      const currentRule = this.#store.permissionRules.listAll().find(rule => rule.scope === "assignment" && rule.assignmentId === assignment.assignmentId);
      if (owner === "student") {
        this.#store.assignments.put({ ...assignment, owner, ownerPreviousMode: assignment.owner === "student" ? assignment.ownerPreviousMode : currentRule?.mode });
        this.#store.permissionRules.put({ schemaVersion: 1, ruleId, scope: "assignment", assignmentId: assignment.assignmentId, mode: "do_not_attempt", updatedAt: this.#now() });
      } else {
        if (assignment.owner === "student" && currentRule?.ruleId === ruleId) {
          if (assignment.ownerPreviousMode) this.#store.permissionRules.put({ ...currentRule, mode: assignment.ownerPreviousMode, updatedAt: this.#now() });
          else this.#store.permissionRules.delete(ruleId);
        }
        this.#store.assignments.put({ ...assignment, owner, ownerPreviousMode: undefined });
      }
      this.reconcileQueue();
    });
    if (owner === "student") {
      for (const task of tasks) {
        if (["working", "needs_user", "ready_review"].includes(this.#requiredTask(task.taskId).state)) {
          await this.#workerSession?.abort();
          if (["working", "needs_user", "ready_review"].includes(this.#requiredTask(task.taskId).state)) this.cancel(task.taskId);
        }
      }
    }
  }

  ignoreAssignment(assignmentId: string, reason: string): void {
    this.#store.database.transaction(() => {
      const tasks = this.#store.tasks.listAll().filter(task => task.assignmentId === assignmentId);
      if (tasks.some(task => !["discovered", "queued", "failed", "cancelled", "ignored"].includes(task.state))) throw new Error("Stop the current work before marking this assignment done or not homework.");
      for (const task of tasks) {
        if (task.state !== "ignored") this.#transition(task.taskId, "ignored", reason, `student-${randomUUID()}`);
        this.#store.manager.removeQueueEntry(task.taskId);
      }
    });
  }

  // Called only when the student explicitly saves a rule for this kind.
  confirmKindMatches(courseId: string, kind: string): void {
    for (const assignment of this.#store.assignments.listByCourse(courseId)) {
      if (assignment.kind === kind && assignment.kindConfidence === "explicit" && assignment.kindEvidence) this.#store.manager.confirmPatternMatch({ schemaVersion: 1, assignmentId: assignment.assignmentId, courseId: assignment.courseId, patternId: kind, confirmedAt: this.#now() });
    }
    this.reconcileQueue();
  }

  cancel(taskId: string): void {
    this.#assertUsable();
    const task = this.#requiredTask(taskId);
    if (!["queued", "working", "needs_user", "ready_review"].includes(task.state)) {
      throw new Error(`Task ${taskId} cannot be cancelled from ${task.state}`);
    }
    this.#transition(taskId, "cancelled", "Cancelled by the Studi manager", `manager-${randomUUID()}`);
    const execution = this.#store.lifecycle.getExecution(taskId);
    if (execution) this.#store.lifecycle.putExecution({
      ...execution, phase: "failed", lastError: "Cancelled by the student.",
      reviewDeadline: undefined, handoffDeadline: undefined, updatedAt: this.#now(),
    });
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
    if (!["working", "ready_review"].includes(task.state)) throw new Error(`Task ${taskId} cannot be taken over from ${task.state}`);
    this.pause(taskId, "needs_user", reason);
    await this.abortWorkerTurn();
  }

  async abortWorkerTurn(): Promise<void> { await this.#workerSession?.abort(); }

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
    if (!this.#store.manager.getQueueEntry(taskId)) this.enqueue({ taskId, retry: true, requestOrigin: "student" });
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

  get isWorkerRunning(): boolean { return this.#workerRunning; }

  async steerWorker(taskId:string, text:string): Promise<void> {
    this.#assertActiveLease(taskId);
    if (!this.#workerRunning || !this.#workerSession?.steer) throw new Error("The assignment is between turns. Try your message again in a moment.");
    await this.#workerSession.steer(text);
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
      assignmentId: this.#requiredTask(lease.taskId).assignmentId,
      resumeSessionPath: lease.workerSessionPath,
      ...(plan.cwd ? { cwd: plan.cwd } : {}),
    }, { assertActive: () => this.#assertWorkerPermission(lease.taskId) });
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
            "discovered",
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
    this.reconcileQueue();
  }

  #resolvePermission(assignmentId: string, courseId: string) {
    const assignment = this.#store.assignments.get(assignmentId);
    if (assignment?.owner === "student" || assignment?.ignoredReason) return {
      mode: "do_not_attempt" as const, mayAttempt: false, maySubmit: false, matchedRuleId: null,
      rationale: assignment.ignoredReason ? "You marked this assignment as done or not homework." : "You chose to do this assignment yourself.",
    };
    courseId = this.#store.school.resolveCourseId(courseId);
    const conflict = this.#store.assignmentConflicts.find(item => item.assignmentIds.includes(assignmentId))
      ?? this.#store.courseConflicts.find(item => item.courseIds.includes(courseId));
    if (conflict) return {
      mode: "do_not_attempt" as const, mayAttempt: false, maySubmit: false,
      matchedRuleId: null, rationale: conflict.reason,
    };
    const matchedPatternIds = this.#store.manager
      .listConfirmedPatterns(assignmentId, courseId)
      .filter(match => !AssignmentKindSchema.safeParse(match.patternId).success || (assignment?.kind === match.patternId && assignment.kindConfidence === "explicit" && assignment.kindEvidence))
      .map((match) => match.patternId);
    const rules = this.#store.permissionRules.listAll();
    const baseline = resolvePermission(
      { assignmentId, courseId, matchedPatternIds },
      rules,
    );
    // A guess can restrict work, never grant it. Unknown work must also respect
    // a potentially applicable kind restriction until the student clarifies it.
    const possibleKinds = assignment?.kindConfidence === "explicit" && assignment.kind ? [assignment.kind]
      : assignment?.possibleKinds?.length ? assignment.possibleKinds : AssignmentKindSchema.options;
    const rank = { do_not_attempt: 0, attempt: 1, auto_submit: 2 };
    return possibleKinds.reduce((safest, kind) => {
      const candidate = resolvePermission({ assignmentId, courseId, matchedPatternIds: [...new Set([...matchedPatternIds, kind])] }, rules);
      return rank[candidate.mode] < rank[safest.mode] ? { ...candidate, rationale: `This kind may apply; keeping its safer rule until the kind is confirmed. ${candidate.rationale}` } : safest;
    }, baseline);
  }

  resolvePermission(assignmentId: string, courseId: string) {
    this.#assertUsable();
    return this.#resolvePermission(assignmentId, courseId);
  }

  // Settings changes, new school evidence and startup use the same decision as
  // startNext. Withdraw unstarted work without calling it cancelled/completed.
  reconcileQueue(): void {
    for (const entry of this.#store.manager.listQueue()) {
      if (this.#store.tasks.get(entry.taskId)?.state === "queued") this.#refreshStartPermission(entry);
    }
    if (this.#schedulingEnabled && this.allowsAutomaticWork && this.#store.lifecycle.getSchedule()?.state !== "paused") {
      for (const task of this.#store.tasks.listByState("discovered")) {
        const assignment = this.#store.assignments.get(task.assignmentId);
        if (!assignment || !this.#resolvePermission(assignment.assignmentId, assignment.courseId).maySubmit || !assignmentWorkEligibility(assignment, this.#now()).eligible) continue;
        if (this.#plannedStart(assignment, this.#now())) this.enqueue({ taskId: task.taskId, requestOrigin: "automatic" });
      }
    }
  }

  setSchedulingEnabled(enabled: boolean): void {
    this.#schedulingEnabled = enabled;
    this.reconcileQueue();
  }

  #plannedStart(assignment: NonNullable<ReturnType<LocalStore["assignments"]["get"]>>, enqueuedAt: string): string | undefined {
    const schedule = this.#store.lifecycle.getSchedule();
    if (!this.#schedulingEnabled || !this.allowsAutomaticWork || schedule?.state === "paused") return undefined;
    if (!this.#resolvePermission(assignment.assignmentId, assignment.courseId).maySubmit) return undefined;
    return plannedAssignmentStart(assignment, enqueuedAt, schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  }

  setWorkStartMode(mode: "manual" | "automatic"): void {
    this.#workStartMode = mode;
    this.reconcileQueue();
  }

  get allowsAutomaticWork(): boolean { return this.#workStartMode === "automatic"; }

  #refreshStartPermission(entry: ManagerQueueEntry): ManagerQueueEntry | null {
    const permission = this.#resolvePermission(entry.assignmentId, entry.courseId);
    const assignment = this.#store.assignments.get(entry.assignmentId);
    const eligibility = assignment ? assignmentWorkEligibility(assignment, this.#now()) : { eligible: false, reason: "Assignment no longer exists." };
    const manual = entry.requestOrigin !== "student" && !this.allowsAutomaticWork;
    if (!permission.mayAttempt || !eligibility.eligible || manual) {
      this.#transition(
        entry.taskId,
        "discovered",
        manual ? "Inky starts homework only when you ask." : permission.mayAttempt ? eligibility.reason : "Stored permission no longer allows an attempt",
        `manager-${randomUUID()}`,
      );
      this.#store.manager.removeQueueEntry(entry.taskId);
      return null;
    }
    const next = { ...entry, permission, dueAt: assignment?.dueAt, scheduledStartAt: assignment ? this.#plannedStart(assignment, entry.enqueuedAt) : undefined };
    return JSON.stringify(next) === JSON.stringify(entry) ? entry : this.#store.manager.putQueueEntry(next);
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
      const sessionTarget = { ...target, assignmentId:entry.assignmentId, ...(plan.cwd ? { cwd: plan.cwd } : {}) };
      worker = plan.tools.length > 0
        ? await this.#requiredAssignmentRuntime().createAssignmentSession!(plan.tools, sessionTarget, { assertActive: () => this.#assertWorkerPermission(entry.taskId) })
        : await this.#runtime.createWorkerSession(target);
      if (!worker.sessionPath) {
        throw new Error("Pi did not persist the assignment worker session");
      }
      const currentEntry = this.#store.manager.getQueueEntry(entry.taskId);
      if (this.#requiredTask(entry.taskId).state !== "queued" || !currentEntry || !this.#refreshStartPermission(currentEntry)) {
        throw new Error("The assignment is no longer eligible to start.");
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

  #assertWorkerPermission(taskId: string): void {
    this.#assertUsable();
    const task = this.#requiredTask(taskId);
    const lease = this.#store.manager.getLease();
    if (lease?.taskId !== taskId || lease.state !== "active" || !["working", "ready_review", "submitting"].includes(task.state)) {
      throw new Error("This assignment no longer owns the school page.");
    }
    const assignment = this.#store.assignments.get(task.assignmentId);
    if (!assignment || !this.#resolvePermission(assignment.assignmentId, assignment.courseId).mayAttempt) {
      throw new Error("Current homework rules no longer allow this work.");
    }
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
