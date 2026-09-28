import { createHash, randomUUID } from "node:crypto";
import { commandOutput, commandSummary } from "./command-output.js";

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  AssignmentExecutionSchema,
  isLivePhase,
  OpaqueIdSchema,
  LifecycleStateSchema,
  STUDI_SCHEMA_VERSION,
  readSubmissionConfirmation,
  type AssignmentExecution,
  type BrowserCheckpoint,
  type BrowserSnapshot,
  type BrowserWorkerLease,
  type LifecycleState,
  type NotificationIntent,
  type AgentRunEvent,
} from "../../shared/index.js";
import { noteIsAllowed, retrieveNoteIndex, searchNotes, type NoteRetrievalContext } from "../../agent-system/retrieve.js";
import type { BrowserController } from "../browser/controller.js";
import { VisibleBrowserWork } from "../browser/work-ownership.js";
import type { AssignmentSessionPlan, ManagerCoordinator, WorkerTurnResult } from "../manager/coordinator.js";
import type { LocalStore } from "../storage/index.js";
import { HomeworkFiles } from "../files/homework-files.js";
import { createWorkspaceCodingTools } from "../files/workspace-tools.js";
import { openAssignmentWorkspace } from "../files/workspace.js";
import { createBrowserUploadTool } from "../browser/tools.js";
import { createBrowserDownloadTool } from "../browser/downloads.js";
import { createPdfReadTool } from "../files/pdf-tool.js";

const HAND_IN_ACTION = /(?:^|_)(?:SUBMIT|TURN_IN|TURNIN|PUSH|COMMIT|CREATE_(?:A_)?PULL_REQUEST|MERGE|SEND|SHARE|PUBLISH|POST|REPLY|INVITE)(?:_|$)/;
const MAX_NUDGES = 3;
const RUN_ENDS = new Set<AssignmentExecution["phase"]>(["needs_user", "ready_review", "submitted", "preserved", "failed"]);
const RUN_ENDING: Partial<Record<AssignmentExecution["phase"], string>> = {
  needs_user: "waiting for the student", ready_review: "ready for the student to check", submitted: "handed in",
  preserved: "stopped, answers saved", failed: "stopped without finishing",
};
const RULE_STOPPED = "Your rule changed, so Dot stopped. Your work so far is saved; change the rule to let Dot carry on.";

/** The class's saved materials (syllabus, notes, handouts) for the start of each run. */
export type ClassMaterials = (courseId: string) => readonly { title: string; sourceTarget: string | null; text: string }[];

export type ExecutionNotification = Omit<NotificationIntent, "schemaVersion" | "notificationId" | "createdAt">;
export type ExecutionNotificationSink = (intent: ExecutionNotification) => void | Promise<void>;
export type ConnectedAppToolProvider = () => Promise<readonly ToolDefinition[]>;

export function submissionConfirmationVisible(pageText: string, expectedText: string): boolean {
  const expected = expectedText.replace(/\s+/g, " ").trim().toLowerCase();
  const visible = pageText.replace(/\s+/g, " ").toLowerCase();
  if (expected === "submitted") {
    return /\bsubmitted\b/.test(visible.replace(/\b(?:not|un)\s*submitted\b/g, ""));
  }
  return visible.includes(expected);
}

