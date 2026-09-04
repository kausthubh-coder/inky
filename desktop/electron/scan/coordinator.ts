import { createHash, randomUUID } from "node:crypto";

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  SafeSourceTargetSchema,
  SchoolOnboardingStateSchema,
  SchoolScanSchema,
  STUDI_SCHEMA_VERSION,
  type AgentRunEvent,
  type Assignment,
  type BrowserSnapshot,
  type EvidenceReference,
  type SaveSchoolProfileInput,
  type SchoolOnboardingState,
  type SchoolProfile,
  type SchoolScan,
  type SchoolScanWorkflow,
} from "../../shared/index.js";
import { retrieveNoteIndex } from "../../agent-system/retrieve.js";
import type { AgentSession, AgentSessionTarget } from "../agent/runtime.js";
import type { BrowserController } from "../browser/controller.js";
import { VisibleBrowserWork } from "../browser/work-ownership.js";
import type { ManagerCoordinator } from "../manager/coordinator.js";
import type { LocalStore } from "../storage/index.js";

export interface ScanSessionRuntime {
  createScanSession(
    recordingTools: readonly ToolDefinition[],
    target?: AgentSessionTarget,
  ): Promise<AgentSession>;
}

export class SchoolScanCoordinator {
  readonly #store: LocalStore;
  readonly #runtime: ScanSessionRuntime;
  readonly #browser: BrowserController;
  readonly #browserWork: VisibleBrowserWork;
  readonly #manager: Pick<ManagerCoordinator, "enqueue" | "resolvePermission"> | null;
  readonly #now: () => string;
  #session: AgentSession | null = null;
  #sessionScanId: string | null = null;
  #disposed = false;

