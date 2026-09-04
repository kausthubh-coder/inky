import { createHash, randomUUID } from "node:crypto";

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  AssignmentExecutionSchema,
  LifecycleStateSchema,
  STUDI_SCHEMA_VERSION,
  type AssignmentExecution,
  type BrowserCheckpoint,
  type BrowserSnapshot,
  type BrowserWorkerLease,
  type LifecycleState,
  type NotificationIntent,
  type AgentRunEvent,
} from "../../shared/index.js";
import { retrieveNoteIndex, type NoteRetrievalContext } from "../../agent-system/retrieve.js";
import type { BrowserController } from "../browser/controller.js";
import { formatSnapshot } from "../browser/controller.js";
import { VisibleBrowserWork } from "../browser/work-ownership.js";
import type { ManagerCoordinator } from "../manager/coordinator.js";
import type { LocalStore } from "../storage/index.js";
import { HomeworkFiles } from "../files/homework-files.js";

export type ExecutionNotification = Omit<NotificationIntent, "schemaVersion" | "notificationId" | "createdAt">;
export type ExecutionNotificationSink = (intent: ExecutionNotification) => void | Promise<void>;
export type ConnectedAppToolProvider = () => Promise<readonly ToolDefinition[]>;

export class AssignmentExecutionCoordinator {
  readonly #store: LocalStore;
  readonly #manager: ManagerCoordinator;
  readonly #browser: BrowserController;
  readonly #browserWork: VisibleBrowserWork;
  readonly #notify: ExecutionNotificationSink;
  readonly #now: () => string;
  #reviewWindowMs: number;
  #handoffWindowMs: number;
  readonly #tools: ToolDefinition[];
  readonly #connectedAppTools: ConnectedAppToolProvider;
  readonly #activity = new Map<string, AgentRunEvent[]>();
  #disposed = false;

  private constructor(
    store: LocalStore,
    manager: ManagerCoordinator,
    browser: BrowserController,
    options: {
      readonly notify?: ExecutionNotificationSink;
      readonly now?: () => string;
      readonly reviewWindowMs?: number;
      readonly handoffWindowMs?: number;
      readonly browserWork?: VisibleBrowserWork;
      readonly connectedAppTools?: ConnectedAppToolProvider;
    },
  ) {
    this.#store = store;
    this.#manager = manager;
    this.#browser = browser;
    this.#browserWork = options.browserWork ?? new VisibleBrowserWork(store);
    this.#notify = options.notify ?? (() => undefined);
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#reviewWindowMs = options.reviewWindowMs ?? 15 * 60_000;
    this.#handoffWindowMs = options.handoffWindowMs ?? this.#reviewWindowMs;
    this.#tools = this.#createTools();
    this.#connectedAppTools = options.connectedAppTools ?? (async () => []);
  }

  static async create(
    store: LocalStore,
    manager: ManagerCoordinator,
    browser: BrowserController,
    options: {
      readonly notify?: ExecutionNotificationSink;
      readonly now?: () => string;
      readonly reviewWindowMs?: number;
      readonly handoffWindowMs?: number;
      readonly browserWork?: VisibleBrowserWork;
      readonly connectedAppTools?: ConnectedAppToolProvider;
    } = {},
  ): Promise<AssignmentExecutionCoordinator> {
    const coordinator = new AssignmentExecutionCoordinator(store, manager, browser, options);
    await coordinator.#recover();
    return coordinator;
  }

  state(windowVisible: boolean): LifecycleState {
    this.#assertUsable();
    const lease = this.#manager.state().lease;
    const execution = lease
      ? this.#store.lifecycle.getExecution(lease.taskId)
      : this.#store.lifecycle.latestExecution();
    return LifecycleStateSchema.parse({
      windowVisible,
      schedule: this.#store.lifecycle.getSchedule(),
      execution,
      attempts: execution ? this.#store.lifecycle.listAttempts(execution.taskId) : [],
      submissionReceipt: execution ? this.#store.lifecycle.getSubmissionReceipt(execution.taskId) : null,
      latestNotification: this.#store.lifecycle.latestNotification(),
      manager: this.#manager.state(),
    });
  }