export class AssignmentExecutionCoordinator {
  readonly #store: LocalStore;
  readonly #manager: ManagerCoordinator;
  readonly #defaultBrowser: BrowserController;
  readonly #browserForAssignment: ((id:string) => BrowserController) | undefined;
  get #browser(): BrowserController {
    const execution = this.#activeExecution();
    return execution && this.#browserForAssignment ? this.#browserForAssignment(execution.assignmentId) : this.#defaultBrowser;
  }
  readonly #browserWork: VisibleBrowserWork;
  readonly #notify: ExecutionNotificationSink;
  readonly #now: () => string;
  readonly #ownerSubject: string | undefined;
  #reviewWindowMs: number;
  #handoffWindowMs: number;
  readonly #tools: ToolDefinition[];
  readonly #connectedAppTools: ConnectedAppToolProvider;
  #disposed = false;
  readonly #stopRunNotes: () => void;
  readonly #classMaterials: ClassMaterials;
  /** Work that was running when Studi quit; carryOnAfterRestart picks it back up. */
  #restarted: string | null = null;
  #handInWatch: ReturnType<typeof setTimeout> | null = null;
  #signInWatch: ReturnType<typeof setTimeout> | null = null;
  readonly #signInCheckMs: number;
  /** One notification per school sign-out: set when Dot asks for a sign-in, cleared when the student is back. */
  #signInAsked = false;

  private constructor(
    store: LocalStore,
    manager: ManagerCoordinator,
    browser: BrowserController,
    options: {
      readonly ownerSubject?: string;
      readonly notify?: ExecutionNotificationSink;
      readonly now?: () => string;
      readonly reviewWindowMs?: number;
      readonly handoffWindowMs?: number;
      readonly browserWork?: VisibleBrowserWork;
      readonly browserForAssignment?: (id:string) => BrowserController;
      readonly connectedAppTools?: ConnectedAppToolProvider;
      readonly classMaterials?: ClassMaterials;
      readonly signInCheckMs?: number;
    },
  ) {
    this.#store = store;
    this.#manager = manager;
    this.#defaultBrowser = browser;
    this.#browserForAssignment = options.browserForAssignment;
    this.#browserWork = options.browserWork ?? new VisibleBrowserWork(store);
    this.#notify = options.notify ?? (() => undefined);
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#ownerSubject = options.ownerSubject === undefined ? undefined : OpaqueIdSchema.parse(options.ownerSubject);
    this.#reviewWindowMs = options.reviewWindowMs ?? 15 * 60_000;
    this.#handoffWindowMs = options.handoffWindowMs ?? this.#reviewWindowMs;
    this.#tools = this.#createTools();
    this.#connectedAppTools = options.connectedAppTools ?? (async () => []);
    this.#classMaterials = options.classMaterials ?? (() => []);
    this.#signInCheckMs = options.signInCheckMs ?? 10_000;
    this.#stopRunNotes = store.lifecycle.onExecutionChange((previous, next) => {
      if (previous?.phase !== next.phase && RUN_ENDS.has(next.phase)) void this.#writeRunNote(next).catch(() => undefined);
    });
  }

  static async create(
    store: LocalStore,
    manager: ManagerCoordinator,
    browser: BrowserController,
    options: {
      readonly ownerSubject?: string;
      readonly notify?: ExecutionNotificationSink;
      readonly now?: () => string;
      readonly reviewWindowMs?: number;
      readonly handoffWindowMs?: number;
      readonly browserWork?: VisibleBrowserWork;
      readonly browserForAssignment?: (id:string) => BrowserController;
      readonly connectedAppTools?: ConnectedAppToolProvider;
      readonly classMaterials?: ClassMaterials;
      readonly signInCheckMs?: number;
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
    return this.#start(async () => this.#manager.startNext((assignmentId) => this.#assignmentSessionPlan(assignmentId)));
  }

  async start(taskId: string): Promise<AssignmentExecution> {
    const previous = this.#store.lifecycle.getExecution(taskId);
    if (previous) this.#assertExecutionOwner(previous);
    const execution = await this.#start(async () => this.#manager.startTask(taskId, (assignmentId) => this.#assignmentSessionPlan(assignmentId)));
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
      const previous = this.#store.lifecycle.getExecution(task.taskId);
      if (previous) this.#assertExecutionOwner(previous);
      const execution = this.#store.lifecycle.putExecution({
        schemaVersion: STUDI_SCHEMA_VERSION,
        taskId: task.taskId,
        assignmentId: assignment.assignmentId,
        ownerSubject: previous ? previous.ownerSubject : this.#ownerSubject,
        phase: "working",
        startedAt: this.#now(),
        taskBudget: { maxAgentTurns: 24, maxRecoveryAttempts: 2 },
        turnCount: 0,
        attemptCount: 0,
        workerSessionPath: lease.workerSessionPath,
        updatedAt: this.#now(),
      });
      await this.#run(execution, "Begin the assignment. Start by reading the assignment page and everything it links to, then do the work.");
      return this.#store.lifecycle.getExecution(execution.taskId);
    });
  }

  async resume(taskId: string): Promise<AssignmentExecution> {
    const returnPredicate = this.#requiredExecution(taskId).returnPredicate;
    return this.#resumeWith(taskId, [
      "The student clicked 'I’m done — check' and explicitly asked you to resume this assignment now. Do not ask for permission to resume again.",
      `Inspect the current page to verify the remaining browser condition: ${returnPredicate ?? "the blocking page state has cleared"}.`,
      "Continue under the fresh stored assignment permission. If the answer is already complete, verify it and call assignment_start_review. Request another handoff only for a concrete unresolved blocker.",
    ].join("\n"));
  }

  /** After a restart, carry on with the work that was running, in the same session, if the rule still allows it. */
  async carryOnAfterRestart(): Promise<void> {
    const taskId = this.#restarted;
    this.#restarted = null;
    if (!taskId || this.#store.lifecycle.getExecution(taskId)?.phase !== "needs_user") return;
    await this.#resumeWith(taskId, "Studi restarted while you were working on this assignment, and the page was reloaded. Take a fresh snapshot, check what is already saved on the page and in the folder, and carry on from there. Do not redo finished steps.");
  }

  async #resumeWith(taskId: string, instruction: string): Promise<AssignmentExecution> {
    this.#assertUsable();
    this.#requiredExecution(taskId);
    return this.#browserWork.resumeAssignment(taskId, async () => {
      this.#assertUsable();
      const execution = this.#requiredExecution(taskId);
      if (execution.phase !== "needs_user") throw new Error(`Task ${taskId} is not waiting for the student`);
      if (execution.needs === "sign_in") this.#signInAsked = false;
      this.#manager.resumePaused(taskId, "Student returned after the requested handoff");
      const working = this.#store.lifecycle.putExecution({
        ...execution,
        phase: "working",
        lastError: undefined,
        turnCount: 0,
        attemptCount: 0,
        updatedAt: this.#now(),
      });
      await this.#run(working, instruction);
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
    return this.#store.lifecycle.getExecution(taskId)?.activity ?? [];
  }

  async requestTakeover(taskId: string): Promise<AssignmentExecution> {
    this.#assertUsable();
    const execution = this.#requiredExecution(taskId);
    if (!["working", "ready_review"].includes(execution.phase)) throw new Error(`Task ${taskId} cannot be edited from ${execution.phase}`);
    const waiting = this.#store.database.transaction(() => {
      // Stop new tools and timed submission before yielding to worker abort.
      this.#manager.pause(taskId, "needs_user", "Student took over the visible browser");
      return this.#store.lifecycle.putExecution({
      ...execution,
      phase: "needs_user",
      reviewDeadline: undefined,
      lastError: "The browser is yours. When you’re ready, ask me to continue.",
      returnPredicate: "The student finished the visible browser action and explicitly asked Studi to resume.",
      handoffDeadline: new Date(Date.parse(this.#now()) + this.#handoffWindowMs).toISOString(),
      updatedAt: this.#now(),
      });
    });
    await this.#manager.abortWorkerTurn();
    await this.#notify({ kind: "handoff", target: { type: "task", id: taskId }, title: "The browser is yours", body: "Finish the visible action, then resume Studi from the desk." });
    return waiting;
  }

  cancel(taskId: string): AssignmentExecution {
    this.#assertUsable();
    const execution = this.#requiredExecution(taskId);
    if (!["working", "needs_user", "ready_review"].includes(execution.phase)) throw new Error(`Task ${taskId} cannot be cancelled from ${execution.phase}`);
    this.#manager.cancel(taskId);
    return this.#requiredExecution(taskId);
  }

  /**
   * The student hands in on the school page themselves. Dot reads the page every few seconds
   * for the school's confirmation and saves the receipt, for up to 30 minutes.
   */
  watchHandIn(taskId: string, everyMs = 3_000, forMs = 30 * 60_000): void {
    this.#assertUsable();
    const execution = this.#requiredExecution(taskId);
    if (execution.phase !== "ready_review" || !execution.reviewCheckpoint) throw new Error(`Task ${taskId} is not waiting for submission review`);
    if (this.#handInWatch) clearTimeout(this.#handInWatch);
    const page = this.#browserForAssignment?.(execution.assignmentId) ?? this.#defaultBrowser;
    const until = Date.now() + forMs;
    const look = async () => {
      this.#handInWatch = null;
      const current = this.#store.lifecycle.getExecution(taskId);
      if (this.#disposed || current?.phase !== "ready_review" || !current.reviewCheckpoint || Date.now() > until) return;
      try {
        const post = await page.snapshot();
        const status = readSubmissionConfirmation(current.reviewCheckpoint.summary, post.text);
        if (status) {
          this.#recordStudentSubmission(taskId, status, post);
          return;
        }
      } catch {
        // The page may be mid-navigation after Submit; look again.
      }
      if (!this.#disposed) this.#handInWatch = setTimeout(() => void look(), everyMs);
    };
    this.#handInWatch = setTimeout(() => void look(), Math.min(everyMs, 1_000));
  }

  async verifyStudentSubmission(taskId: string, confirmationText: string): Promise<AssignmentExecution> {
    this.#assertUsable();
    const execution = this.#requiredExecution(taskId);
    if (execution.phase !== "ready_review" || !execution.reviewCheckpoint) {
      throw new Error(`Task ${taskId} is not waiting for submission review`);
    }
    const post = await this.#browser.snapshot();
    if (this.#requiredExecution(taskId).phase !== "ready_review") throw new Error("This assignment is no longer waiting for review.");
    const status = confirmationText.replace(/\s+/g, " ").trim();
    if (!status || !post.text.toLowerCase().includes(status.toLowerCase())) {
      throw new Error("The visible page does not contain the claimed submission confirmation");
    }
    return this.#recordStudentSubmission(taskId, status, post);
  }

  #recordStudentSubmission(taskId: string, status: string, post: BrowserSnapshot): AssignmentExecution {
    const execution = this.#requiredExecution(taskId);
    if (execution.phase !== "ready_review" || !execution.reviewCheckpoint) throw new Error("This assignment is no longer waiting for review.");
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
    const assignment = this.#requiredAssignment(execution.assignmentId);
    if (!this.#manager.resolvePermission(assignment.assignmentId, assignment.courseId).mayAttempt) throw new Error(RULE_STOPPED);
    if (execution.phase === "needs_user") {
      this.#manager.resumePaused(taskId, "Student replied to the assignment handoff");
      execution = this.#store.lifecycle.putExecution({
        ...execution,
        phase: "working",
        needs: undefined,
        lastError: undefined,
        updatedAt: this.#now(),
      });
    }
    if (execution.phase !== "working") throw new Error(`Task ${taskId} cannot take another work turn from ${execution.phase}`);
    if (execution.turnCount >= execution.taskBudget.maxAgentTurns) {
      throw new Error(`Task ${taskId} reached its ${execution.taskBudget.maxAgentTurns}-turn safety limit`);
    }
    this.#store.lifecycle.putExecution({ ...execution, turnCount: execution.turnCount + 1, updatedAt: this.#now() });
    return this.#manager.runWorkerTurn(prompt, event => { this.#recordActivity(taskId, event); observe?.(event); });
  }

  async reconcileDeadlines(): Promise<void> {
    this.#assertUsable();
    const current = this.#activeExecution();
    if (current && !this.#matchesExecutionOwner(current)) return;
    if (current?.phase === "ready_review" && current.reviewDeadline && current.reviewDeadline <= this.#now() &&
      !current.reviewSubmissionRequestedAt && !this.#manager.isWorkerRunning && this.#store.lifecycle.getSchedule()?.state !== "paused") {
      const assignment = this.#requiredAssignment(current.assignmentId);
      if (this.#manager.resolvePermission(assignment.assignmentId, assignment.courseId).maySubmit && !current.doubts?.length && !pastDueWithoutLateWindow(assignment, this.#now())) await this.submitByRule(current.taskId);
    }
    for (const execution of this.#store.lifecycle.listExpiredReviewHandoffs(this.#now())) {
      if (this.#matchesExecutionOwner(execution) && !this.#manager.isWorkerRunning) await this.#preserve(execution);
    }
    const waiting = this.#activeExecution();
    if (waiting?.phase === "needs_user" && waiting.handoffDeadline && waiting.handoffDeadline <= this.#now() && !this.#manager.isWorkerRunning) {
      if (waiting.answerSnapshot) await this.#preserve(waiting);
      else {
        this.#manager.cancel(waiting.taskId);
        this.#store.lifecycle.putExecution({ ...waiting, phase: "failed", handoffDeadline: undefined, lastError: `I waited for you until ${new Date(waiting.handoffDeadline).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}, then let the school page go. Nothing was handed in; press Try again when you're ready.`, updatedAt: this.#now() });
      }
    }
  }

  async submitByRule(taskId: string): Promise<AssignmentExecution> {
    return this.#requestSubmission(taskId, "rule");
  }

  async submitReviewed(taskId: string): Promise<AssignmentExecution> {
    return this.#requestSubmission(taskId, "student");
  }

  async #requestSubmission(taskId: string, source: "rule" | "student"): Promise<AssignmentExecution> {
    this.#assertUsable();
    const execution = this.#requiredExecution(taskId);
    const assignment = this.#requiredAssignment(execution.assignmentId);
    if (execution.phase !== "ready_review") throw new Error("This assignment is not ready for review.");
    const permission = this.#manager.resolvePermission(assignment.assignmentId, assignment.courseId);
    if (!permission.mayAttempt) throw new Error("Your current rule no longer allows Dot to handle this assignment.");
    if (source === "rule" && !permission.maySubmit) throw new Error("Your current rule lets Dot prepare this work; you submit it yourself.");
    if (source === "rule" && execution.doubts?.length) throw new Error("Resolve Dot's doubts before submitting this work.");
    // Starting no longer waits for a confirmed deadline, so the rule never hands in late work by itself
    // unless the school says late work is accepted right now. The student can still hand it in.
    if (source === "rule" && pastDueWithoutLateWindow(assignment, this.#now())) throw new Error("The deadline has passed; hand this one in yourself if the school still takes it.");
    if (execution.handoffDeadline && execution.handoffDeadline <= this.#now()) throw new Error("The review window ended. Check the school page before submitting.");
    if (execution.reviewSubmissionRequestedAt || execution.submissionAttemptedAt) throw new Error("Submission was already requested. Check its result instead of sending it again.");
    if (this.#manager.isWorkerRunning) throw new Error("Dot is finishing the current turn. Try again in a moment.");
    this.#store.lifecycle.putExecution({ ...execution, reviewSubmissionRequestedAt: this.#now(), reviewSubmissionSource: source, updatedAt: this.#now() });
    try {
      await this.#manager.runWorkerTurn(`${source === "student" ? "The student clicked Submit for this reviewed assignment, including any visible doubts." : "The review timer ended and the saved rule allows submission."} Take a fresh snapshot and use browser_submit with the current submit control. Set expectedConfirmationText to an affirmative status or receipt that will appear only after submission, such as "Submission received" or "Submitted; not yet graded"; never use the submit button label or the current "Not submitted" status. Do not rewrite answers or repeat an already attempted effect. If permission or page state changed, report the problem.`, event => this.#recordActivity(taskId, event));
      const latest = this.#requiredExecution(taskId);
      if (latest.phase === "ready_review") await this.#submissionHandoff(latest, "Dot could not verify a submission. Check the saved answers and school page before continuing.", "Submission needs you");
    } catch (error) {
      const latest = this.#requiredExecution(taskId);
      if (latest.phase === "ready_review") await this.#submissionHandoff(latest, `Submission could not continue: ${errorMessage(error)}`.slice(0, 500), "Submission needs you");
      else throw error;
    }
    return this.#requiredExecution(taskId);
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#handInWatch) clearTimeout(this.#handInWatch);
    if (this.#signInWatch) clearTimeout(this.#signInWatch);
    this.#stopRunNotes();
  }

  // Every run ends with a note, whatever the ending: what happened, what was checked, what's open.
  // The next run on this assignment reads it; Dot adds class-wide lessons itself with note_upsert.
  async #writeRunNote(execution: AssignmentExecution): Promise<void> {
    const steps = (execution.actions ?? []).filter(action => action.kind === "tool" && action.outcome !== "started").slice(-20);
    const lines = [
      `Run ended ${execution.updatedAt}: ${RUN_ENDING[execution.phase] ?? execution.phase}.`,
      ...(execution.lastError ? [`Why: ${execution.lastError}`] : []),
      ...(execution.completionChecklist?.length ? ["", "Checked:", ...execution.completionChecklist.map(item => `- ${item.requirement}: ${item.evidence}`)] : []),
      ...(execution.doubts?.length ? ["", "Open questions:", ...execution.doubts.map(doubt => `- ${doubt.where}: ${doubt.why}`)] : []),
      ...(steps.length ? ["", "Steps:", ...steps.map(action => `- ${action.label.split("\n")[0]!.slice(0, 200)}${action.outcome === "failed" ? " (failed)" : ""}`)] : []),
    ];
    await this.#store.notes.upsert({ scope: "assignment", subjectId: execution.assignmentId, about: "work", key: "run-log",
      title: "What happened on the last run", content: lines.join("\n"), updatedAt: this.#now() });
  }

  async #run(execution: AssignmentExecution, instruction: string): Promise<void> {
    const assignment = this.#requiredAssignment(execution.assignmentId);
    const permission = this.#manager.resolvePermission(assignment.assignmentId, assignment.courseId);
    if (!assignment.sourceTarget) throw new Error("Add a school link before starting this homework.");
    if (this.#browserForAssignment && (!this.#browser.state.url || this.#browser.state.url === "about:blank")) await this.#browser.navigate(assignment.sourceTarget);
    const noteEntries = retrieveNoteIndex(this.#store.notes.list(), this.#noteContext(assignment.assignmentId, assignment.courseId), "automatic");
    const notes = await Promise.all(noteEntries.map(async (entry) => ({ entry, content: (await this.#store.notes.read(entry.noteId))?.content ?? null })));
    const receipt = this.#store.lifecycle.getSubmissionReceipt(execution.taskId);
    const homeworkFiles = await this.#homeworkFiles(execution.assignmentId);
    const folderListing = homeworkFiles ? await homeworkFiles.list() : [];
    const prompt = [
      "# Assignment",
        // The saved facts without their evidence metadata; Dot reads the page and its links itself.
        JSON.stringify({ taskId: execution.taskId, title: assignment.title, sourceTarget: assignment.sourceTarget,
          dueAt: assignment.dueAt ?? null, dueText: assignment.dueText,
          schoolStatus: assignment.schoolStatus ? { state: assignment.schoolStatus.state, text: assignment.schoolStatus.text } : null,
          latePolicy: assignment.latePolicy ? { state: assignment.latePolicy.state, text: assignment.latePolicy.text, until: assignment.latePolicy.until } : null,
          instructions: assignment.instructions ?? null,
          requirements: assignment.requirementEvidence?.map(item => ({ text: item.text, from: item.evidence.sourceTarget })),
          missingRequirements: assignment.missingRequirements }, null, 2),
        "Before entering answers, inspect this assignment's current submission state and cutoff. If already submitted, graded, locked, or the allowed submission window has closed, stop and report the change; do not overwrite or repeat schoolwork.",
      "# Class",
      JSON.stringify(this.#classContext(assignment.assignmentId, assignment.courseId), null, 2),
      "# Fresh stored permission",
      JSON.stringify(permission, null, 2),
      "# Task budget",
      `Up to ${execution.taskBudget.maxAgentTurns} student-directed turns; ${execution.turnCount} already used. At most two meaningfully different recovery plans.`,
      "# Relevant notes",
      notes.length ? notes.map(({ entry, content }) => `## ${entry.title} (${entry.scope}${entry.about === "preference" ? ", the student's preference" : ""})\n${content ?? ""}`).join("\n\n") : "No relevant notes are stored.",
      "# Last submission receipt",
      receipt ? `Handed in ${receipt.submittedAt}: "${receipt.verifiedStatus}".` : "No submission receipt exists for this task.",
      "# Homework folder",
      homeworkFiles
        ? JSON.stringify({ available: true, entries: folderListing.map(({ path, kind, size, modifiedAt }) => ({ path, kind, size, modifiedAt })) }, null, 2)
        : "No homework folder is selected. File tools and shell are unavailable.",
      "# Open page",
      `${this.#browser.state?.title || assignment.title} · ${this.#browser.state?.url || assignment.sourceTarget}. Take a snapshot to read it.`,
      "# Instruction",
      instruction,
    ].join("\n\n");
    try {
      await this.#keepGoing(execution.taskId, await this.continueTurn(execution.taskId, prompt), true);
    } catch (error) {
      const current = this.#store.lifecycle.getExecution(execution.taskId);
      if (current?.phase === "working") {
        await this.#handoff(current, `The assignment worker stopped: ${errorMessage(error)}`, "The student has resolved the visible browser problem.");
      }
    }
  }

  /** A student's message while Dot works on an assignment. It ends the same way as any other work turn. */
  async replyTurn(taskId: string, prompt: string, observe?: (event: AgentRunEvent) => void): Promise<WorkerTurnResult> {
    this.#assertUsable();
    const execution = this.#requiredExecution(taskId);
    // A student reply opens a fresh allowance of turns; the limit only stops Dot from nudging itself forever.
    if (execution.phase === "needs_user" || execution.turnCount >= execution.taskBudget.maxAgentTurns) {
      this.#store.lifecycle.putExecution({ ...execution, turnCount: 0, attemptCount: 0, updatedAt: this.#now() });
    }
    const result = await this.continueTurn(taskId, prompt, observe);
    await this.#keepGoing(taskId, result, false);
    return result;
  }

  // Every work turn ends here, whatever started it. A worker that stops without recording a result is nudged
  // up to three times; then the student is asked, with the real reason.
  async #keepGoing(taskId: string, first: WorkerTurnResult, recordFirst: boolean): Promise<void> {
    let result = first;
    for (let nudge = 1; ; nudge += 1) {
      if (recordFirst || nudge > 1) this.#recordReply(taskId, result);
      const current = this.#store.lifecycle.getExecution(taskId);
      if (current?.phase !== "working") return;
      const assignment = this.#requiredAssignment(current.assignmentId);
      const continueHint = "The student has inspected the visible page and asked Studi to continue.";
      if (!this.#manager.resolvePermission(assignment.assignmentId, assignment.courseId).mayAttempt) {
        await this.#handoff(current, RULE_STOPPED, continueHint);
        return;
      }
      const stalled = result.reason === "stalled";
      const turnsLeft = current.turnCount < current.taskBudget.maxAgentTurns;
      if ((result.outcome !== "completed" && !stalled) || nudge > MAX_NUDGES || !turnsLeft) {
        await this.#handoff(current, stopReason(result, nudge > MAX_NUDGES, turnsLeft), continueHint);
        return;
      }
      result = await this.continueTurn(taskId, stalled
        ? "That turn made no progress for several minutes and was stopped. Take a fresh snapshot, then carry on from where the work is."
        : `You ended the turn without recording a result (reminder ${nudge} of ${MAX_NUDGES}). Carry on with the work. Finish with assignment_start_review, ask with assignment_tell_student if you need the student, or call assignment_mark_unsupported if it truly can't be done.`);
    }
  }

  #recordReply(taskId: string, result: WorkerTurnResult): void {
    const assignmentId = this.#store.lifecycle.getExecution(taskId)?.assignmentId;
    const persisted = assignmentId ? this.#store.agentJobs.getByTarget({ kind: "assignment", assignmentId }) : undefined;
    if (!persisted || !result.text.trim()) return;
    this.#store.agentJobs.put({ ...persisted.job, messages: [...persisted.job.messages, { messageId: randomUUID(), role: "assistant", text: result.text, createdAt: this.#now(), turnIndex: persisted.job.turnIndex }] }, persisted.sessionPath);
  }

  // What the class looks like around this assignment: its name, its saved materials, and how related work went.
  #classContext(assignmentId: string, courseId: string) {
    const course = this.#store.school.listCourses().find(item => item.courseId === courseId);
    const related = this.#store.assignments.listByCourse(courseId)
      .filter(item => item.assignmentId !== assignmentId)
      .sort((a, b) => (b.dueAt ?? "").localeCompare(a.dueAt ?? ""))
      .slice(0, 8)
      .map(item => {
        const run = this.#store.tasks.listAll().filter(task => task.assignmentId === item.assignmentId)
          .map(task => this.#store.lifecycle.getExecution(task.taskId)).filter(Boolean).at(-1);
        return { title: item.title, kind: item.kind ?? null, dueAt: item.dueAt ?? null, schoolStatus: item.schoolStatus?.state ?? "unknown", ...(run ? { lastRun: run.phase } : {}) };
      });
    // Titles and links only: Dot opens a material when it needs it.
    const materials = this.#classMaterials(courseId).slice(0, 6).map(item => ({ title: item.title, link: item.sourceTarget }));
    return { name: course?.label ?? null, materials, relatedAssignments: related };
  }

  #recordActivity(taskId: string, event: AgentRunEvent): void {
    if (event.type === "compaction") return;
    const base = { actionId: randomUUID(), occurredAt: this.#now() };
    if (event.type === "text") {
      this.#store.lifecycle.recordActivity(taskId, { ...event, delta: event.delta.slice(-20_000) }, { ...base, kind: "text", label: event.delta.slice(-4000) });
    } else if (event.type === "tool_started" || event.type === "tool_finished") {
      // The timeline keeps readable actions. Bounded shell text is stored
      // separately for the assignment's file panel.
      const outcome = event.type === "tool_started" ? "started" : event.outcome;
      const earlier = event.type === "tool_finished"
        ? this.#store.lifecycle.getExecution(taskId)?.actions?.find(action => action.toolCallId === event.toolCallId)
        : undefined;
      const label = earlier?.label ?? this.#activityLabel(event)
        ?? TOOL_ACTION_LABELS[event.toolName] ?? this.#tools.find(tool => tool.name === event.toolName)?.label ?? "Working on the assignment";
      const safeEvent: AgentRunEvent = event.type === "tool_started"
        ? { schemaVersion: 1, type: event.type, toolCallId: event.toolCallId, toolName: event.toolName }
        : { schemaVersion: 1, type: event.type, toolCallId: event.toolCallId, toolName: event.toolName, outcome: event.outcome, durationMs: event.durationMs };
      const command = commandOutput(event, base.occurredAt);
      const target = event.type === "tool_started" ? this.#activityTarget(event) : undefined;
      const result = event.type === "tool_finished" ? (event.outcome === "failed" ? "failed" : command ? commandSummary(command.text) : undefined) : undefined;
      this.#store.lifecycle.recordActivity(taskId, safeEvent, {
        ...base, kind: "tool", toolCallId: event.toolCallId, label, outcome, tool: event.toolName,
        ...(target ? { target } : {}), ...(result ? { result } : {}),
      }, command);
    } else if (event.type === "retry") {
      this.#store.lifecycle.recordActivity(taskId, event, { ...base, kind: "retry", label: (event.reason ?? "Trying the connection again").slice(0, 4000), outcome: event.phase === "started" ? "started" : event.outcome });
    } else this.#store.lifecycle.recordActivity(taskId, event);
  }

  /** What a tool call acted on, for the thread: a page address, a file, a control or a command. */
  #activityTarget(event: Extract<AgentRunEvent, { type: "tool_started" }>): string | undefined {
    if (!event.arguments || typeof event.arguments !== "object") return undefined;
    const args = event.arguments as Record<string, unknown>;
    const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ").slice(0, 300) : undefined;
    const element = typeof args.ref === "string" ? this.#browser.lastSnapshot?.elements.find(item => item.ref === args.ref)?.name : undefined;
    const url = text(args.url)?.replace(/^https?:\/\//, "");
    const path = text(args.path)?.split(/[\\/]/).at(-1);
    return url ?? path ?? text(element) ?? text(args.command) ?? text(args.query) ?? text(args.pattern) ?? text(args.title);
  }

  #activityLabel(event: Extract<AgentRunEvent, { type: "tool_started" | "tool_finished" }>): string | null {
    if (event.type !== "tool_started" || !event.arguments || typeof event.arguments !== "object") return null;
    const args = event.arguments as Record<string, unknown>;
    const element = typeof args.ref === "string" ? this.#browser.lastSnapshot?.elements.find(item => item.ref === args.ref) : undefined;
    const name = element?.name?.trim().slice(0, 80);
    const file = typeof args.path === "string" ? args.path.split(/[\\/]/).at(-1)?.slice(0, 100) : undefined;
    if (event.toolName === "browser_type" && name) return `Typed an answer in ${name}`;
    if (event.toolName === "browser_select" && name) return `Chose an option for ${name}`;
    if (event.toolName === "browser_click" && name) return `Opened ${name}`;
    if (event.toolName === "browser_upload" && Array.isArray(args.paths)) return `Attached ${args.paths.length} file${args.paths.length === 1 ? "" : "s"}`;
    if (event.toolName === "write" && file) return `Saved ${file}`;
    if (event.toolName === "edit" && file) return `Updated ${file}`;
    if (event.toolName === "read" && file) return `Read ${file}`;
    return null;
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
        const runAttempts = Math.min(execution.attemptCount + 1, execution.taskBudget.maxRecoveryAttempts);
        this.#store.lifecycle.putExecution({ ...execution, attemptCount: runAttempts, updatedAt: this.#now() });
        if (runAttempts >= execution.taskBudget.maxRecoveryAttempts) {
          await this.#handoff(this.#requiredExecution(execution.taskId), "Two different browser recovery plans failed.", "The student has resolved the browser failure and asked Studi to continue.");
        }
        return toolResult(attempt);
      },
    });
    const tellStudent = defineTool({
      name: "assignment_tell_student",
      label: "Tell the student",
      description: "Tell the student something they must do, decide or know, in one or two plain sentences. needs \"nothing\" keeps working and shows it as a heads-up at review; any other value pauses until they act or reply.",
      parameters: Type.Object({
        message: Type.String({ minLength: 1, maxLength: 1_000 }),
        needs: Type.Union([Type.Literal("nothing"), Type.Literal("answer"), Type.Literal("sign_in"), Type.Literal("files"), Type.Literal("browser")]),
      }, { additionalProperties: false }),
      execute: async (_id, input) => {
        const execution = this.#requiredWorkingExecution();
        const message = input.message.trim();
        if (input.needs !== "nothing") return toolResult(await this.#handoff(execution, message, message, input.needs));
        const told = this.#store.lifecycle.putExecution({ ...execution, notices: [...(execution.notices ?? []), message].slice(-20), updatedAt: this.#now() });
        await this.#notify({ kind: "handoff", target: { type: "task", id: execution.taskId }, title: "A heads-up from Dot", body: message.slice(0, 500) });
        return toolResult(told);
      },
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
      description: "After inspecting the entire assignment, list every required answer, file, graph, and deliverable with current evidence. Record unresolved doubts as where/why margin notes. Retain answers and start review without submitting.",
      parameters: Type.Object({
        answers: Type.Optional(Type.String({ minLength: 1, maxLength: 20_000 })),
        completedRequirements: Type.Array(Type.Object({
          requirement: Type.String({ minLength: 1, maxLength: 500 }),
          evidence: Type.String({ minLength: 1, maxLength: 1_000 }),
        }, { additionalProperties: false }), { minItems: 1, maxItems: 100 }),
        doubts: Type.Optional(Type.Array(Type.Object({ where: Type.String({ minLength: 1, maxLength: 300 }), why: Type.String({ minLength: 1, maxLength: 1000 }) }, { additionalProperties: false }), { maxItems: 30 })),
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
        const answerArtifactId = await this.#writeAnswerArtifact({ ...execution, answerSnapshot: answers }, "Saved before starting student review.");
        // Saving files yields to owner/rule changes. Never revive cancelled work.
        const current = this.#requiredWorkingExecution();
        if (current.taskId !== execution.taskId) throw new Error("This assignment no longer owns the school page.");
        const ready = this.#store.lifecycle.putExecution({
          ...current,
          answerArtifactId,
          phase: "ready_review",
          reviewSubmissionRequestedAt: current.submissionAttemptedAt ? current.reviewSubmissionRequestedAt : undefined,
          reviewSubmissionSource: current.submissionAttemptedAt ? current.reviewSubmissionSource : undefined,
          answerSnapshot: answers,
          // Heads-ups given during the work stay in front of the student and stop automatic submission.
          doubts: [...(input.doubts ?? []), ...(current.notices ?? []).map(why => ({ where: "Heads-up", why }))].slice(0, 30),
          completionChecklist: input.completedRequirements.map((item) => ({
            requirement: item.requirement.trim(),
            evidence: item.evidence.trim(),
          })),
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
      label: "Save a note",
      description: "Save what you learned so later work goes better, whenever you learn it: how this class wants work done (course), how a kind of work goes (pattern), or notes on this assignment. Save a student preference only when the student asked you to remember it, quoting their words. Notes never change permission or count as evidence.",
      parameters: Type.Object({
        scope: Type.Union([Type.Literal("course"), Type.Literal("pattern"), Type.Literal("assignment"), Type.Literal("preference")]),
        patternId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
        about: Type.Union([Type.Literal("how-to"), Type.Literal("knowledge"), Type.Literal("work"), Type.Literal("preference")]),
        key: Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
        title: Type.String({ minLength: 1, maxLength: 200 }),
        content: Type.String({ minLength: 1, maxLength: 100_000 }),
        requestQuote: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
      }, { additionalProperties: false }),
      execute: async (_id, input) => {
        const execution = this.#activeExecution();
        if (!execution) throw new Error("Notes are saved while working on an assignment");
        const assignment = this.#requiredAssignment(execution.assignmentId);
        if (input.scope === "preference") {
          if (!this.#ownerSubject) throw new Error("Sign in before saving a personal preference");
          const said = this.#store.agentJobs.getByTarget({ kind: "assignment", assignmentId: assignment.assignmentId })?.job.messages
            .filter(message => message.role === "user").some(message => input.requestQuote && message.text.includes(input.requestQuote));
          if (!said) throw new Error("Save a preference only when the student asked you to remember it; quote their words in requestQuote");
          return toolResult(await this.#store.notes.upsert({ scope: "student", subjectId: this.#ownerSubject, about: "preference", key: input.key, title: input.title, content: input.content, updatedAt: this.#now() }));
        }
        let subjectId = assignment.assignmentId;
        if (input.scope === "course") subjectId = assignment.courseId;
        if (input.scope === "pattern") {
          if (!input.patternId) throw new Error("A confirmed pattern id is required for a pattern note");
          const confirmed = this.#manager.matchedPatterns(assignment.assignmentId, assignment.courseId).includes(input.patternId);
          if (!confirmed) throw new Error(`Pattern ${input.patternId} is not confirmed for this assignment`);
          subjectId = input.patternId;
        }
        const note = await this.#store.notes.upsert({
          scope: input.scope,
          subjectId,
          about: input.about === "preference" ? "knowledge" : input.about,
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
    const workingOn = () => {
      const execution = this.#activeExecution();
      if (!execution) throw new Error("Notes are read while working on an assignment");
      return this.#requiredAssignment(execution.assignmentId);
    };
    const noteSearch = defineTool({
      name: "note_search",
      label: "Search notes",
      description: "Search notes about this class, this kind of work, this school and related assignments: how work is done, what graders wanted, where things live, the student's preferences.",
      parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false }),
      execute: async (_id, input) => {
        const assignment = workingOn();
        return toolResult(await searchNotes(this.#store.notes, this.#noteContext(assignment.assignmentId, assignment.courseId), input.query));
      },
    });
    const noteRead = defineTool({
      name: "note_read",
      label: "Read a note",
      description: "Read one note found with note_search.",
      parameters: Type.Object({ noteId: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false }),
      execute: async (_id, input) => {
        const assignment = workingOn();
        const entry = this.#store.notes.list().find(candidate => candidate.noteId === input.noteId);
        if (!entry || !noteIsAllowed(entry, this.#noteContext(assignment.assignmentId, assignment.courseId), "search")) throw new Error(`Note ${input.noteId} is not available to this assignment`);
        return toolResult(await this.#store.notes.read(input.noteId));
      },
    });
    return [recordAnswer, recovery, tellStudent, unsupported, review, noteUpsert, noteSearch, noteRead, submit];
  }

  async #submit(ref: string, expectedConfirmationText: string): Promise<AssignmentExecution> {
    const execution = this.#activeExecution();
    if (!execution || execution.phase !== "ready_review" || !execution.reviewCheckpoint || !execution.reviewSubmissionRequestedAt) throw new Error("Submission requires a completed review and a request from Studi or the student.");
    this.#assertExecutionOwner(execution);
    if (execution.submissionAttemptedAt) {
      throw new Error("A submission effect was already attempted for this execution; verify the visible page instead of repeating it");
    }
    const assignment = this.#requiredAssignment(execution.assignmentId);
    const permission = this.#manager.resolvePermission(assignment.assignmentId, assignment.courseId);
    if (!permission.mayAttempt || (execution.reviewSubmissionSource !== "student" && (!permission.maySubmit || execution.doubts?.length))) throw new Error("Fresh stored assignment permission does not allow submission");
    const refreshed = await this.#browser.refreshRef(ref);
    const latestExecution = this.#requiredExecution(execution.taskId);
    const latestPermission = this.#manager.resolvePermission(assignment.assignmentId, assignment.courseId);
    if (latestExecution.phase !== "ready_review" || !latestExecution.reviewSubmissionRequestedAt || latestExecution.submissionAttemptedAt || !latestPermission.mayAttempt ||
      (latestExecution.reviewSubmissionSource !== "student" && (!latestPermission.maySubmit || latestExecution.doubts?.length))) throw new Error("Homework permission or ownership changed before submission.");
    const preSnapshot = refreshed.snapshot;
    const pre = this.#checkpoint(preSnapshot, "Fresh page state immediately before the gated submission effect.");
    const status = expectedConfirmationText.replace(/\s+/g, " ").trim();
    if (!/\b(?:received|submitted|confirmed|receipt|turned in)\b/i.test(status) || /\bnot\s+submitted\b/i.test(status)) {
      throw new Error("Choose an affirmative submission status or receipt that is absent before submission.");
    }
    if (submissionConfirmationVisible(preSnapshot.text, status)) {
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
    // Form submission may commit before Chromium finishes the redirect. Read
    // the resulting page again; never activate the submit control a second time.
    for (let attempt = 0; attempt < 5 && !submissionConfirmationVisible(postSnapshot.text, status); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 200));
      try { postSnapshot = await this.#browser.snapshot(); }
      catch { /* The redirect is still replacing the document. */ }
    }
    if (!submissionConfirmationVisible(postSnapshot.text, status)) {
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
    const needsUser = this.#store.lifecycle.putExecution({ ...execution, phase: "needs_user", lastError: reason, handoffDeadline: new Date(Date.parse(this.#now()) + this.#handoffWindowMs).toISOString(), updatedAt: this.#now() });
    this.#manager.pause(execution.taskId, "needs_user", reason);
    await this.#notify({ kind: "handoff", target: { type: "task", id: execution.taskId }, title, body: reason });
    return needsUser;
  }

  /** A message Dot chose to send isn't an error; only failures the app detects are shown as one. */
  async #handoff(execution: AssignmentExecution, reason: string, returnPredicate: string, needs?: NonNullable<AssignmentExecution["needs"]>): Promise<AssignmentExecution> {
    const snapshot = await this.#browser.snapshot();
    const current = this.#requiredExecution(execution.taskId);
    if (current.phase !== execution.phase) return current;
    const needsUser = this.#store.lifecycle.putExecution({
      ...current,
      phase: "needs_user",
      needs,
      returnPredicate: returnPredicate.trim(),
      handoffDeadline: this.#waitUntil(current, needs),
      lastError: needs ? undefined : reason.trim(),
      reviewCheckpoint: this.#checkpoint(snapshot, `Student handoff requested: ${reason.trim()}`),
      updatedAt: this.#now(),
    });
    this.#manager.pause(execution.taskId, "needs_user", reason.trim());
    const repeat = needs === "sign_in" && this.#signInAsked;
    if (!repeat) await this.#notify({ kind: "handoff", target: { type: "task", id: execution.taskId }, title: HANDOFF_TITLES[needs ?? "browser"], body: reason.trim().slice(0, 500) });
    if (needs === "sign_in") {
      this.#signInAsked = true;
      this.#watchSignIn(execution.taskId, execution.assignmentId, snapshot);
    }
    return needsUser;
  }

  // Dot notices the sign-in by itself: once the page it was waiting on has no password box, it carries on.
  // Pages that never showed one can't be told apart, so those wait for "I've signed in".
  #watchSignIn(taskId: string, assignmentId: string, before: BrowserSnapshot): void {
    if (this.#signInWatch) clearTimeout(this.#signInWatch);
    this.#signInWatch = null;
    if (!asksForPassword(before)) return;
    const page = this.#browserForAssignment?.(assignmentId) ?? this.#defaultBrowser;
    const look = async () => {
      this.#signInWatch = null;
      const current = this.#store.lifecycle.getExecution(taskId);
      if (this.#disposed || current?.phase !== "needs_user" || current.needs !== "sign_in") return;
      try {
        if (!asksForPassword(await page.snapshot())) {
          await this.#resumeWith(taskId, "You were waiting for the student to sign in, and the sign-in page is gone: they signed in. Take a fresh snapshot and carry on from where you stopped. Do not redo finished steps.");
          return;
        }
      } catch {
        // The page may be mid-redirect after signing in; look again.
      }
      if (!this.#disposed) this.#signInWatch = setTimeout(() => void look(), this.#signInCheckMs);
    };
    this.#signInWatch = setTimeout(() => void look(), this.#signInCheckMs);
  }

  // Waiting for the student to sign in, add a file or answer lasts until an hour before the due date (at most a day),
  // so a lunch break doesn't cost the work. Other hand-offs keep the short window.
  #waitUntil(execution: AssignmentExecution, needs?: AssignmentExecution["needs"]): string {
    const now = Date.parse(this.#now());
    const short = now + this.#handoffWindowMs;
    if (!needs || needs === "browser") return new Date(short).toISOString();
    const due = this.#store.assignments.get(execution.assignmentId)?.dueAt;
    const beforeDue = due ? Date.parse(due) - 60 * 60_000 : now + 24 * 60 * 60_000;
    return new Date(Math.max(short, Math.min(beforeDue, now + 24 * 60 * 60_000))).toISOString();
  }

  async #preserve(execution: AssignmentExecution): Promise<void> {
    if (!["ready_review", "needs_user"].includes(execution.phase) || !execution.answerSnapshot) return;
    const artifactId = await this.#writeAnswerArtifact(execution, "Saved after the submission-review handoff expired.");
    if (this.#requiredExecution(execution.taskId).phase !== execution.phase) return;
    this.#store.lifecycle.putExecution({ ...execution, phase: "preserved", answerArtifactId: artifactId, reviewDeadline: undefined, handoffDeadline: undefined, updatedAt: this.#now() });
    this.#manager.completeActive(execution.taskId, "preserved", "Answer Markdown was saved before the review lease was released");
  }

  async #writeAnswerArtifact(execution: AssignmentExecution, reason: string): Promise<string> {
    if (!execution.answerSnapshot) throw new Error("An answer snapshot is required before answers can be preserved");
    const assignment = this.#requiredAssignment(execution.assignmentId);
    const artifactId = `answer-${createHash("sha256").update(execution.taskId).digest("hex").slice(0, 24)}`;
    const content = `# ${assignment.title}\n\nSource: ${assignment.sourceTarget}\n\n${reason}\n\n## Answers\n\n${execution.answerSnapshot.trim()}\n`;
    await this.#store.artifacts.write({
      frontmatter: { schemaVersion: STUDI_SCHEMA_VERSION, kind: "answer", artifactId, updatedAt: this.#now() },
      content,
    });
    const files = await this.#homeworkFiles(execution.assignmentId);
    if (files) await files.write("studi-answer.md", content);
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
    // Another account's existing work is not ours to resume or migrate.
    if (!this.#matchesExecutionOwner(execution)) return;
    if (execution.phase === "submitted" || execution.phase === "preserved" || execution.phase === "failed") {
      this.#manager.completeActive(execution.taskId, execution.phase, "Recovered durable terminal execution state");
      return;
    }
    await this.#manager.restoreAssignmentWorker((assignmentId) => this.#assignmentSessionPlan(assignmentId));
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
    if (execution.phase === "submitting") {
      const reason = "Studi restarted after a submission effect began; the result requires student verification and will not be repeated.";
      this.#store.lifecycle.putExecution({ ...execution, phase: "needs_user", lastError: reason, returnPredicate: "The student has inspected the visible browser and asked Studi to resume.", updatedAt: this.#now() });
      this.#manager.pause(execution.taskId, "needs_user", reason);
      await this.#notify({ kind: "handoff", target: { type: "task", id: execution.taskId }, title: "Assignment paused after restart", body: reason });
    }
    if (execution.phase === "working") {
      // Held for a moment: carryOnAfterRestart resumes it once the model is ready. If it can't, the student sees this.
      const reason = "Studi restarted during this work. Press Carry on and I'll pick up where I was.";
      this.#store.lifecycle.putExecution({ ...execution, phase: "needs_user", lastError: reason, returnPredicate: "Studi restarted during the work; the page was reloaded.", updatedAt: this.#now() });
      this.#manager.pause(execution.taskId, "needs_user", reason);
      this.#restarted = execution.taskId;
    }
    await this.reconcileDeadlines();
  }

  #activeExecution(): AssignmentExecution | null {
    const lease = this.#manager.state().lease;
    return lease ? this.#store.lifecycle.getExecution(lease.taskId) : this.#store.lifecycle.getActiveExecution();
  }

  async #assignmentSessionPlan(assignmentId: string): Promise<AssignmentSessionPlan> {
    for (const task of this.#store.tasks.listAll().filter(task => task.assignmentId === assignmentId)) {
      const previous = this.#store.lifecycle.getExecution(task.taskId);
      if (previous) this.#assertExecutionOwner(previous);
    }
    const { workspace, files: homeworkFiles } = await this.#assignmentWorkspace(assignmentId);
    const files = createWorkspaceCodingTools(workspace.assignmentDirectory);
    const upload = createBrowserUploadTool(this.#browserForAssignment?.(assignmentId) ?? this.#defaultBrowser, (paths) => homeworkFiles.resolveUploads(paths));
    const download = createBrowserDownloadTool(this.#browserForAssignment?.(assignmentId) ?? this.#defaultBrowser, homeworkFiles);
    const pdf = createPdfReadTool(homeworkFiles);
    let connected: readonly ToolDefinition[] = [];
    try { connected = await this.#connectedAppTools(); } catch { /* Connected apps cannot disable local tools. */ }
    return {
      cwd: workspace.assignmentDirectory,
      tools: [...this.#tools, ...files, upload, download, pdf, ...connected.map(tool => this.#handInGate(tool, assignmentId))],
    };
  }

  // A connected-app action that hands work in (push, pull request, send, share, post) passes the same check as
  // browser_submit: the rule must allow handing in, and the hand-in must have been asked for.
  #handInGate(tool: ToolDefinition, assignmentId: string): ToolDefinition {
    if (tool.name !== "connected_apps_execute") return tool;
    return { ...tool, execute: async (...args: Parameters<ToolDefinition["execute"]>) => {
      const slug = String((args[1] as { toolSlug?: unknown }).toolSlug ?? "");
      if (HAND_IN_ACTION.test(slug)) {
        const assignment = this.#requiredAssignment(assignmentId);
        const execution = this.#store.tasks.listAll().filter(task => task.assignmentId === assignmentId)
          .map(task => this.#store.lifecycle.getExecution(task.taskId)).find(item => item && isLivePhase(item.phase));
        if (!this.#manager.resolvePermission(assignment.assignmentId, assignment.courseId).maySubmit || !execution?.reviewSubmissionRequestedAt) {
          throw new Error("This action would hand the work in. Only the hand-in step may do that, and only when the student's rule allows it. Save the work instead and tell the student what to send or push.");
        }
      }
      return tool.execute(...args);
    } };
  }

  async assignmentFiles(assignmentId:string) { return (await this.#assignmentWorkspace(assignmentId)).files.list(); }
  async readAssignmentFile(assignmentId:string, path:string) { return (await this.#assignmentWorkspace(assignmentId)).files.read(path); }
  async assignmentDirectory(assignmentId:string) { return (await this.#assignmentWorkspace(assignmentId)).workspace.assignmentDirectory; }
  async revealAssignmentFile(assignmentId: string, path: string) { return (await this.#assignmentWorkspace(assignmentId)).files.revealPath(path); }
  async importAssignmentFile(assignmentId: string, source: string) { return (await this.#assignmentWorkspace(assignmentId)).files.importFile(source); }

  async #homeworkFiles(assignmentId: string): Promise<HomeworkFiles | null> {
    try {
      return (await this.#assignmentWorkspace(assignmentId)).files;
    } catch {
      return null;
    }
  }

  async #assignmentWorkspace(assignmentId: string) {
    const preferences = await this.#store.productPreferences.get();
    if (!preferences.homeworkRoot) {
      throw new Error("Choose a new empty homework folder for Studi before starting this assignment");
    }
    const assignment = this.#requiredAssignment(assignmentId);
    const course = this.#store.school.listCourses().find((candidate) => candidate.courseId === assignment.courseId);
    const workspace = await openAssignmentWorkspace(preferences.homeworkRoot, {
      courseId: assignment.courseId,
      courseLabel: course?.label ?? assignment.courseId,
      assignmentId: assignment.assignmentId,
      assignmentTitle: assignment.title,
    });
    return { workspace, files: await HomeworkFiles.open(workspace.assignmentDirectory) };
  }

  #requiredWorkingExecution(): AssignmentExecution {
    const execution = this.#activeExecution();
    if (!execution || execution.phase !== "working") throw new Error("No working assignment execution owns the browser");
    this.#assertExecutionOwner(execution);
    const assignment = this.#requiredAssignment(execution.assignmentId);
    if (!this.#manager.resolvePermission(assignment.assignmentId, assignment.courseId).mayAttempt) throw new Error("Your current rule no longer permits work on this assignment.");
    return execution;
  }

  #requiredExecution(taskId: string): AssignmentExecution {
    const execution = this.#store.lifecycle.getExecution(taskId);
    if (!execution) throw new Error(`Assignment execution ${taskId} does not exist`);
    this.#assertExecutionOwner(execution);
    return AssignmentExecutionSchema.parse(execution);
  }

  #matchesExecutionOwner(execution: AssignmentExecution): boolean {
    return !this.#ownerSubject || !execution.ownerSubject || execution.ownerSubject === this.#ownerSubject;
  }

  #assertExecutionOwner(execution: AssignmentExecution): void {
    if (!this.#matchesExecutionOwner(execution)) throw new Error("This homework execution belongs to another signed-in student.");
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
    const schoolId = this.#store.school.getProfile()?.profileId;
    return {
      kind: "assignment",
      ...(this.#ownerSubject ? { studentId: this.#ownerSubject } : {}),
      ...(schoolId ? { schoolId } : {}),
      assignmentId,
      courseId,
      confirmedPatternIds: this.#manager.matchedPatterns(assignmentId, courseId),
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

const TOOL_ACTION_LABELS: Record<string, string> = {
  browser_snapshot: "Reading the school page", browser_navigate: "Opening the school page",
  browser_click: "Using a control on the school page", browser_type: "Entering an answer", browser_fill: "Entering an answer",
  browser_scroll: "Reading more of the page", browser_submit: "Submitting the assignment",
  browser_upload: "Attaching assignment files", browser_download: "Saving a school file",
  read: "Reading an assignment file", write: "Saving an assignment file", edit: "Editing an assignment file", bash: "Running a command in the assignment folder",
};

const HANDOFF_TITLES: Record<NonNullable<AssignmentExecution["needs"]>, string> = {
  answer: "Dot has a question", sign_in: "Sign in so Dot can continue", files: "Dot needs a file", browser: "Studi needs you in the browser",
};

// The words the student sees when Dot stops and needs them, with the real cause.
function stopReason(result: WorkerTurnResult, nudgedOut: boolean, turnsLeft: boolean): string {
  if (result.reason === "stalled") return "I stopped making progress, so I paused. My work so far is saved; tell me how to carry on.";
  if (result.outcome === "failed") return `I had to stop: ${result.reason ?? "the model request failed"}. My work so far is saved.`;
  if (!turnsLeft) return "I've used this run's turns without finishing. My work so far is saved; tell me how to carry on.";
  if (nudgedOut) return "I kept stopping without finishing or asking you anything. Look at the page and tell me how to carry on.";
  return "I stopped before recording a result. My work so far is saved; tell me how to carry on.";
}

function asksForPassword(snapshot: Pick<BrowserSnapshot, "elements">): boolean {
  return snapshot.elements.some(element => /password|passcode|passphrase/i.test(element.name) && /textbox|input|searchbox/i.test(element.role));
}

function pastDueWithoutLateWindow(assignment: { dueAt?: string | undefined; latePolicy?: { state: string; until?: string | undefined } | undefined }, now: string): boolean {
  const due = Date.parse(assignment.dueAt ?? "");
  if (!Number.isFinite(due) || due > Date.parse(now)) return false;
  const until = Date.parse(assignment.latePolicy?.until ?? "");
  return !(assignment.latePolicy?.state === "accepted" && Number.isFinite(until) && until > Date.parse(now));
}