  constructor(
    store: LocalStore,
    runtime: ScanSessionRuntime,
    browser: BrowserController,
    options: {
      readonly now?: () => string;
      readonly browserWork?: VisibleBrowserWork;
      readonly manager?: Pick<ManagerCoordinator, "enqueue" | "resolvePermission">;
    } = {},
  ) {
    this.#store = store;
    this.#runtime = runtime;
    this.#browser = browser;
    this.#browserWork = options.browserWork ?? new VisibleBrowserWork(store);
    this.#manager = options.manager ?? null;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async state(): Promise<SchoolOnboardingState> {
    this.#assertUsable();
    await this.#repairReplayArtifact();
    const profile = this.#store.school.getProfile();
    const courses = this.#store.school.listCourses();
    const assignments = courses.flatMap((course) => this.#store.assignments.listByCourse(course.courseId));
    const workflow = this.#store.school.getWorkflow();
    return SchoolOnboardingStateSchema.parse({
      profile,
      scan: this.#store.school.latestScan(),
      courses,
      assignments,
      linkedSystems: this.#store.school.listLinkedSystems(),
      workflowRevision:
        workflow?.revision ?? null,
    });
  }

  async saveProfile(input: SaveSchoolProfileInput): Promise<SchoolOnboardingState> {
    this.#assertUsable();
    const previous = this.#store.school.getProfile();
    const profile: SchoolProfile = {
      schemaVersion: STUDI_SCHEMA_VERSION,
      profileId: "primary-school",
      studentName: input.studentName.trim(),
      schoolRoot: input.schoolRoot,
      defaultPermission: input.defaultPermission,
      scanCadence: input.scanCadence,
      onboardingState:
        previous?.onboardingState === "ready" && previous.schoolRoot === input.schoolRoot
          ? "ready"
          : "profile_saved",
      missedCourseFeedback: previous?.missedCourseFeedback ?? [],
      updatedAt: this.#now(),
    };
    this.#store.school.putProfile(profile);
    this.#store.permissionRules.put({
      schemaVersion: STUDI_SCHEMA_VERSION,
      ruleId: "onboarding-default",
      scope: "global",
      mode: profile.defaultPermission,
      updatedAt: profile.updatedAt,
    });
    return this.state();
  }

  async startScan(): Promise<SchoolOnboardingState> {
    return this.#browserWork.startScan(() => this.#start("first_scan"));
  }

  async replay(): Promise<SchoolOnboardingState> {
    return this.#browserWork.startScan(async () => {
      const workflow = this.#store.school.getWorkflow();
      if (!workflow) throw new Error("A successful school scan is required before replay");
      return this.#start("replay", workflow);
    });
  }

  async runScheduledScan<T>(
    claimOccurrence: () => T | null,
    prepare: () => Promise<void>,
  ): Promise<{ readonly claim: T; readonly state: SchoolOnboardingState } | null> {
    return this.#browserWork.startScan(async () => {
      const claim = claimOccurrence();
      if (claim === null) return null;
      await prepare();
      const workflow = this.#store.school.getWorkflow();
      const state = await (workflow ? this.#start("replay", workflow) : this.#start("first_scan"));
      return { claim, state };
    });
  }

  async resume(): Promise<SchoolOnboardingState> {
    return this.#browserWork.resumeScan(async () => {
      this.#assertUsable();
      const scan = this.#store.school.latestScan();
      if (!scan || scan.state !== "needs_user") throw new Error("No school scan is waiting for the student");
      const resumed = this.#store.school.putScan({
        ...scan,
        state: "running",
        updatedAt: this.#now(),
        currentStep: "Checking the visible browser after the student returned",
        handoff: null,
      });
      this.#updateProfileState("scanning");
      return this.#run(resumed, "The student has returned after the requested handoff. Take a fresh browser snapshot. If login still blocks the assignment list, request another handoff and stop. If this is a linked homework system, list the student's assignments or confirm an empty assignment index before recording it verified. Account names and dashboards are not verification. Then continue the same scan.");
    });
  }

  async requestTakeover(): Promise<SchoolOnboardingState> {
    this.#assertUsable();
    const scan = this.#store.school.latestScan();
    if (!scan || scan.state !== "running") throw new Error("No school scan is driving the browser");
    const evidence = await this.#takeoverEvidence(scan);
    this.#store.school.putScan({
      ...scan,
      state: "needs_user",
      updatedAt: this.#now(),
      currentStep: "You have the page.",
      handoff: {
        kind: "student_takeover",
        reason: "You asked for the page.",
        requestedAt: this.#now(),
        evidence,
      },
    });
    this.#updateProfileState("needs_sign_in");
    await this.#session?.abort();
    return this.state();
  }

  async recordMissedCourseFeedback(rawFeedback: string): Promise<SchoolOnboardingState> {
    this.#assertUsable();
    const feedback = rawFeedback.replace(/\s+/g, " ").trim();
    if (!feedback || feedback.length > 500) {
      throw new TypeError("Missed-course feedback must contain 1 to 500 characters");
    }
    const profile = this.#requiredProfile();
    const nextFeedback = [...new Set([...profile.missedCourseFeedback, feedback])].slice(-20);
    this.#store.school.putProfile({ ...profile, missedCourseFeedback: nextFeedback, updatedAt: this.#now() });

    await this.#store.notes.upsert({
      scope: "school",
      subjectId: profile.profileId,
      about: "scan",
      key: "student-corrections",
      title: "Student scan corrections",
      content: nextFeedback.map((item) => `- ${item}`).join("\n"),
      updatedAt: this.#now(),
    });
    return this.state();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#session?.dispose();
    this.#session = null;
    this.#sessionScanId = null;
  }

  async #start(kind: SchoolScan["kind"], workflow: SchoolScanWorkflow | null = null): Promise<SchoolOnboardingState> {
    this.#assertUsable();
    const profile = this.#requiredProfile();
    const latest = this.#store.school.latestScan();
    if (latest?.state === "running" || latest?.state === "needs_user") {
      throw new Error("The current school scan must finish or resume before another scan starts");
    }

    this.#session?.dispose();
    this.#session = null;
    this.#sessionScanId = null;
    const startedAt = this.#now();
    const scan = this.#store.school.putScan({
      schemaVersion: STUDI_SCHEMA_VERSION,
      scanId: `scan-${randomUUID()}`,
      kind,
      state: "running",
      startedAt,
      updatedAt: startedAt,
      currentStep: "Opening the school root in the visible browser",
      coverage: [],
      failures: [],
      handoff: null,
      observedCourseIds: [],
      observedAssignmentIds: [],
      observedLinkedSystemIds: [],
    });
    this.#updateProfileState("scanning");

    try {
      await this.#browser.navigate(profile.schoolRoot);
    } catch (error) {
      this.#fail(scan.scanId, `The school root could not open: ${errorMessage(error)}`);
      return this.state();
    }

    const noteEntries = retrieveNoteIndex(this.#store.notes.list(), { kind: "scan", schoolId: profile.profileId });
    const noteBodies = await Promise.all(noteEntries.map(async (entry) => ({ entry, document: await this.#store.notes.read(entry.noteId) })));
    const notes = noteBodies.flatMap(({ entry, document }) => document
      ? [`## ${entry.title}\n${document.content}`]
      : []).join("\n\n") || "No school scan notes are stored.";
    const gaps = latest?.failures.length
      ? latest.failures.map((failure) => `- ${failure}`).join("\n")
      : "- No unresolved prior scan gaps.";
    const linkedSystems = this.#store.school.listLinkedSystems();
    const linked = linkedSystems.length
      ? linkedSystems.map((system) => `- ${system.label}: ${system.state}; ${system.sourceTarget}`).join("\n")
      : "- None discovered yet.";
    const priorWorkflow = kind === "replay" && workflow
      ? `\n\n# Structured replay hints\n${JSON.stringify({ revision: workflow.revision, root: workflow.root, steps: workflow.steps, coverageTargets: workflow.coverageTargets })}\n\nThese typed locations are navigation hints only. Re-observe every target and use record tools for every current claim; prior completion is never evidence.`
      : "";
    return this.#run(
      scan,
      `Scan the visible school from its root. This turn was started by a typed ${kind === "replay" ? "replay" : "first-scan"} intent. Verify school sign-in through the page, then discover courses and assignments. When one page shows several assignments, record them together with scan_record_assignments; do not make one tool call per assignment. Record a linked system only when it is a place teachers put assignments and deadlines and this scan can list the student's homework there. Account names, profile menus, and dashboards are not verification. Do not mark coverage failed because a submit or autograde page is not an assignment catalog. Request a sign-in handoff only when login blocks that list. Record explicit coverage before finishing.\n\n# School scan notes\n${notes}\n\n# Prior gaps\n${gaps}\n\n# Known linked systems\n${linked}${priorWorkflow}`,
    );
  }

  async #run(scan: SchoolScan, prompt: string): Promise<SchoolOnboardingState> {
    let session = this.#session;
    if (!session || this.#sessionScanId !== scan.scanId) {
      session?.dispose();
      session = await this.#runtime.createScanSession(this.#createRecordingTools(scan.scanId));
      this.#session = session;
      this.#sessionScanId = scan.scanId;
    }

    let terminalOutcome: "completed" | "failed" | "aborted" | null = null;
    const unsubscribe = session.subscribe((event: AgentRunEvent) => {
      if (event.type === "terminal") terminalOutcome = event.outcome;
    });
    try {
      await session.prompt(prompt);
    } catch (error) {
      const current = this.#store.school.getScan(scan.scanId);
      if (current?.state === "running") this.#fail(scan.scanId, `The scan agent stopped: ${errorMessage(error)}`);
    } finally {
      unsubscribe();
    }

    const current = this.#store.school.getScan(scan.scanId);
    if (current?.state === "running") {
      const reason = terminalOutcome === "aborted"
        ? "The school scan was aborted before it recorded coverage."
        : terminalOutcome === "failed"
          ? "The school scan agent failed before it recorded coverage."
          : "The school scan ended without the finish tool and remains incomplete.";
      this.#fail(scan.scanId, reason);
    }
    const finished = this.#store.school.getScan(scan.scanId);
    if (finished && finished.state !== "needs_user") {
      this.#session?.dispose();
      this.#session = null;
      this.#sessionScanId = null;
    }
    return this.state();
  }

  #createRecordingTools(scanId: string): ToolDefinition[] {
    const recordCourse = defineTool({
      name: "scan_record_course",
      label: "Record verified course",
      description: "Record one course from a fresh snapshot of the current visible page.",
      parameters: Type.Object({
        label: Type.String({ minLength: 1, maxLength: 300 }),
        courseKey: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
        observationRef: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
      }, { additionalProperties: false }),
      execute: async (_toolCallId, input) => {
        const scan = this.#requiredRunningScan(scanId);
        const snapshot = await this.#browser.snapshot();
        const observation = requireSnapshotFact(snapshot, input.label, input.observationRef, "course label");
        const evidence = this.#evidence(scanId, snapshot, `Observed course ${input.label.trim()} in ${observation}.`);
        const courseId = stableId("course", input.courseKey ?? `${snapshot.url}|${input.label.trim()}`);
        const course = this.#store.school.putCourse({
          schemaVersion: STUDI_SCHEMA_VERSION,
          courseId,
          label: input.label.trim(),
          sourceTarget: evidence.sourceTarget,
          lastVerifiedScanId: scanId,
          lastVerifiedAt: evidence.capturedAt,
          evidence,
        });
        this.#store.school.putScan({
          ...scan,
          updatedAt: this.#now(),
          currentStep: `Verified course: ${course.label}`,
          observedCourseIds: addUnique(scan.observedCourseIds, course.courseId),
        });
        return toolResult(course);
      },
    });

    const assignmentParameters = Type.Object({
      courseId: Type.String({ minLength: 1, maxLength: 256 }),
      title: Type.String({ minLength: 1, maxLength: 500 }),
      assignmentKey: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
      dueAt: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
      dueText: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      observationRef: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    }, { additionalProperties: false });
    const persistAssignments = async (inputs: readonly {
      readonly courseId: string;
      readonly title: string;
      readonly assignmentKey?: string;
      readonly dueAt?: string;
      readonly dueText?: string;
      readonly observationRef?: string;
    }[]) => {
      const scan = this.#requiredRunningScan(scanId);
      const snapshot = await this.#browser.snapshot();
      const assignments = inputs.map((input) => {
        if (!scan.observedCourseIds.includes(input.courseId)) {
          throw new Error("The assignment's course has not been verified in this scan");
        }
        const observation = requireSnapshotFact(snapshot, input.title, input.observationRef, "assignment title");
        const dueAt = input.dueAt === undefined
          ? undefined
          : requireObservedDueAt(snapshot, input.dueAt, input.dueText, input.observationRef);
        const evidence = this.#evidence(scanId, snapshot, `Observed assignment ${input.title.trim()} in ${observation}.`);
        const assignmentId = stableId(
          "assignment",
          `${input.courseId}|${input.assignmentKey ?? `${snapshot.url}|${input.title.trim()}`}`,
        );
        const assignment = this.#store.assignments.put({
          schemaVersion: STUDI_SCHEMA_VERSION,
          assignmentId,
          courseId: input.courseId,
          title: input.title.trim(),
          sourceTarget: evidence.sourceTarget,
          ...(dueAt === undefined ? {} : { dueAt }),
          discoveredAt: evidence.capturedAt,
          lastVerifiedScanId: scanId,
          evidence: [evidence],
        });
        this.#ensureTaskOrigin(assignment, scanId);
        return assignment;
      });
      this.#store.school.putScan({
        ...scan,
        updatedAt: this.#now(),
        currentStep: assignments.length === 1
          ? `Verified assignment: ${assignments[0]!.title}`
          : `Verified ${assignments.length} assignments on the current page`,
        observedAssignmentIds: assignments.reduce(
          (ids, assignment) => addUnique(ids, assignment.assignmentId),
          scan.observedAssignmentIds,
        ),
      });
      return assignments;
    };

    const recordAssignment = defineTool({
      name: "scan_record_assignment",
      label: "Record verified assignment",
      description: "Record one assignment from a fresh snapshot. Prefer scan_record_assignments whenever this page lists more than one. The course must already be verified in this scan.",
      parameters: assignmentParameters,
      execute: async (_toolCallId, input) => {
        const [assignment] = await persistAssignments([input]);
        return toolResult(assignment);
      },
    });

    const recordAssignments = defineTool({
      name: "scan_record_assignments",
      label: "Record assignments on this page",
      description: "Record every assignment visible in one fresh snapshot with one call. Each course must already be verified in this scan.",
      parameters: Type.Object({
        assignments: Type.Array(assignmentParameters, { minItems: 1, maxItems: 100 }),
      }, { additionalProperties: false }),
      execute: async (_toolCallId, input) => toolResult(await persistAssignments(input.assignments)),
    });

    const recordLinkedSystem = defineTool({
      name: "scan_record_linked_system",
      label: "Record linked school system",
      description: "Record a linked assignment source. Use needs_user only when login is blocking the student's assignment list. Use verified only after this scan listed at least one assignment from this page's origin, or the current page shows an empty assignment index. Account names and dashboards are not verification.",
      parameters: Type.Object({
        label: Type.String({ minLength: 1, maxLength: 300 }),
        systemKey: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
        state: Type.Union([Type.Literal("needs_user"), Type.Literal("verified")]),
        observationRef: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
        stateText: Type.String({ minLength: 1, maxLength: 300 }),
        stateObservationRef: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
      }, { additionalProperties: false }),
      execute: async (_toolCallId, input) => {
        const scan = this.#requiredRunningScan(scanId);
        const snapshot = await this.#browser.snapshot();
        const labelObservation = requireSnapshotFact(snapshot, input.label, input.observationRef, "linked-system label");
        const stateObservation = requireSnapshotFact(snapshot, input.stateText, input.stateObservationRef, "linked-system state");
        requireLinkedSystemStateFact({
          state: input.state,
          stateText: input.stateText,
          scan,
          snapshot,
          getAssignment: (assignmentId) => this.#store.assignments.get(assignmentId),
        });
        const evidence = this.#evidence(
          scanId,
          snapshot,
          input.state === "verified"
            ? `Observed linked system ${input.label.trim()} in ${labelObservation}; assignment inventory is backed by “${input.stateText.trim()}” in ${stateObservation}.`
            : `Observed linked system ${input.label.trim()} in ${labelObservation}; ${input.state} is backed by “${input.stateText.trim()}” in ${stateObservation}.`,
        );
        const linkedSystemId = stableId("linked", input.systemKey ?? `${snapshot.url}|${input.label.trim()}`);
        const existing = this.#store.school.getLinkedSystem(linkedSystemId);
        const system = this.#store.school.putLinkedSystem({
          schemaVersion: STUDI_SCHEMA_VERSION,
          linkedSystemId,
          label: input.label.trim(),
          sourceTarget: evidence.sourceTarget,
          state: input.state,
          lastObservedScanId: scanId,
          ...(input.state === "verified"
            ? { lastVerifiedScanId: scanId }
            : existing?.lastVerifiedScanId
              ? { lastVerifiedScanId: existing.lastVerifiedScanId }
              : {}),
          lastObservedAt: evidence.capturedAt,
          evidence,
        });
        this.#store.school.putScan({
          ...scan,
          updatedAt: this.#now(),
          currentStep: input.state === "verified"
            ? `Verified linked system: ${system.label}`
            : `Linked system needs sign-in: ${system.label}`,
          observedLinkedSystemIds: addUnique(scan.observedLinkedSystemIds, system.linkedSystemId),
        });
        return toolResult(system);
      },
    });

    const requestHandoff = defineTool({
      name: "scan_request_handoff",
      label: "Request student sign-in",
      description: "Pause the scan for a school or linked-system sign-in in the visible browser. Stop after this tool succeeds.",
      parameters: Type.Object({
        kind: Type.Union([Type.Literal("school_sign_in"), Type.Literal("linked_system_sign_in")]),
        linkedSystemId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
        reason: Type.String({ minLength: 1, maxLength: 500 }),
      }, { additionalProperties: false }),
      execute: async (_toolCallId, input) => {
        const scan = this.#requiredRunningScan(scanId);
        if (input.kind === "linked_system_sign_in") {
          if (!input.linkedSystemId || !scan.observedLinkedSystemIds.includes(input.linkedSystemId)) {
            throw new Error("A linked-system handoff requires a linked system observed in this scan");
          }
        }
        const snapshot = await this.#browser.snapshot();
        const evidence = this.#evidence(scanId, snapshot, "Observed a page that requires the student's sign-in.");
        let next = this.#store.school.putScan({
          ...scan,
          state: "needs_user",
          updatedAt: this.#now(),
          currentStep: input.reason.trim(),
          handoff: {
            kind: input.kind,
            ...(input.linkedSystemId === undefined ? {} : { linkedSystemId: input.linkedSystemId }),
            reason: input.reason.trim(),
            requestedAt: this.#now(),
            evidence,
          },
        });
        this.#updateProfileState("needs_sign_in");
        return toolResult(next);
      },
    });

    const finish = defineTool({
      name: "scan_finish",
      label: "Finish school scan",
      description: "Finish with explicit coverage. At least one course must have been verified in this scan.",
      parameters: Type.Object({
        coverage: Type.Array(Type.Object({
          target: Type.String({ minLength: 1, maxLength: 200 }),
          status: Type.Union([Type.Literal("verified"), Type.Literal("partial"), Type.Literal("failed")]),
          failure: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
        }, { additionalProperties: false }), { minItems: 1, maxItems: 500 }),
        navigationHints: Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 50 }),
      }, { additionalProperties: false }),
      execute: async (_toolCallId, input) => {
        const scan = this.#requiredRunningScan(scanId);
        if (scan.observedCourseIds.length === 0) {
          this.#fail(scanId, "The scan found no browser-verified courses. Nothing was marked complete.");
          throw new Error("A scan cannot complete without at least one browser-verified course");
        }
        const observedCoverage = this.#verifiedCoverage(scan);
        const requestedCoverage = input.coverage.flatMap((item) => {
          if (item.status === "verified") {
            if (!observedCoverage.some((observed) => sameFact(observed.target, item.target))) {
              throw new Error(`Verified coverage must name an entity recorded in this scan: ${item.target.trim()}`);
            }
            return [];
          }
          if (!item.failure?.trim()) {
            throw new Error(`Coverage ${item.target} requires a failure reason`);
          }
          return [{
            target: item.target.trim(),
            status: item.status,
            failure: item.failure.trim(),
          }];
        });
        const coverage = [...observedCoverage, ...requestedCoverage];
        const linkedNeedsUser = this.#store.school.listLinkedSystems().some(
          (system) => scan.observedLinkedSystemIds.includes(system.linkedSystemId) && system.state === "needs_user",
        );
        const failures = coverage.flatMap((item) => item.status === "verified" ? [] : [item.failure!]);
        const succeeded = failures.length === 0 && !linkedNeedsUser;
        const completedAt = this.#now();
        let next = this.#store.school.putScan({
          ...scan,
          state: succeeded ? "succeeded" : "partial",
          updatedAt: completedAt,
          completedAt,
          currentStep: succeeded ? "School scan completed with current browser evidence" : "School scan preserved partial results",
          coverage,
          failures: linkedNeedsUser ? addUnique(failures, "A linked system still needs the student to sign in.") : failures,
          handoff: null,
        });
        this.#updateProfileState(succeeded ? "ready" : linkedNeedsUser ? "needs_sign_in" : "profile_saved");
        if (succeeded) {
          try {
            await this.#writeWorkflowHints(scanId, input.navigationHints);
          } catch (error) {
            const reason = `The scan results were saved, but the replay workflow could not be written: ${errorMessage(error)}`;
            next = this.#store.school.putScan({
              ...next,
              state: "partial",
              currentStep: reason,
              failures: addUnique(next.failures, reason),
            });
            this.#updateProfileState("profile_saved");
          }
        }
        return toolResult(next);
      },
    });

    return [recordCourse, recordAssignment, recordAssignments, recordLinkedSystem, requestHandoff, finish];
  }

  #ensureTaskOrigin(assignment: Assignment, scanId: string): void {
    const existing = this.#store.tasks.listAll().find((task) => task.assignmentId === assignment.assignmentId);
    const task = existing ?? this.#createTaskOrigin(assignment, scanId);
    if (!this.#manager || (task.state !== "discovered" && task.state !== "queued")) return;
    const permission = this.#manager.resolvePermission(assignment.assignmentId, assignment.courseId);
    if (permission.mayAttempt) this.#manager.enqueue({ taskId: task.taskId });
  }

  #createTaskOrigin(assignment: Assignment, scanId: string) {
    const occurredAt = this.#now();
    const taskId = stableId("task", assignment.assignmentId);
    const task = {
      schemaVersion: STUDI_SCHEMA_VERSION,
      taskId,
      assignmentId: assignment.assignmentId,
      state: "discovered" as const,
      revision: 0,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };
    return this.#store.tasks.append({
      expectedRevision: null,
      projection: task,
      event: {
        schemaVersion: STUDI_SCHEMA_VERSION,
        eventId: `event-${randomUUID()}`,
        aggregateType: "task",
        aggregateId: taskId,
        runId: scanId,
        sequence: 0,
        occurredAt,
        type: "task_created",
        payload: {
          taskId,
          assignmentId: assignment.assignmentId,
          state: "discovered",
          revision: 0,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      },
    });
  }

  #verifiedCoverage(scan: SchoolScan) {
    const courses = scan.observedCourseIds.flatMap((courseId) => {
      const course = this.#store.school.listCourses().find((candidate) => candidate.courseId === courseId);
      return course?.lastVerifiedScanId === scan.scanId
        ? [{ target: `Course: ${course.label}`, status: "verified" as const, evidence: course.evidence }]
        : [];
    });
    const assignments = scan.observedAssignmentIds.flatMap((assignmentId) => {
      const assignment = this.#store.assignments.get(assignmentId);
      const evidence = assignment?.lastVerifiedScanId === scan.scanId ? assignment.evidence.at(-1) : undefined;
      return assignment && evidence
        ? [{ target: `Assignment: ${assignment.title}`, status: "verified" as const, evidence }]
        : [];
    });
    const linkedSystems = scan.observedLinkedSystemIds.flatMap((linkedSystemId) => {
      const system = this.#store.school.getLinkedSystem(linkedSystemId);
      return system?.lastVerifiedScanId === scan.scanId
        ? [{ target: `Linked system: ${system.label}`, status: "verified" as const, evidence: system.evidence }]
        : [];
    });
    return [...courses, ...assignments, ...linkedSystems];
  }

  #requiredProfile(): SchoolProfile {
    const profile = this.#store.school.getProfile();
    if (!profile) throw new Error("Save the local school profile before scanning");
    return profile;
  }

  #requiredRunningScan(scanId: string): SchoolScan {
    const scan = this.#store.school.getScan(scanId);
    if (!scan || scan.state !== "running") {
      throw new Error("This scan is no longer accepting browser evidence");
    }
    return scan;
  }

  async #takeoverEvidence(scan: SchoolScan): Promise<EvidenceReference> {
    try {
      return this.#evidence(scan.scanId, await this.#browser.snapshot(), "Student asked to take over the visible page.");
    } catch {
      const profile = this.#requiredProfile();
      const evidenceId = `evidence-${scan.scanId}-takeover-${randomUUID()}`;
      return {
        schemaVersion: STUDI_SCHEMA_VERSION,
        evidenceId,
        reference: evidenceId,
        kind: "agent_observation",
        sourceTarget: profile.schoolRoot,
        capturedAt: this.#now(),
        summary: "Student asked to take over the visible page.",
      };
    }
  }

  #evidence(scanId: string, snapshot: BrowserSnapshot, summary: string): EvidenceReference {
    const sourceTarget = SafeSourceTargetSchema.parse(snapshot.url);
    const evidenceId = `evidence-${scanId}-${snapshot.revision}-${randomUUID()}`;
    return {
      schemaVersion: STUDI_SCHEMA_VERSION,
      evidenceId,
      reference: evidenceId,
      kind: "agent_observation",
      sourceTarget,
      capturedAt: this.#now(),
      summary,
    };
  }

  #fail(scanId: string, reason: string): void {
    const scan = this.#store.school.getScan(scanId);
    if (!scan || scan.state !== "running") return;
    const completedAt = this.#now();
    this.#store.school.putScan({
      ...scan,
      state: "failed",
      updatedAt: completedAt,
      completedAt,
      currentStep: reason,
      failures: addUnique(scan.failures, reason),
      handoff: null,
    });
    this.#updateProfileState("profile_saved");
  }

  #updateProfileState(onboardingState: SchoolProfile["onboardingState"]): void {
    const profile = this.#store.school.getProfile();
    if (profile) this.#store.school.putProfile({ ...profile, onboardingState, updatedAt: this.#now() });
  }

  async #writeWorkflowHints(scanId: string, hints: readonly string[]): Promise<void> {
    const scan = this.#store.school.getScan(scanId);
    if (!scan || scan.state !== "succeeded") return;
    const profile = this.#requiredProfile();
    const normalizedHints = [...new Set(hints.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 50);
    await this.#store.notes.upsert({
      scope: "school",
      subjectId: profile.profileId,
      about: "scan",
      key: "navigation",
      title: "Observed school navigation hints",
      content: (normalizedHints.length ? normalizedHints : ["Start from the school root."]).map((item) => `- ${item}`).join("\n"),
      updatedAt: this.#now(),
    });
    const existing = this.#store.school.getWorkflow();
    const observedTargets = [
      { target: profile.schoolRoot, purpose: "Open the school root" },
      ...scan.observedCourseIds.flatMap((courseId) => {
        const course = this.#store.school.listCourses().find((candidate) => candidate.courseId === courseId);
        return course ? [{ target: course.sourceTarget, purpose: `Re-observe course: ${course.label}` }] : [];
      }),
      ...scan.observedLinkedSystemIds.flatMap((linkedSystemId) => {
        const system = this.#store.school.getLinkedSystem(linkedSystemId);
        return system ? [{ target: system.sourceTarget, purpose: `Re-observe linked system: ${system.label}` }] : [];
      }),
    ];
    const seenTargets = new Set<string>();
    const steps = observedTargets.filter(({ target }) => {
      if (seenTargets.has(target)) return false;
      seenTargets.add(target);
      return true;
    }).map(({ target, purpose }) => ({ kind: "navigate" as const, target, purpose }));
    this.#store.school.putWorkflow({
      schemaVersion: STUDI_SCHEMA_VERSION,
      workflowId: "school-scan",
      schoolId: profile.profileId,
      revision: (existing?.revision ?? 0) + 1,
      root: profile.schoolRoot,
      steps,
      coverageTargets: scan.coverage.map((item) => item.target),
      compiledFromScanId: scan.scanId,
      updatedAt: this.#now(),
    });
  }

  async #repairReplayArtifact(): Promise<void> {
    const scan = this.#store.school.latestScan();
    const replayFailurePrefix = "The scan results were saved, but the replay workflow could not be written:";
    if (!scan || scan.state !== "partial" || !scan.failures.some((failure) => failure.startsWith(replayFailurePrefix))) return;
    const remainingFailures = scan.failures.filter((failure) => !failure.startsWith(replayFailurePrefix));
    if (remainingFailures.length > 0 || scan.coverage.some((item) => item.status !== "verified")) return;
    if (this.#store.school.listLinkedSystems().some((system) => system.state === "needs_user")) return;
    const repairedAt = this.#now();
    this.#store.school.putScan({
      ...scan,
      state: "succeeded",
      updatedAt: repairedAt,
      currentStep: "School scan completed with current browser evidence",
      failures: [],
    });
    try {
      await this.#writeWorkflowHints(scan.scanId, []);
      this.#updateProfileState("ready");
    } catch (error) {
      const reason = `${replayFailurePrefix} ${errorMessage(error)}`;
      this.#store.school.putScan({
        ...scan,
        updatedAt: repairedAt,
        currentStep: reason,
        failures: [reason],
      });
    }
  }

  #assertUsable(): void {
    if (this.#disposed) throw new Error("School scan coordinator is disposed");
  }
}