  async startNext(): Promise<AssignmentExecution | null> {
    return this.#start(async () => this.#manager.startNext(await this.#assignmentTools()));
  }

  async start(taskId: string): Promise<AssignmentExecution> {
    const execution = await this.#start(async () => this.#manager.startTask(taskId, await this.#assignmentTools()));
    if (!execution) throw new Error(`Task ${taskId} could not be started`);
    return execution;
  }

  async #start(acquireLease: () => Promise<BrowserWorkerLease | null>): Promise<AssignmentExecution | null> {
    return this.#browserWork.startAssignment(async () => {
      this.#assertUsable();
      if (this.#activeExecution()) throw new Error("An assignment execution is already active");
      const lease = await acquireLease();
      if (!lease) return null;
      const task = this.#requiredTask(lease.taskId);
      const assignment = this.#requiredAssignment(task.assignmentId);
      const execution = this.#store.lifecycle.putExecution({
        schemaVersion: STUDI_SCHEMA_VERSION,
        taskId: task.taskId,
        assignmentId: assignment.assignmentId,
        phase: "working",
        taskBudget: { maxAgentTurns: 24, maxRecoveryAttempts: 2 },
        turnCount: 0,
        attemptCount: 0,
        workerSessionPath: lease.workerSessionPath,
        updatedAt: this.#now(),
      });
      await this.#run(execution, "Begin the assignment from the current visible page.");
      return this.#store.lifecycle.getExecution(execution.taskId);
    });
  }

  async resume(taskId: string): Promise<AssignmentExecution> {
    return this.#browserWork.resumeAssignment(taskId, async () => {
      this.#assertUsable();
      const execution = this.#requiredExecution(taskId);
      if (execution.phase !== "needs_user") throw new Error(`Task ${taskId} is not waiting for the student`);
      this.#manager.resumePaused(taskId, "Student returned after the requested handoff");
      const working = this.#store.lifecycle.putExecution({
        ...execution,
        phase: "working",
        lastError: undefined,
        updatedAt: this.#now(),
      });
      await this.#run(working, `The student returned. Verify this predicate before continuing: ${execution.returnPredicate ?? "the blocking page state has cleared"}.`);
      return this.#requiredExecution(taskId);
    });
  }

  configureReviewHandoff(reviewMinutes: number, handoffMinutes: number): void {
    if (!Number.isInteger(reviewMinutes) || reviewMinutes < 1 || reviewMinutes > 120) {
      throw new TypeError("Review window must be between 1 and 120 minutes");
    }
    if (!Number.isInteger(handoffMinutes) || handoffMinutes < 1 || handoffMinutes > 240) {
      throw new TypeError("Review handoff must be between 1 and 240 minutes");
    }
    this.#reviewWindowMs = reviewMinutes * 60_000;
    this.#handoffWindowMs = handoffMinutes * 60_000;
  }

  activity(taskId: string): readonly AgentRunEvent[] {
    return this.#activity.get(taskId) ?? [];
  }

  async requestTakeover(taskId: string): Promise<AssignmentExecution> {
    this.#assertUsable();
    const execution = this.#requiredExecution(taskId);
    if (execution.phase !== "working") throw new Error(`Task ${taskId} is not actively working`);
    await this.#manager.pauseForStudent(taskId, "Student took over the visible browser");
    const waiting = this.#store.lifecycle.putExecution({
      ...execution,
      phase: "needs_user",
      returnPredicate: "The student finished the visible browser action and explicitly asked Studi to resume.",
      updatedAt: this.#now(),
    });
    await this.#notify({ kind: "handoff", target: { type: "task", id: taskId }, title: "The browser is yours", body: "Finish the visible action, then resume Studi from the desk." });
    return waiting;
  }

  cancel(taskId: string): AssignmentExecution {
    this.#assertUsable();
    const execution = this.#requiredExecution(taskId);
    if (!["working", "needs_user", "ready_review"].includes(execution.phase)) throw new Error(`Task ${taskId} cannot be cancelled from ${execution.phase}`);
    this.#manager.cancel(taskId);
    return this.#store.lifecycle.putExecution({
      ...execution,
      phase: "failed",
      lastError: "Cancelled by the student from Studi's desk.",
      updatedAt: this.#now(),
    });
  }

  async verifyStudentSubmission(taskId: string, confirmationText: string): Promise<AssignmentExecution> {
    this.#assertUsable();
    const execution = this.#requiredExecution(taskId);
    if (execution.phase !== "ready_review" || !execution.reviewCheckpoint) {
      throw new Error(`Task ${taskId} is not waiting for submission review`);
    }
    const post = await this.#browser.snapshot();
    const status = confirmationText.replace(/\s+/g, " ").trim();
    if (!status || !post.text.toLowerCase().includes(status.toLowerCase())) {
      throw new Error("The visible page does not contain the claimed submission confirmation");
    }
    const receiptId = `receipt-${randomUUID()}`;
    this.#store.lifecycle.putSubmissionReceipt({
      schemaVersion: STUDI_SCHEMA_VERSION,
      receiptId,
      taskId,
      preSubmit: execution.reviewCheckpoint,
      postSubmit: this.#checkpoint(post, `Verified visible submission status: ${status}`),
      verifiedStatus: status,
      submittedAt: this.#now(),
    });
    const submitted = this.#store.lifecycle.putExecution({
      ...execution,
      phase: "submitted",
      submissionReceiptId: receiptId,
      updatedAt: this.#now(),
    });
    this.#manager.completeActive(taskId, "submitted", "Student submission was verified from the visible page");
    return submitted;
  }

  async continueTurn(
    taskId: string,
    prompt: string,
    observe?: (event: AgentRunEvent) => void,
  ): Promise<{ readonly outcome: "completed" | "failed" | "aborted"; readonly text: string }> {
    this.#assertUsable();
    let execution = this.#requiredExecution(taskId);
    if (execution.phase === "needs_user") {
      this.#manager.resumePaused(taskId, "Student replied to the assignment handoff");
      execution = this.#store.lifecycle.putExecution({
        ...execution,
        phase: "working",
        lastError: undefined,
        updatedAt: this.#now(),
      });
    }
    if (execution.phase !== "working") throw new Error(`Task ${taskId} cannot take another work turn from ${execution.phase}`);
    if (execution.turnCount >= execution.taskBudget.maxAgentTurns) {
      throw new Error(`Task ${taskId} reached its ${execution.taskBudget.maxAgentTurns}-turn safety limit`);
    }
    this.#store.lifecycle.putExecution({ ...execution, turnCount: execution.turnCount + 1, updatedAt: this.#now() });
    return this.#manager.runWorkerTurn(prompt, observe);
  }

  async reconcileDeadlines(): Promise<void> {
    this.#assertUsable();
    for (const execution of this.#store.lifecycle.listExpiredReviewHandoffs(this.#now())) {
      await this.#preserve(execution);
    }
  }

  dispose(): void {
    this.#disposed = true;
  }

  async #run(execution: AssignmentExecution, instruction: string): Promise<void> {
    const assignment = this.#requiredAssignment(execution.assignmentId);
    const permission = this.#manager.resolvePermission(assignment.assignmentId, assignment.courseId);
    const snapshot = await this.#browser.snapshot();
    const noteEntries = retrieveNoteIndex(this.#store.notes.list(), this.#noteContext(assignment.assignmentId, assignment.courseId), "automatic");
    const notes = await Promise.all(noteEntries.map(async (entry) => ({ entry, content: (await this.#store.notes.read(entry.noteId))?.content ?? null })));
    const receipt = this.#store.lifecycle.getSubmissionReceipt(execution.taskId);
    const homeworkFiles = await this.#homeworkFiles();
    const folderListing = homeworkFiles ? await homeworkFiles.list() : [];
    const prompt = [
      "# Assignment",
      JSON.stringify({ taskId: execution.taskId, title: assignment.title, sourceTarget: assignment.sourceTarget, dueAt: assignment.dueAt ?? null }, null, 2),
      "# Fresh stored permission",
      JSON.stringify(permission, null, 2),
      "# Task budget",
      `Up to ${execution.taskBudget.maxAgentTurns} student-directed turns; ${execution.turnCount} already used. At most two meaningfully different recovery plans.`,
      "# Relevant notes",
      notes.length ? JSON.stringify(notes, null, 2) : "No relevant notes are stored.",
      "# Last submission receipt",
      receipt ? JSON.stringify(receipt, null, 2) : "No submission receipt exists for this task.",
      "# Homework folder",
      homeworkFiles
        ? JSON.stringify({ available: true, entries: folderListing.map(({ path, kind, size, modifiedAt }) => ({ path, kind, size, modifiedAt })) }, null, 2)
        : "No homework folder is selected. File tools and shell are unavailable.",
      "# Visible browser snapshot",
      formatSnapshot(snapshot),
      "# Instruction",
      instruction,
    ].join("\n\n");
    try {
      const result = await this.continueTurn(execution.taskId, prompt, (event) => this.#recordActivity(execution.taskId, event));
      const current = this.#store.lifecycle.getExecution(execution.taskId);
      if (current?.phase === "working") {
        await this.#handoff(current, result.outcome === "completed"
          ? "The assignment worker ended without recording a verified outcome."
          : `The assignment worker ${result.outcome} before recording a verified outcome.`,
        "The student has inspected the visible page and asked Studi to continue.");
      }
    } catch (error) {
      const current = this.#store.lifecycle.getExecution(execution.taskId);
      if (current?.phase === "working") {
        await this.#handoff(current, `The assignment worker stopped: ${errorMessage(error)}`, "The student has resolved the visible browser problem.");
      }
    }
  }

  #recordActivity(taskId: string, event: AgentRunEvent): void {
    const activity = this.#activity.get(taskId) ?? [];
    activity.push(event);
    if (activity.length > 160) activity.splice(0, activity.length - 160);
    this.#activity.set(taskId, activity);
  }

  #createTools(): ToolDefinition[] {
    const recordAnswer = defineTool({
      name: "assignment_record_answer_snapshot",
      label: "Record assignment answers",
      description: "Persist a concise answer snapshot without claiming review or submission.",
      parameters: Type.Object({ answers: Type.String({ minLength: 1, maxLength: 20_000 }) }, { additionalProperties: false }),
      execute: async (_id, input) => {
        const execution = this.#requiredWorkingExecution();
        return toolResult(this.#store.lifecycle.putExecution({ ...execution, answerSnapshot: input.answers.trim(), updatedAt: this.#now() }));
      },
    });
    const recovery = defineTool({
      name: "assignment_record_recovery",
      label: "Record browser recovery",
      description: "Record one meaningfully different browser recovery plan and its result. The second failed plan pauses for the student.",
      parameters: Type.Object({
        plan: Type.String({ minLength: 1, maxLength: 1_000 }),
        result: Type.String({ minLength: 1, maxLength: 1_000 }),
      }, { additionalProperties: false }),
      execute: async (_id, input) => {
        const execution = this.#requiredWorkingExecution();
        const snapshot = await this.#browser.snapshot();
        const ordinal = this.#store.lifecycle.listAttempts(execution.taskId).length + 1;
        const attempt = this.#store.lifecycle.addAttempt({
          schemaVersion: STUDI_SCHEMA_VERSION,
          taskId: execution.taskId,
          ordinal,
          plan: input.plan.trim(),
          result: input.result.trim(),
          evidence: this.#checkpoint(snapshot, `Recovery ${ordinal}: ${input.result.trim()}`),
          recordedAt: this.#now(),
        });
        this.#store.lifecycle.putExecution({ ...execution, attemptCount: ordinal, updatedAt: this.#now() });
        if (ordinal === 2) {
          await this.#handoff(this.#requiredExecution(execution.taskId), "Two different browser recovery plans failed.", "The student has resolved the browser failure and asked Studi to continue.");
        }
        return toolResult(attempt);
      },
    });
    const takeover = defineTool({
      name: "assignment_request_takeover",
      label: "Request student takeover",
      description: "Pause for login, CAPTCHA, or another action only the student can safely complete.",
      parameters: Type.Object({
        reason: Type.String({ minLength: 1, maxLength: 1_000 }),
        returnPredicate: Type.String({ minLength: 1, maxLength: 1_000 }),
      }, { additionalProperties: false }),
      execute: async (_id, input) => toolResult(await this.#handoff(this.#requiredWorkingExecution(), input.reason, input.returnPredicate)),
    });
    const unsupported = defineTool({
      name: "assignment_mark_unsupported",
      label: "Mark unsupported assignment",
      description: "Truthfully stop physical, CAD, Blender, or other unsupported work.",
      parameters: Type.Object({ reason: Type.String({ minLength: 1, maxLength: 1_000 }) }, { additionalProperties: false }),
      execute: async (_id, input) => {
        const execution = this.#requiredWorkingExecution();
        const failed = this.#store.lifecycle.putExecution({ ...execution, phase: "failed", lastError: input.reason.trim(), updatedAt: this.#now() });
        this.#manager.completeActive(execution.taskId, "failed", input.reason.trim());
        await this.#notify({ kind: "failure", target: { type: "task", id: execution.taskId }, title: "Assignment needs another approach", body: input.reason.trim() });
        return toolResult(failed);
      },
    });
    const review = defineTool({
      name: "assignment_start_review",
      label: "Start assignment review",
      description: "Verify completed page state, retain answers in the page, and start the student's review deadline without submitting.",
      parameters: Type.Object({
        answers: Type.Optional(Type.String({ minLength: 1, maxLength: 20_000 })),
        summary: Type.String({ minLength: 1, maxLength: 1_000 }),
      }, { additionalProperties: false }),
      execute: async (_id, input) => {
        const execution = this.#requiredWorkingExecution();
        const answers = input.answers?.trim() ?? execution.answerSnapshot;
        if (!answers) throw new Error("Review cannot start without a concise answer snapshot");
        const snapshot = await this.#browser.snapshot();
        const startedAt = Date.parse(this.#now());
        const handoffDeadline = new Date(startedAt + this.#handoffWindowMs).toISOString();
        const reviewDeadline = new Date(Math.min(startedAt + this.#reviewWindowMs, Date.parse(handoffDeadline))).toISOString();
        const ready = this.#store.lifecycle.putExecution({
          ...execution,
          phase: "ready_review",
          answerSnapshot: answers,
          reviewDeadline,
          handoffDeadline,
          reviewCheckpoint: this.#checkpoint(snapshot, input.summary.trim()),
          updatedAt: this.#now(),
        });
        this.#manager.pause(execution.taskId, "ready_review", "Completed page state verified; waiting for student review");
        await this.#notify({ kind: "review_ready", target: { type: "task", id: execution.taskId }, title: "Assignment ready to review", body: `Answers remain in the school page until ${handoffDeadline}.` });
        return toolResult(ready);
      },
    });
    const noteUpsert = defineTool({
      name: "note_upsert",
      label: "Save a scoped assignment note",
      description: "After review evidence exists, save one bounded course, confirmed-pattern, or assignment note. Notes never alter permission or count as evidence.",
      parameters: Type.Object({
        scope: Type.Union([Type.Literal("course"), Type.Literal("pattern"), Type.Literal("assignment")]),
        patternId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
        about: Type.Union([Type.Literal("how-to"), Type.Literal("knowledge"), Type.Literal("work")]),
        key: Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
        title: Type.String({ minLength: 1, maxLength: 200 }),
        content: Type.String({ minLength: 1, maxLength: 100_000 }),
      }, { additionalProperties: false }),
      execute: async (_id, input) => {
        const execution = this.#activeExecution();
        if (!execution || execution.phase !== "ready_review" || !execution.reviewCheckpoint) {
          throw new Error("A note can be saved only after current browser evidence starts review");
        }
        const assignment = this.#requiredAssignment(execution.assignmentId);
        let subjectId = assignment.assignmentId;
        if (input.scope === "course") subjectId = assignment.courseId;
        if (input.scope === "pattern") {
          if (!input.patternId) throw new Error("A confirmed pattern id is required for a pattern note");
          const confirmed = this.#store.manager.listConfirmedPatterns(assignment.assignmentId, assignment.courseId).some((match) => match.patternId === input.patternId);
          if (!confirmed) throw new Error(`Pattern ${input.patternId} is not confirmed for this assignment`);
          subjectId = input.patternId;
        }
        const note = await this.#store.notes.upsert({
          scope: input.scope,
          subjectId,
          about: input.about,
          key: input.key,
          title: input.title,
          content: input.content,
          updatedAt: this.#now(),
        });
        return toolResult(note);
      },
    });
    const submit = defineTool({
      name: "browser_submit",
      label: "Submit school work",
      description: "Re-resolve stored permission, capture pre-submit evidence, activate one submission control, and require fresh visible confirmation.",
      parameters: Type.Object({
        ref: Type.String({ minLength: 1, maxLength: 64 }),
        confirmation: Type.Literal("SUBMIT"),
        expectedConfirmationText: Type.String({ minLength: 1, maxLength: 500 }),
      }, { additionalProperties: false }),
      execute: async (_id, input) => toolResult(await this.#submit(input.ref, input.expectedConfirmationText)),
    });
    return [recordAnswer, recovery, takeover, unsupported, review, noteUpsert, submit];
  }

  async #submit(ref: string, expectedConfirmationText: string): Promise<AssignmentExecution> {
    const execution = this.#requiredWorkingExecution();
    if (execution.submissionAttemptedAt) {
      throw new Error("A submission effect was already attempted for this execution; verify the visible page instead of repeating it");
    }
    const assignment = this.#requiredAssignment(execution.assignmentId);
    const permission = this.#manager.resolvePermission(assignment.assignmentId, assignment.courseId);
    if (!permission.maySubmit) throw new Error("Fresh stored assignment permission does not allow submission");
    const refreshed = await this.#browser.refreshRef(ref);
    const preSnapshot = refreshed.snapshot;
    const pre = this.#checkpoint(preSnapshot, "Fresh page state immediately before the gated submission effect.");
    const status = expectedConfirmationText.replace(/\s+/g, " ").trim();
    if (preSnapshot.text.toLowerCase().includes(status.toLowerCase())) {
      return this.#submissionHandoff(execution, "The claimed submission confirmation was already visible before the submit control was used.", "Submission needs verification");
    }
    const submitting = this.#store.lifecycle.putExecution({ ...execution, phase: "submitting", submissionAttemptedAt: this.#now(), updatedAt: this.#now() });
    this.#manager.beginSubmission(execution.taskId);
    let postSnapshot: BrowserSnapshot;
    try {
      postSnapshot = await this.#browser.click(refreshed.ref, true);
    } catch (error) {
      return this.#submissionHandoff(submitting, `Submission effect was ambiguous: ${errorMessage(error)}`, "Check the submission");
    }
    if (!postSnapshot.text.toLowerCase().includes(status.toLowerCase())) {
      return this.#submissionHandoff(submitting, "The submit control changed the page, but no new expected confirmation was visible.", "Submission needs verification");
    }
    const receiptId = `receipt-${randomUUID()}`;
    this.#store.lifecycle.putSubmissionReceipt({
      schemaVersion: STUDI_SCHEMA_VERSION,
      receiptId,
      taskId: execution.taskId,
      preSubmit: pre,
      postSubmit: this.#checkpoint(postSnapshot, `Verified visible submission status: ${status}`),
      verifiedStatus: status,
      submittedAt: this.#now(),
    });
    const submitted = this.#store.lifecycle.putExecution({ ...submitting, phase: "submitted", submissionReceiptId: receiptId, updatedAt: this.#now() });
    this.#manager.completeActive(execution.taskId, "submitted", `Verified submission status: ${status}`);
    return submitted;
  }

  async #submissionHandoff(execution: AssignmentExecution, reason: string, title: string): Promise<AssignmentExecution> {
    const needsUser = this.#store.lifecycle.putExecution({ ...execution, phase: "needs_user", lastError: reason, updatedAt: this.#now() });
    this.#manager.pause(execution.taskId, "needs_user", reason);
    await this.#notify({ kind: "handoff", target: { type: "task", id: execution.taskId }, title, body: reason });
    return needsUser;
  }

  async #handoff(execution: AssignmentExecution, reason: string, returnPredicate: string): Promise<AssignmentExecution> {
    const snapshot = await this.#browser.snapshot();
    const needsUser = this.#store.lifecycle.putExecution({
      ...execution,
      phase: "needs_user",
      returnPredicate: returnPredicate.trim(),
      lastError: reason.trim(),
      reviewCheckpoint: this.#checkpoint(snapshot, `Student handoff requested: ${reason.trim()}`),
      updatedAt: this.#now(),
    });
    this.#manager.pause(execution.taskId, "needs_user", reason.trim());
    await this.#notify({ kind: "handoff", target: { type: "task", id: execution.taskId }, title: "Studi needs you in the browser", body: reason.trim() });
    return needsUser;
  }

  async #preserve(execution: AssignmentExecution): Promise<void> {
    if (execution.phase !== "ready_review" || !execution.answerSnapshot) return;
    const artifactId = await this.#writeAnswerArtifact(execution, "Saved after the submission-review handoff expired.");
    this.#store.lifecycle.putExecution({ ...execution, phase: "preserved", answerArtifactId: artifactId, reviewDeadline: undefined, handoffDeadline: undefined, updatedAt: this.#now() });
    this.#manager.completeActive(execution.taskId, "preserved", "Answer Markdown was saved before the review lease was released");
  }

  async #writeAnswerArtifact(execution: AssignmentExecution, reason: string): Promise<string> {
    if (!execution.answerSnapshot) throw new Error("An answer snapshot is required before answers can be preserved");
    const assignment = this.#requiredAssignment(execution.assignmentId);
    const artifactId = `answer-${createHash("sha256").update(execution.taskId).digest("hex").slice(0, 24)}`;
    await this.#store.artifacts.write({
      frontmatter: { schemaVersion: STUDI_SCHEMA_VERSION, kind: "answer", artifactId, updatedAt: this.#now() },
      content: `# ${assignment.title}\n\nSource: ${assignment.sourceTarget}\n\n${reason}\n\n## Answers\n\n${execution.answerSnapshot.trim()}\n`,
    });
    return artifactId;
  }

  async #recover(): Promise<void> {
    const lease = this.#manager.state().lease;
    if (!lease || lease.state !== "active") {
      await this.reconcileDeadlines();
      return;
    }
    const execution = this.#store.lifecycle.getExecution(lease.taskId);
    if (!execution) return;
    if (execution.phase === "submitted" || execution.phase === "preserved" || execution.phase === "failed") {
      this.#manager.completeActive(execution.taskId, execution.phase, "Recovered durable terminal execution state");
      return;
    }
    await this.#manager.restoreAssignmentWorker(await this.#assignmentTools());
    if (execution.phase === "ready_review") {
      const releaseAt = execution.handoffDeadline ?? execution.reviewDeadline;
      if (releaseAt && releaseAt <= this.#now()) {
        await this.reconcileDeadlines();
        return;
      }
      const reason = "Studi restarted before review finished. The browser page could not be retained, so the answers were saved locally for the student to restore.";
      const artifactId = await this.#writeAnswerArtifact(execution, "Saved because Studi restarted before the review page could be retained.");
      this.#store.lifecycle.putExecution({
        ...execution,
        phase: "needs_user",
        reviewDeadline: undefined,
        handoffDeadline: undefined,
        answerArtifactId: artifactId,
        lastError: reason,
        returnPredicate: "The student has reopened the assignment, restored the saved answers, and asked Studi to continue.",
        updatedAt: this.#now(),
      });
      this.#manager.pause(execution.taskId, "needs_user", reason);
      await this.#notify({ kind: "handoff", target: { type: "task", id: execution.taskId }, title: "Restore saved answers", body: reason });
      return;
    }
    if (execution.phase === "working" || execution.phase === "submitting") {
      const reason = execution.phase === "submitting"
        ? "Studi restarted after a submission effect began; the result requires student verification and will not be repeated."
        : "Studi restarted during assignment work. Inspect the visible browser before asking Studi to resume.";
      this.#store.lifecycle.putExecution({ ...execution, phase: "needs_user", lastError: reason, returnPredicate: "The student has inspected the visible browser and asked Studi to resume.", updatedAt: this.#now() });
      this.#manager.pause(execution.taskId, "needs_user", reason);
      await this.#notify({ kind: "handoff", target: { type: "task", id: execution.taskId }, title: "Assignment paused after restart", body: reason });
    }
    await this.reconcileDeadlines();
  }

  #activeExecution(): AssignmentExecution | null {
    const lease = this.#manager.state().lease;
    return lease ? this.#store.lifecycle.getExecution(lease.taskId) : this.#store.lifecycle.getActiveExecution();
  }

  async #assignmentTools(): Promise<readonly ToolDefinition[]> {
    const homeworkFiles = await this.#homeworkFiles();
    const files = homeworkFiles ? this.#createFileTools(homeworkFiles) : [];
    let connected: readonly ToolDefinition[] = [];
    try { connected = await this.#connectedAppTools(); } catch { /* Connected apps cannot disable local tools. */ }
    return [...this.#tools, ...files, ...connected];
  }

  async #homeworkFiles(): Promise<HomeworkFiles | null> {
    try {
      const preferences = await this.#store.productPreferences.get();
      return preferences.homeworkRoot ? await HomeworkFiles.open(preferences.homeworkRoot) : null;
    } catch {
      return null;
    }
  }

  #createFileTools(files: HomeworkFiles): ToolDefinition[] {
    const list = defineTool({
      name: "file_list",
      label: "List homework files",
      description: "List bounded file metadata below the student-selected homework folder. Symlinks and escapes are rejected.",
      parameters: Type.Object({ path: Type.Optional(Type.String({ minLength: 1, maxLength: 1_024 })) }, { additionalProperties: false }),
      execute: async (_id, input) => {
        this.#requiredWorkingExecution();
        return toolResult(await files.list(input.path ?? "."));
      },
    });
    const read = defineTool({
      name: "file_read",
      label: "Read homework file",
      description: "Read one bounded UTF-8 text file below the selected homework folder.",
      parameters: Type.Object({ path: Type.String({ minLength: 1, maxLength: 1_024 }) }, { additionalProperties: false }),
      execute: async (_id, input) => {
        this.#requiredWorkingExecution();
        return toolResult(await files.read(input.path));
      },
    });
    const write = defineTool({
      name: "file_write",
      label: "Write homework file",
      description: "Atomically write one bounded UTF-8 file below the selected homework folder. Absolute paths, traversal, and symlinks fail closed.",
      parameters: Type.Object({
        path: Type.String({ minLength: 1, maxLength: 1_024 }),
        content: Type.String({ maxLength: 1_000_000 }),
      }, { additionalProperties: false }),
      execute: async (_id, input) => {
        this.#requiredWorkingExecution();
        return toolResult(await files.write(input.path, input.content));
      },
    });
    return [list, read, write];
  }

  #requiredWorkingExecution(): AssignmentExecution {
    const execution = this.#activeExecution();
    if (!execution || execution.phase !== "working") throw new Error("No working assignment execution owns the browser");
    return execution;
  }

  #requiredExecution(taskId: string): AssignmentExecution {
    const execution = this.#store.lifecycle.getExecution(taskId);
    if (!execution) throw new Error(`Assignment execution ${taskId} does not exist`);
    return AssignmentExecutionSchema.parse(execution);
  }

  #requiredTask(taskId: string) {
    const task = this.#store.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} does not exist`);
    return task;
  }

  #requiredAssignment(assignmentId: string) {
    const assignment = this.#store.assignments.get(assignmentId);
    if (!assignment) throw new Error(`Assignment ${assignmentId} does not exist`);
    return assignment;
  }

  #noteContext(assignmentId: string, courseId: string): NoteRetrievalContext {
    return {
      kind: "assignment",
      assignmentId,
      courseId,
      confirmedPatternIds: this.#store.manager.listConfirmedPatterns(assignmentId, courseId).map((match) => match.patternId),
      courseAssignmentIds: this.#store.assignments.listByCourse(courseId).map((assignment) => assignment.assignmentId),
    };
  }

  #checkpoint(snapshot: BrowserSnapshot, summary: string): BrowserCheckpoint {
    return {
      revision: snapshot.revision,
      url: snapshot.url,
      title: snapshot.title,
      capturedAt: this.#now(),
      summary: summary.slice(0, 2_000),
    };
  }

  #assertUsable(): void {
    if (this.#disposed) throw new Error("Assignment execution coordinator is disposed");
  }
}

function toolResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], details: value };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