function stableId(prefix: string, value: string): string {
  const digest = createHash("sha256").update(value.trim()).digest("hex").slice(0, 24);
  return `${prefix}-${digest}`;
}

function addUnique<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? [...values] : [...values, value];
}

function normalizeFact(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function sameFact(left: string, right: string): boolean {
  const normalizedLeft = normalizeFact(left).replace(/^(course|assignment|linked system) /, "");
  const normalizedRight = normalizeFact(right).replace(/^(course|assignment|linked system) /, "");
  return normalizedLeft === normalizedRight;
}

function includesFact(observation: string, fact: string): boolean {
  const normalizedObservation = normalizeFact(observation);
  const normalizedFact = normalizeFact(fact);
  return normalizedFact.length > 0 && normalizedObservation.includes(normalizedFact);
}

function requireSnapshotFact(
  snapshot: BrowserSnapshot,
  fact: string,
  requestedRef: string | undefined,
  label: string,
): string {
  if (requestedRef) {
    const element = snapshot.elements.find((candidate) => candidate.ref === requestedRef);
    if (!element) throw new Error(`Current snapshot does not contain ref ${requestedRef} for the ${label}`);
    const observation = `${element.name} ${element.value ?? ""}`;
    if (!includesFact(observation, fact)) {
      throw new Error(`Current snapshot ref ${requestedRef} does not contain the claimed ${label}`);
    }
    return `current snapshot ref ${requestedRef}`;
  }
  const element = snapshot.elements.find((candidate) => includesFact(`${candidate.name} ${candidate.value ?? ""}`, fact));
  if (element) return `current snapshot ref ${element.ref}`;
  if (includesFact(`${snapshot.title}\n${snapshot.text}`, fact)) return "current snapshot text";
  throw new Error(`Current snapshot does not contain the claimed ${label}`);
}

function requireObservedDueAt(
  snapshot: BrowserSnapshot,
  dueAt: string,
  dueText: string | undefined,
  observationRef: string | undefined,
): string {
  if (!dueText) throw new Error("A due date requires the exact visible due-date text from the current snapshot");
  requireSnapshotFact(snapshot, dueText, observationRef, "assignment due date");
  const parsedDueAt = Date.parse(dueAt);
  const parsedDueText = Date.parse(dueText);
  if (!Number.isFinite(parsedDueAt) || !Number.isFinite(parsedDueText) || parsedDueAt !== parsedDueText) {
    throw new Error("The claimed due date does not match the visible due-date text");
  }
  return new Date(parsedDueAt).toISOString();
}

function requireLinkedSystemStateFact(input: {
  readonly state: "needs_user" | "verified";
  readonly stateText: string;
  readonly scan: SchoolScan;
  readonly snapshot: BrowserSnapshot;
  readonly getAssignment: (assignmentId: string) => Assignment | null | undefined;
}): void {
  const fact = normalizeFact(input.stateText);
  if (input.state === "needs_user") {
    const markers = ["sign in", "log in", "login", "authenticate", "session expired", "access denied"];
    if (!markers.some((marker) => fact.includes(marker))) {
      throw new Error("The visible linked-system state text does not prove needs_user");
    }
    return;
  }
  const pageFact = normalizeFact(`${input.snapshot.title}\n${input.snapshot.text}`);
  if (contradictsVerifiedLinkedSystemState(fact) || contradictsVerifiedLinkedSystemState(pageFact)) {
    throw new Error("The visible linked-system state text contradicts verified");
  }
  const listedFromOrigin = input.scan.observedAssignmentIds.some((assignmentId) => {
    const assignment = input.getAssignment(assignmentId);
    return Boolean(assignment && sameOrigin(assignment.sourceTarget, input.snapshot.url));
  });
  if (listedFromOrigin || isEmptyAssignmentIndex(fact)) return;
  throw new Error("A linked system is verified only after this scan lists its assignments or shows an empty assignment list");
}

function sameOrigin(left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return leftUrl.protocol === rightUrl.protocol && leftUrl.host === rightUrl.host;
  } catch {
    return false;
  }
}

function isEmptyAssignmentIndex(fact: string): boolean {
  return ["no assignments", "no homework", "nothing due", "0 assignments", "no due dates"]
    .some((marker) => fact.includes(marker));
}

function contradictsVerifiedLinkedSystemState(fact: string): boolean {
  return /\b(?:not|never)(?: \S+){0,2} (?:signed|logged) in\b/u.test(fact)
    || ["signed out", "logged out", "sign in required", "log in required", "login required", "session expired", "access denied"]
      .some((marker) => fact.includes(marker));
}

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: value,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
