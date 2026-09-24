import { createHash, randomUUID } from "node:crypto";

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  SafeSourceTargetSchema,
  LEGACY_SCAN_TOOL_NAMES,
  SCAN_TOOL_NAMES,
  SchoolOnboardingStateSchema,
  SchoolScanSchema,
  STUDI_SCHEMA_VERSION,
  assignmentWorkEligibility,
  classifyAgentRuntimeAttention,
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
import type { AgentSession, AgentSessionTarget, ScanSessionControl } from "../agent/runtime.js";
import type { BrowserController } from "../browser/controller.js";
import { autofillLtiLaunchHost, autofillSignInHosts, type ScanReadOnlyGuard } from "../browser/read-only-guard.js";
import { VisibleBrowserWork } from "../browser/work-ownership.js";
import type { ManagerCoordinator } from "../manager/coordinator.js";
import type { LocalStore } from "../storage/index.js";
import { reconcileAssignments } from "../storage/assignment-reconciliation.js";
import { courseIdentity, courseObservations, reconcileCourses } from "../storage/course-reconciliation.js";
import { resolveRecordId } from "../storage/redirects.js";
import { assignmentIdentity, exactTarget, isMoodleIndex, normalize, observedTarget, schoolIdentity } from "./source-identity.js";
import { createSourceCheckpointTools } from "./source-checkpoints.js";
import { createScanMaterialReader } from "./materials.js";
import { parseZonedDeadline } from "./zoned-deadline.js";
import { parseDueDate } from "../../shared/due-date.js";
import { runSchoolConnector, type ConnectorAssignmentRow } from "./connectors/index.js";
import { assignmentScanChange, mergeScanChange, removedScanChanges } from "./refresh-diff.js";

export interface ScanSessionRuntime {
  createScanSession(
    recordingTools: readonly ToolDefinition[],
    target?: AgentSessionTarget,
    control?: ScanSessionControl,
  ): Promise<AgentSession>;
}

export class SchoolScanCoordinator {
  readonly #store: LocalStore;
  readonly #runtime: ScanSessionRuntime;
  readonly #browser: BrowserController;
  readonly #browserWork: VisibleBrowserWork;
  readonly #readOnlyGuard: Pick<ScanReadOnlyGuard, "setScanActive" | "setAllowedHosts"> | undefined;
  readonly #manager: Pick<ManagerCoordinator, "enqueue" | "resolvePermission" | "reconcileQueue" | "allowsAutomaticWork"> | null;
  readonly #now: () => string;
  readonly #ownerSubject: string | undefined;
  readonly #onError: (error: unknown, scanId: string, toolName?: string) => void;
  readonly #recordSyllabus: ((source: { courseId: string; title: string; text: string; sourceTarget: string }) => Promise<unknown>) | undefined;
  #session: AgentSession | null = null;
  #sessionScanId: string | null = null;
  #disposed = false;
  #takingOver = false;
  #sourceChecksThisSession = 0;
  #rotateSession = false;
  #lastConnectorSignedIn = false;
  readonly #maxSourcesPerSession: number;
  readonly #maxSessionsPerRun: number;
  readonly #activeLimitMs: number;
  readonly #idleLimitMs: number;
  readonly #watchdogIntervalMs: number;
  readonly #pendingMessages = new Set<string>();

  constructor(
    store: LocalStore,
    runtime: ScanSessionRuntime,
    browser: BrowserController,
    options: {
      readonly now?: () => string;
      readonly ownerSubject?: string;
      readonly browserWork?: VisibleBrowserWork;
      readonly readOnlyGuard?: Pick<ScanReadOnlyGuard, "setScanActive" | "setAllowedHosts">;
      readonly manager?: Pick<ManagerCoordinator, "enqueue" | "resolvePermission" | "reconcileQueue" | "allowsAutomaticWork">;
      readonly onError?: (error: unknown, scanId: string, toolName?: string) => void;
      readonly recordSyllabus?: (source: { courseId: string; title: string; text: string; sourceTarget: string }) => Promise<unknown>;
      readonly maxSourcesPerSession?: number;
      readonly maxSessionsPerRun?: number;
      readonly activeLimitMs?: number;
      readonly idleLimitMs?: number;
      readonly watchdogIntervalMs?: number;
    } = {},
  ) {
    this.#store = store;
    this.#runtime = runtime;
    this.#browser = browser;
    this.#browserWork = options.browserWork ?? new VisibleBrowserWork(store);
    this.#readOnlyGuard = options.readOnlyGuard;
    this.#manager = options.manager ?? null;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#ownerSubject = options.ownerSubject;
    this.#onError = options.onError ?? (() => undefined);
    this.#recordSyllabus = options.recordSyllabus;
    this.#maxSourcesPerSession = options.maxSourcesPerSession ?? 8;
    this.#maxSessionsPerRun = options.maxSessionsPerRun ?? 8;
    this.#activeLimitMs = options.activeLimitMs ?? 30 * 60_000;
    this.#idleLimitMs = options.idleLimitMs ?? 5 * 60_000;
    this.#watchdogIntervalMs = options.watchdogIntervalMs ?? 5_000;
    if (![this.#maxSourcesPerSession, this.#maxSessionsPerRun].every(value => Number.isInteger(value) && value >= 1 && value <= 100)) throw new Error("Scan session budgets must be integers between 1 and 100");
    if (![this.#activeLimitMs, this.#idleLimitMs, this.#watchdogIntervalMs].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("Scan time limits must be positive milliseconds");
    const savedProfile = store.school.getProfile();
    if (savedProfile && !savedProfile.onboardingCompletedAt) {
      const onboardingCompletedAt = store.school.completedOnboardingAt(savedProfile.schoolRoot);
      if (onboardingCompletedAt) store.school.putProfile({ ...savedProfile, onboardingCompletedAt });
    }
    const interrupted = store.school.latestScan();
    if (interrupted?.state === "running") {
      this.#fail(interrupted.scanId, "Studi stopped before the school scan finished. Continue this scan from its saved source checkpoints.");
    }
  }

  providerReconnected(): void {
    this.#assertUsable();
    const scan = this.#store.school.latestScan();
    if (scan?.state !== "failed" || classifyAgentRuntimeAttention(null, scan.failures[0] ?? scan.currentStep) !== "needs_login") return;
    const now = this.#now();
    // Keep the failure evidence while recording that a real sign-in resolved its blocker.
    this.#store.school.putScan({ ...scan, runtimeLoginRecoveredAt: now, updatedAt: now });
  }

  async state(): Promise<SchoolOnboardingState> {
    this.#assertUsable();
    await this.#repairReplayArtifact();
    const profile = this.#store.school.getProfile();
    const courses = this.#store.school.listCourses();
    const assignments = this.#store.assignments.listAll();
    const workflow = this.#store.school.getWorkflow();
    return SchoolOnboardingStateSchema.parse({
      profile,
      scan: this.#store.school.latestScan(),
      courses,
      assignments,
      assignmentConflicts: this.#store.assignmentConflicts,
      courseConflicts: this.#store.courseConflicts,
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
      ...(previous?.schoolRoot === input.schoolRoot && previous.onboardingCompletedAt ? { onboardingCompletedAt: previous.onboardingCompletedAt } : {}),
      missedCourseFeedback: previous?.missedCourseFeedback ?? [],
      ...(input.schoolTimeZone ?? previous?.schoolTimeZone ? { schoolTimeZone: input.schoolTimeZone ?? previous?.schoolTimeZone } : {}),
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

  async startScan(assignmentId?: string): Promise<SchoolOnboardingState> {
    return this.#browserWork.startScan(() => this.#withReadOnly(() => this.#start("first_scan", null, assignmentId)));
  }

  async startSourceScan(sourceTarget: string): Promise<SchoolOnboardingState> {
    const source = SafeSourceTargetSchema.parse(sourceTarget);
    return this.#browserWork.startScan(() => this.#withReadOnly(() => this.#start("first_scan", null, undefined, source)));
  }

  async replay(): Promise<SchoolOnboardingState> {
    return this.#browserWork.startScan(() => this.#withReadOnly(async () => {
      const workflow = this.#store.school.getWorkflow();
      if (!workflow) throw new Error("A successful school scan is required before replay");
      return this.#start("replay", workflow);
    }));
  }

  async runScheduledScan<T>(
    claimOccurrence: () => T | null,
    prepare: () => Promise<void>,
  ): Promise<{ readonly claim: T; readonly state: SchoolOnboardingState } | null> {
    return this.#browserWork.startScan(() => this.#withReadOnly(async () => {
      const claim = claimOccurrence();
      if (claim === null) return null;
      await prepare();
      const workflow = this.#store.school.getWorkflow();
      const state = await (workflow ? this.#start("replay", workflow) : this.#start("first_scan"));
      return { claim, state };
    }));
  }

  async resume(): Promise<SchoolOnboardingState> {
    return this.#browserWork.resumeScan(() => this.#withReadOnly(async () => {
      this.#assertUsable();
      const scan = this.#store.school.latestScan();
      if (!scan || !["needs_user", "partial", "failed"].includes(scan.state)) throw new Error("No incomplete school scan is available to resume");
      const resumed = this.#store.school.putScan({
        ...scan,
        ...(Date.parse(this.#now()) - Date.parse(scan.updatedAt) > 24 * 60 * 60 * 1000
          ? { inventories: [], observedCourseIds: [], observedAssignmentIds: [], observedLinkedSystemIds: [] } : {}),
        state: "running",
        updatedAt: this.#now(),
        currentStep: "Checking the visible browser after the student returned",
        handoff: null,
        completedAt: undefined,
        failures: [],
        coverage: [],
      });
      this.#updateProfileState("scanning");
      if (!resumed.targetAssignmentId && !resumed.sourceScanTarget && typeof this.#browser.evaluateInPage === "function") {
        if (scan.handoff?.kind === "school_sign_in" && new URL(this.#browser.state.url).origin !== new URL(this.#requiredProfile().schoolRoot).origin) {
          await this.#browser.navigate(this.#requiredProfile().schoolRoot);
        }
        const complete = await this.#ingestConnector(resumed.scanId, this.#requiredProfile());
        if (this.#lastConnectorSignedIn) this.#learnSignInHosts("needs_you");
        if (complete) {
          await this.#finishStructured(resumed.scanId);
          return this.state();
        }
      }
      return this.#run(resumed, "The student has returned after the requested handoff. Take a fresh browser snapshot and continue the same scan. Continue only unchecked courses and systems; retain recorded rows. If sign-in still blocks a system, request a handoff for it.");
    }));
  }

  async requestTakeover(): Promise<SchoolOnboardingState> {
    this.#assertUsable();
    const scan = this.#store.school.latestScan();
    if (!scan || scan.state !== "running") throw new Error("No school scan is driving the browser");
    this.#takingOver = true;
    this.#readOnlyGuard?.setScanActive(false);
    const evidence = await this.#takeoverEvidence(scan);
    const latest = this.#store.school.getScan(scan.scanId) ?? scan;
    this.#store.school.putScan({
      ...latest,
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
    this.#takingOver = false;
    this.#updateProfileState("needs_sign_in");
    await this.#session?.abort();
    return this.state();
  }

  async sendMessage(input: { scanId: string; text: string; clientMessageId: string }): Promise<SchoolOnboardingState> {
    this.#assertUsable();
    const scan = this.#store.school.latestScan();
    if (!scan || scan.scanId !== input.scanId || !["running", "needs_user"].includes(scan.state)) throw new Error("This school check has ended. Start another check to add instructions.");
    if (scan.messages.some(message => message.clientMessageId === input.clientMessageId)) return this.state();
    const text = input.text.trim();
    if (!text || text.length > 20000) throw new Error("Write a message of up to 20,000 characters.");
    if (scan.state === "running" && !this.#session?.steer) throw new Error("The school check is still starting. Try again in a moment.");
    if (this.#pendingMessages.has(input.clientMessageId)) throw new Error("That message is still being delivered.");
    this.#pendingMessages.add(input.clientMessageId);
    try {
      if (scan.state === "running") await this.#session!.steer!(text);
      const latest = this.#store.school.getScan(scan.scanId)!;
      this.#store.school.putScan({...latest, messages:[...latest.messages, {messageId:randomUUID(), role:"user", text, clientMessageId:input.clientMessageId, createdAt:this.#now()}]});
      return this.state();
    } finally { this.#pendingMessages.delete(input.clientMessageId); }
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
    const scan = this.#store.school.latestScan();
    if (scan?.state === "running") this.#fail(scan.scanId, "Studi closed before the school scan finished. Saved discoveries are preserved.");
    this.#disposed = true;
    this.#readOnlyGuard?.setScanActive(false);
    this.#session?.dispose();
    this.#session = null;
    this.#sessionScanId = null;
  }

  async startMaterialsScan(courseId: string): Promise<SchoolOnboardingState> {
    const course = this.#store.school.listCourses().find(item => item.courseId === this.#store.school.resolveCourseId(courseId));
    if (!course) throw new Error("Choose a saved class before finding study material");
    return this.#browserWork.startScan(() => this.#withReadOnly(() => this.#start("first_scan", null, undefined, undefined, course.courseId)));
  }

  async finishWithFound(): Promise<SchoolOnboardingState> {
    this.#assertUsable();
    const scan = this.#store.school.latestScan();
    if (!scan || scan.state !== "running") throw new Error("No school check is running");
    this.#store.school.putScan({
      ...scan,
      state: "partial",
      completedAt: this.#now(),
      updatedAt: this.#now(),
      currentStep: "Saved what Inky found so far",
      failures: addUnique(scan.failures, "You ended this check before all sources were verified."),
      handoff: null,
    });
    this.#updateProfileState("profile_saved");
    this.#readOnlyGuard?.setScanActive(false);
    void this.#session?.abort().catch(error => this.#reportError(error, scan.scanId));
    return this.state();
  }

  async #withReadOnly<T>(run: () => Promise<T>): Promise<T> {
    this.#readOnlyGuard?.setAllowedHosts?.(this.#store.school.getProfile() ?? undefined);
    this.#readOnlyGuard?.setScanActive(true);
    try { return await run(); }
    finally { this.#readOnlyGuard?.setScanActive(false); }
  }

  async #start(kind: SchoolScan["kind"], workflow: SchoolScanWorkflow | null = null, targetAssignmentId?: string, sourceScanTarget?: string, materialsCourseId?: string): Promise<SchoolOnboardingState> {
    this.#assertUsable();
    const profile = this.#requiredProfile();
    const latest = this.#store.school.latestScan();
    if (latest?.state === "running" || latest?.state === "needs_user") {
      throw new Error("The current school scan must finish or resume before another scan starts");
    }
    const assignment = targetAssignmentId ? this.#store.assignments.get(targetAssignmentId) : null;
    if (targetAssignmentId && (!assignment || !this.#store.school.listCourses().some(course => course.courseId === assignment.courseId))) {
      throw new Error("This assignment is no longer available. Reopen it from your week.");
    }
    if (assignment && !assignment.sourceTarget) throw new Error("This homework has no school link to check.");

    this.#session?.dispose();
    this.#session = null;
    this.#sessionScanId = null;
    const startedAt = this.#now();
    const scan = this.#store.school.putScan({
      schemaVersion: STUDI_SCHEMA_VERSION,
      scanId: `scan-${randomUUID()}`,
      ...(this.#ownerSubject ? { ownerSubject: this.#ownerSubject } : {}),
      kind,
      purpose: materialsCourseId ? "materials" : targetAssignmentId || sourceScanTarget ? "details" : kind === "replay" ? "refresh" : "setup",
      ...(materialsCourseId ? { targetCourseId: materialsCourseId } : {}),
      ...(assignment ? { targetAssignmentId: assignment.assignmentId, targetSourceTargets: [assignment.sourceTarget!, ...(assignment.requirementEvidence ?? []).map(item => item.evidence.sourceTarget)].slice(0, 500) } : {}),
      ...(sourceScanTarget ? { sourceScanTarget, targetSourceTargets: [sourceScanTarget] } : {}),
      state: "running",
      startedAt,
      updatedAt: startedAt,
      currentStep: assignment ? `Checking details for ${assignment.title}`.slice(0, 500) : sourceScanTarget ? "Checking the homework link you added" : materialsCourseId ? "Finding course study materials" : "Opening the school root in the visible browser",
      coverage: [],
      failures: [],
      handoff: null,
      observedCourseIds: [],
      observedAssignmentIds: [],
      observedLinkedSystemIds: [],
      sourceCheckpoints: latest?.sourceCheckpoints ?? [],
    });
    this.#updateProfileState("scanning");

    try {
      const materialCourse = materialsCourseId ? this.#store.school.listCourses().find(course => course.courseId === materialsCourseId) : null;
      await this.#browser.navigate(assignment?.sourceTarget ?? sourceScanTarget ?? materialCourse?.sourceTarget ?? profile.schoolRoot);
      if (assignment) return await this.#run(scan, "Check the selected assignment's missing or stale facts. This is a read-only details check; return control to the student when finished.");
      if (sourceScanTarget) return await this.#run(scan, "Check only the homework link the student added and its observed linked materials. Identify its course from current page evidence, then record the assignment and current facts. Do not scan the entire school or invent a course. Finish with coverage of the assignment you actually found.");
      if (materialsCourseId) return await this.#run(scan, `Find the syllabus, study guides, past quizzes and slides for ${materialCourse!.label}. Record each readable source with scan_record_source; report blocked or unreadable ones. Do not scan assignments for other classes.`);

      const connectorComplete = typeof this.#browser.evaluateInPage === "function"
        ? await this.#ingestConnector(scan.scanId, profile)
        : false;
      if (this.#lastConnectorSignedIn) this.#learnSignInHosts("onboarding");
      if (connectorComplete) {
        await this.#finishStructured(scan.scanId);
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
    return await this.#run(
      scan,
      `Run a ${kind === "replay" ? "refresh" : "setup"} school check. ${connectorComplete ? "The signed-in LMS connector already saved its courses and LMS assignment rows. Do not reread unchanged LMS details. The remaining job is linked homework systems." : "The LMS connector left gaps. Check dashboard/calendar, course lists, and linked systems using the visible browser."} On each course page, take one full browser_snapshot, record the course, read all list rows with browser_rows, and record visible work in batches. Expand visible collapsed lists. Open a linked homework system only if the observed school page links to it; check its assignment index but do not record the same class/title/deadline twice. Never guess an LMS URL or revisit a course already checked in this run. Do not spend this setup check on university syllabus pages; that is a materials check. If sign-in blocks one system, record that system and request a handoff only after saving reachable work. Use only the six scan tools. Stop after dashboard/calendar, each observed course list, and linked indexes have been checked; the app finishes the scan.\n\n# School scan notes\n${notes}\n\n# Prior gaps\n${gaps}\n\n# Known linked systems\n${linked}${priorWorkflow}`,
    );
    } catch (error) {
      this.#fail(scan.scanId, `The scan could not start: ${errorMessage(error)}`);
      return this.state();
    }
  }

  async #ingestConnector(scanId: string, profile: SchoolProfile): Promise<boolean> {
    this.#lastConnectorSignedIn = false;
    let result;
    try {
      result = await runSchoolConnector(this.#browser, profile.schoolRoot);
    } catch (error) {
      this.#reportError(error, scanId, "school_connector");
      return false;
    }
    if (!result.kind || result.origin !== new URL(profile.schoolRoot).origin) return false;
    // A school-page IANA zone is evidence for interpreting naive wall-clock
    // deadlines. Without one, only exact API instants may become dueAt.
    const pageZone = await this.#browser.evaluateInPage<string | null>(`(() => {
      const zones = [...new Set((document.body?.innerText ?? '').match(/\\b[A-Za-z_]+\\/[A-Za-z_]+(?:\\/[A-Za-z_]+)?\\b/g) ?? [])]
        .filter(zone => { try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; } });
      return zones.length === 1 ? zones[0] : null;
    })()`);
    if (pageZone && pageZone !== profile.schoolTimeZone) {
      this.#store.school.putProfile({ ...profile, schoolTimeZone: pageZone, updatedAt: this.#now() });
    }
    this.#lastConnectorSignedIn = result.courses.length > 0;
    const capturedAt = this.#now();
    const priorScan = this.#requiredRunningScan(scanId);
    const priorAssignments = this.#store.assignments.listAll();
    const previouslyCompleted = new Set(priorScan.completedCourseIds);
    const skipPages = this.#store.school.listCourses()
      .filter(course => previouslyCompleted.has(course.courseId))
      .map(course => course.sourceTarget);
    const pageLists = await this.#readCoursePages(result.courses.map(course => ({ label: course.label, href: course.href, key: course.courseKey })), skipPages);
    this.#lastConnectorSignedIn = result.courses.length > 0 || pageLists.courses.length > 0;
    const makeEvidence = (target: string, summary: string): EvidenceReference => {
      const evidenceId = `evidence-${scanId}-connector-${randomUUID()}`;
      return {
        schemaVersion: STUDI_SCHEMA_VERSION,
        evidenceId,
        reference: evidenceId,
        kind: "agent_observation",
        sourceTarget: SafeSourceTargetSchema.parse(target),
        capturedAt,
        summary,
      };
    };
    const courseIds = new Map<string, string>();
    for (const source of [...result.courses, ...pageLists.courses.filter(page => !result.courses.some(course => exactTarget(course.href) === exactTarget(page.href)))]) {
      const target = SafeSourceTargetSchema.parse(source.href);
      const identity = schoolIdentity(target, "course") ?? `url|${exactTarget(target)}`;
      const prior = this.#store.school.listCourses().find(course => courseIdentity(this.#store, course) === identity || exactTarget(course.sourceTarget) === exactTarget(target));
      const courseId = prior?.courseId ?? stableId("course", identity);
      const evidence = makeEvidence(target, `Signed-in ${result.kind} connector listed course ${source.label}.`);
      this.#store.school.putCourse({
        schemaVersion: STUDI_SCHEMA_VERSION,
        ...prior,
        courseId,
        label: source.label.trim(),
        sourceTarget: target,
        sourceIdentity: identity,
        lastVerifiedScanId: scanId,
        lastVerifiedAt: capturedAt,
        evidence,
      });
      courseIds.set(source.courseKey, courseId);
      const scan = this.#requiredRunningScan(scanId);
      this.#store.school.putScan({
        ...scan,
        updatedAt: capturedAt,
        currentStep: `Found ${source.label}`,
        observedCourseIds: addUnique(scan.observedCourseIds, courseId),
      });
    }
    for (const row of [...result.rows, ...pageLists.rows]) {
      const courseId = row.courseKey ? courseIds.get(row.courseKey) : undefined;
      if (!courseId || previouslyCompleted.has(courseId)) continue;
      this.#saveConnectorRow(scanId, courseId, row, result.kind, makeEvidence);
    }
    const scan = this.#requiredRunningScan(scanId);
    const completedCourseIds = pageLists.completedCourseKeys.reduce((ids, key) => {
      const id = courseIds.get(key);
      return id ? addUnique(ids, id) : ids;
    }, scan.completedCourseIds);
    const failures = [...scan.failures, ...(pageLists.complete ? [] : result.failures.map(failure => `${failure.sourceLabel}: ${failure.message}`)), ...pageLists.failures].slice(0, 100);
    const removals = scan.purpose === "refresh" && pageLists.complete
      ? removedScanChanges(priorAssignments, new Set(scan.observedAssignmentIds), new Set(completedCourseIds))
      : [];
    this.#store.school.putScan({ ...scan, completedCourseIds, failures,
      changes: [...scan.changes, ...removals].slice(0, 10_000), updatedAt: capturedAt });
    return pageLists.complete && scan.observedCourseIds.length > 0 && failures.length === 0;
  }

  async #readCoursePages(known: readonly { label: string; href: string; key: string }[], skipTargets: readonly string[]): Promise<{
    courses: Array<{ label: string; href: string; courseKey: string; code: null; sourceLabels: [] }>;
    rows: ConnectorAssignmentRow[];
    failures: string[];
    completedCourseKeys: string[];
    complete: boolean;
  }> {
    try {
      return await this.#browser.evaluateInPage(`(async () => {
        const known = ${JSON.stringify(known)};
        const skip = new Set(${JSON.stringify(skipTargets)});
        const sameOrigin = href => { try { return new URL(href, location.href).origin === location.origin; } catch { return false; } };
        const seen = new Map(known.map(course => [new URL(course.href, location.href).href, course]));
        for (const link of document.querySelectorAll('a[href]')) {
          const href = new URL(link.href, location.href);
          if (href.origin !== location.origin) continue;
          if (!/\\/course\\/view\\.php$/.test(href.pathname) && !/^\\/courses\\/[^/]+$/.test(href.pathname)) continue;
          if (!seen.has(href.href)) seen.set(href.href, { href: href.href, label: link.textContent?.trim() || href.pathname, key: href.href });
        }
        const courses = [];
        const rows = [];
        const failures = [];
        const completedCourseKeys = [];
        for (const source of [...seen.values()].slice(0, 100)) {
          if (!sameOrigin(source.href)) continue;
          if (skip.has(source.href)) continue;
          try {
            const reply = await fetch(source.href, { credentials: 'same-origin', headers: { accept: 'text/html' } });
            if (!reply.ok) throw new Error('HTTP ' + reply.status);
            const page = new DOMParser().parseFromString(await reply.text(), 'text/html');
            const heading = page.querySelector('h1')?.textContent?.trim() || source.label;
            const label = known.length ? source.label : heading.replace(/^[A-Z]{2,5}\\s*\\d{2,4}\\s+/, '');
            const courseKey = source.key;
            courses.push({ label, href: source.href, courseKey, code: null, sourceLabels: [] });
            completedCourseKeys.push(courseKey);
            for (const element of page.querySelectorAll('tr.activity, li.activity, .activity.modtype_assign, .activity.modtype_quiz, .activity.modtype_lti')) {
              const cls = element.className?.toString() || '';
          const kind = /modtype_quiz/.test(cls) ? 'quiz'
                : /modtype_(assign|lti)/.test(cls) ? 'assignment' : null;
              if (!kind) continue;
              const link = element.querySelector('a[href]');
              if (!link?.textContent?.trim()) continue;
              const cells = [...element.querySelectorAll('td')];
              const dueText = cells[1]?.textContent?.trim() || null;
              const statusText = cells[2]?.textContent?.trim() || null;
              rows.push({
                assignmentKey: element.getAttribute('data-id') || link.href,
                courseKey,
                title: link.textContent.trim(),
                href: new URL(link.getAttribute('href'), source.href).href,
                dueAt: null,
                dueText,
                statusText,
                kind,
                instructions: null,
                sourceLabels: []
              });
            }
          } catch (error) { failures.push('Could not read course ' + source.label + ': ' + String(error)); }
        }
        return { courses, rows, failures, completedCourseKeys, complete: seen.size > 0 && failures.length === 0 };
      })()`);
    } catch (error) {
      this.#reportError(error, this.#store.school.latestScan()?.scanId ?? "", "course_pages");
      return { courses: [], rows: [], failures: ["Course pages could not be read; the browser agent will continue."], completedCourseKeys: [], complete: false };
    }
  }

  #learnSignInHosts(context: "onboarding" | "needs_you"): void {
    const profile = this.#store.school.getProfile();
    if (!profile) return;
    const rootHost = new URL(profile.schoolRoot).host;
    const chain = this.#browser.navigationUrls;
    const last = chain.length - 1;
    if (last < 2 || new URL(chain[last]!).host !== rootHost) return;
    let start = -1;
    for (let index = last - 1; index >= 0; index--) {
      if (new URL(chain[index]!).host === rootHost) { start = index; break; }
    }
    if (start < 0 || !chain.slice(start + 1, last).some(url => new URL(url).host !== rootHost)) return;
    try {
      const learned = autofillSignInHosts(profile, {
        schoolRoot: profile.schoolRoot,
        redirectChain: chain.slice(start, last + 1),
        context,
        signedIn: true,
      });
      const next = this.#store.school.putProfile({ ...profile, ...learned, updatedAt: this.#now() });
      this.#readOnlyGuard?.setAllowedHosts(next);
    } catch (error) {
      this.#reportError(error, this.#store.school.latestScan()?.scanId ?? "", "sign_in_hosts");
    }
  }

  async #learnLtiLaunchHosts(courseId: string): Promise<void> {
    const profile = this.#store.school.getProfile();
    const course = this.#store.school.listCourses().find(item => item.courseId === courseId);
    if (!profile || !course || exactTarget(this.#browser.state.url) !== exactTarget(course.sourceTarget)) return;
    const forms = await this.#browser.evaluateInPage<Array<{ pageUrl: string; action: string; method: string; fieldNames: string[] }>>(`(async () => {
      const collect = (page, url) => [...page.querySelectorAll('form[action]')].map(form => ({
        pageUrl: url,
        action: new URL(form.getAttribute('action'), url).href,
        method: form.method,
        fieldNames: [...form.querySelectorAll('input[name]')].map(input => input.name)
      }));
      const forms = collect(document, location.href);
      const modules = [...new Set([...document.querySelectorAll('a[href]')]
        .map(link => link.href)
        .filter(href => {
          try { const url = new URL(href); return url.origin === location.origin && /\\/mod\\/lti\\/view\\.php$/.test(url.pathname); }
          catch { return false; }
        }))].slice(0, 20);
      for (const moduleUrl of modules) {
        try {
          const reply = await fetch(moduleUrl, { credentials: 'same-origin' });
          if (!reply.ok) continue;
          const page = new DOMParser().parseFromString(await reply.text(), 'text/html');
          forms.push(...collect(page, moduleUrl));
        } catch { /* An unreadable module never widens the policy. */ }
      }
      return forms;
    })()`);
    for (const form of forms) {
      try {
        const current = this.#store.school.getProfile() ?? profile;
        const learned = autofillLtiLaunchHost(current, form, [form.pageUrl]);
        const next = this.#store.school.putProfile({ ...current, ...learned, updatedAt: this.#now() });
        this.#readOnlyGuard?.setAllowedHosts(next);
      } catch { /* Ordinary course forms never widen the read-only policy. */ }
    }
  }

  #saveConnectorRow(
    scanId: string,
    courseId: string,
    row: ConnectorAssignmentRow,
    lms: "moodle" | "canvas" | "browser",
    makeEvidence: (target: string, summary: string) => EvidenceReference,
  ): void {
    const target = SafeSourceTargetSchema.parse(row.href);
    const identity = lms === "canvas"
      ? `canvas|${new URL(target).origin}|${new URL(target).pathname.match(/\/assignments\/(\d+)/)?.[1] ?? exactTarget(target)}`
      : assignmentIdentity(target);
    const prior = this.#store.assignments.listAll().find(item => item.sourceIdentity === identity || (item.sourceTarget && exactTarget(item.sourceTarget) === exactTarget(target)));
    const evidence = makeEvidence(target, lms === "browser" ? `Visible school list showed ${row.title}.` : `Signed-in ${lms} connector listed ${row.title}.`);
    const normalizedDueText = row.dueText
      ?.trim()
      .replace(/\s+\([^)]*\b(?:ET|EDT|EST|PT|PDT|PST)\)\s*$/i, "")
      .replace(/\s+\((?:ET|EDT|EST)\)$/i, " America/New_York")
      .replace(/\s+\((?:PT|PDT|PST)\)$/i, " America/Los_Angeles")
      .replace(/\s+(?:ET|EDT|EST)$/i, " America/New_York")
      .replace(/\s+(?:PT|PDT|PST)$/i, " America/Los_Angeles");
    const schoolTimeZone = this.#store.school.getProfile()?.schoolTimeZone;
    const hasExplicitZone = /(?:\(|\s)[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?\)?$/.test(normalizedDueText ?? "");
    const parseZone = schoolTimeZone ?? (hasExplicitZone ? "UTC" : undefined);
    const parsed = normalizedDueText && parseZone ? parseDueDate(normalizedDueText, { schoolTimeZone: parseZone, capturedAt: this.#now() }) : null;
    const exactDueAt = row.dueAt && Number.isFinite(Date.parse(row.dueAt)) ? new Date(row.dueAt).toISOString() : undefined;
    // A visible date without an exact time remains text/date precision. The
    // shared parser can calculate end-of-day for display, but that is not an
    // exact school deadline and must not be persisted as one.
    const dueAt = exactDueAt ?? (parsed?.precision === "datetime" ? parsed.dueAt : undefined);
    const deadlinePrecision = exactDueAt ? "datetime" as const : parsed?.precision ?? "unknown" as const;
    const status = row.statusText?.toLowerCase() ?? "";
    const statusState = /not submitted|to do|unsubmitted/.test(status) ? "not_submitted" as const
      : /graded/.test(status) ? "graded" as const
      : /submitted|turned in/.test(status) ? "submitted" as const
      : /locked|closed/.test(status) ? "locked" as const : "unknown" as const;
    const assignmentId = prior?.assignmentId ?? stableId("assignment", identity);
    const assignment = this.#store.assignments.put({
      schemaVersion: STUDI_SCHEMA_VERSION,
      ...prior,
      assignmentId,
      courseId: prior?.courseId ?? courseId,
      title: row.title.trim(),
      sourceTarget: target,
      sourceIdentity: identity,
      origin: prior?.origin ?? "school",
      ...classifyAssignmentKind(row.title, row.instructions ?? ""),
      kindEvidence: evidence,
      ...(dueAt ? { dueAt, deadlinePrecision, deadlineEvidence: evidence } : {}),
      ...(row.dueText ? { dueText: row.dueText } : {}),
      ...(row.instructions ? { instructions: row.instructions, requirementEvidence: [{ text: row.instructions, evidence }], requirementsState: "partial" as const } : {}),
      ...(row.statusText ? { schoolStatus: { state: statusState, text: row.statusText, evidence } } : {}),
      discoveredAt: prior?.discoveredAt ?? evidence.capturedAt,
      lastVerifiedScanId: scanId,
      evidence: [...(prior?.evidence ?? []), evidence],
    });
    if (!this.#store.courseConflicts.some(item => item.courseIds.includes(assignment.courseId))) {
      this.#ensureTaskOrigin(assignment, scanId);
    }
    const scan = this.#requiredRunningScan(scanId);
    const change = assignmentScanChange(prior ?? undefined, assignment);
    const priorChange = scan.changes.find(item => item.assignmentId === assignmentId);
    const nextChange = mergeScanChange(priorChange, change);
    this.#store.school.putScan({
      ...scan,
      updatedAt: this.#now(),
      currentStep: `Found ${assignment.title}`,
      observedAssignmentIds: addUnique(scan.observedAssignmentIds, assignmentId),
      changes: nextChange ? [...scan.changes.filter(item => item.assignmentId !== assignmentId), nextChange] : scan.changes,
    });
  }

  async #finishStructured(scanId: string): Promise<void> {
    const scan = this.#requiredRunningScan(scanId);
    if (!scan.observedCourseIds.length && new URL(this.#browser.state.url).origin !== new URL(this.#requiredProfile().schoolRoot).origin) {
      const snapshot = await this.#browser.snapshot();
      this.#store.school.putScan({
        ...scan,
        state: "needs_user",
        updatedAt: this.#now(),
        currentStep: "Sign in to your school, then continue the check",
        handoff: {
          kind: "school_sign_in",
          reason: "Sign in to your school, then continue the check",
          requestedAt: this.#now(),
          evidence: this.#evidence(scanId, snapshot, "The school sign-in page is open."),
        },
      });
      this.#updateProfileState("needs_sign_in");
      return;
    }
    const courses = this.#store.school.listCourses().filter(course => scan.observedCourseIds.includes(course.courseId));
    const coverage = courses.map(course => ({
      target: `Course: ${course.label}`.slice(0, 200),
      status: "verified" as const,
      evidence: course.evidence,
    }));
    const failures = [...scan.failures];
    if (!courses.length) failures.push("No courses could be checked.");
    if (scan.purpose === "materials" && scan.materialSourceCount === 0) failures.push("No readable study material was verified for this class.");
    const complete = failures.length === 0 && courses.length > 0;
    this.#store.school.putScan({
      ...scan,
      state: complete ? "succeeded" : "partial",
      updatedAt: this.#now(),
      completedAt: this.#now(),
      currentStep: complete ? "School check complete" : "Saved what Inky found; some sources remain unchecked",
      coverage,
      failures,
      handoff: null,
    });
    this.#updateProfileState(complete ? "ready" : "profile_saved");
    if (complete) {
      try { await this.#writeWorkflowHints(scanId, []); }
      catch (error) {
        this.#reportError(error, scanId, "scan_workflow");
        const current = this.#store.school.getScan(scanId);
        if (current) this.#store.school.putScan({ ...current, state: "partial", failures: addUnique(current.failures, "The next scheduled check could not be prepared.") });
        this.#updateProfileState("profile_saved");
      }
    }
  }

  async #run(scan: SchoolScan, prompt: string, sessionsRemaining = this.#maxSessionsPerRun): Promise<SchoolOnboardingState> {
    this.#sourceChecksThisSession = 0;
    this.#rotateSession = false;
    let reply = "";
    let terminalOutcome: "completed" | "failed" | "aborted" | null = null;
    let terminalReason: string | null = null;
    let unsubscribe: () => void = () => {};
    const details = Boolean(scan.targetAssignmentId);
    const structured = !details && !scan.sourceScanTarget
      && typeof this.#browser.evaluateInPage === "function";
    let watchdog: ReturnType<typeof setInterval> | undefined;
    const activeStartedAt = Date.now();
    let lastProgress = Date.now();
    let lastCount = scan.observedAssignmentIds.length + scan.observedCourseIds.length + scan.completedCourseIds.length;
    try {
    let session = this.#session;
    if (!session || this.#sessionScanId !== scan.scanId) {
      session?.dispose();
      session = await this.#runtime.createScanSession(details ? this.#createDetailsTools(scan.scanId) : structured ? this.#createStructuredTools(scan.scanId) : this.#createRecordingTools(scan.scanId), {}, {
        assertActive: () => { this.#requiredRunningScan(scan.scanId); if (this.#rotateSession) throw new Error("Saved source checkpoint; continuing in a fresh scan session."); },
      });
      this.#session = session;
      this.#sessionScanId = scan.scanId;
    }

    this.#requiredRunningScan(scan.scanId);
    if (structured) watchdog = setInterval(() => {
      const current = this.#store.school.getScan(scan.scanId);
      if (!current || current.state !== "running") return;
      const count = current.observedAssignmentIds.length + current.observedCourseIds.length + current.completedCourseIds.length;
      if (count > lastCount) { lastCount = count; lastProgress = Date.now(); }
      const activeMs = Date.now() - activeStartedAt;
      if (activeMs >= this.#activeLimitMs || Date.now() - lastProgress >= this.#idleLimitMs) {
        const reason = activeMs >= this.#activeLimitMs ? "The 30-minute school check limit was reached." : "No new school work or course was found for five minutes.";
        const latest = this.#store.school.getScan(scan.scanId);
        if (latest?.state === "running") this.#store.school.putScan({ ...latest, failures: addUnique(latest.failures, reason) });
        void session?.abort().catch(error => this.#reportError(error, scan.scanId));
      }
    }, this.#watchdogIntervalMs);
    unsubscribe = session.subscribe((event: AgentRunEvent) => {
      if (event.type === "text") reply += event.delta;
      if (event.type === "terminal") {
        terminalOutcome = event.outcome;
        terminalReason = event.reason ?? null;
      }
      if (event.type === "tool_finished" && event.outcome === "failed") this.#reportError(event, scan.scanId, event.toolName);
      if (event.type === "terminal" && event.outcome === "failed") this.#reportError(event.reason ?? "Scan model failed", scan.scanId);
    });
      const assignmentScope = scan.targetAssignmentId ? this.#assignmentScopePrompt(scan) : "";
      const syllabusPrompt = this.#recordSyllabus && !scan.targetAssignmentId && !scan.sourceScanTarget
        ? "\nAlso inspect visible syllabus and exam-plan links for each observed course. On an HTML syllabus page, use scan_record_syllabus with exact visible course-owned text; this saves a source for Learn without inventing dates or starting another model. Do not claim unsupported PDF content was read."
        : "";
      const sourcePrompt = scan.sourceScanTarget ? `\nThis is only a check of the student's link ${scan.sourceScanTarget} and its observed links. Do not expand it to the whole school.` : "";
      await session.prompt(structured
        ? `${prompt}\n\nSchool root: ${this.#requiredProfile().schoolRoot}\nToday: ${this.#now()}\nKnown courses: ${JSON.stringify(this.#store.school.listCourses().map(course => ({ id: course.courseId, label: course.label, url: course.sourceTarget })))}\nPrevious rows: ${JSON.stringify(this.#store.assignments.listAll().map(item => ({ title: item.title, url: item.sourceTarget, dueText: item.dueText })))}\nCurrent progress: ${JSON.stringify({ courses: this.#requiredRunningScan(scan.scanId).observedCourseIds.length, rows: this.#requiredRunningScan(scan.scanId).observedAssignmentIds.length, failures: this.#requiredRunningScan(scan.scanId).failures })}`
        : `${assignmentScope || prompt}${sourcePrompt}${syllabusPrompt}\n\n# Durable scan checkpoint\n${JSON.stringify(this.#checkpoint(scan.scanId))}\nThese saved IDs support resuming this scan. Take a new browser snapshot before new claims or actions.`);
    } catch (error) {
      const current = this.#store.school.getScan(scan.scanId);
      if (!this.#rotateSession) this.#reportError(error, scan.scanId);
      if (current?.state === "running" && !this.#rotateSession) this.#fail(scan.scanId, `The scan agent stopped: ${providerFailureText(errorMessage(error))}`);
    } finally {
      if (watchdog) clearInterval(watchdog);
      unsubscribe();
      const saved = this.#store.school.getScan(scan.scanId);
      if (saved && reply.trim()) this.#store.school.putScan({...saved, messages:[...saved.messages, {messageId:randomUUID(),role:"assistant",text:reply.slice(0,100000),createdAt:this.#now()}]});
    }

    const current = this.#store.school.getScan(scan.scanId);
    if (current?.state === "running" && structured) {
      await this.#finishStructured(scan.scanId);
      this.#session?.dispose();
      this.#session = null;
      this.#sessionScanId = null;
      return this.state();
    }
    if (current?.state === "running" && details && !this.#rotateSession) {
      const assignment = this.#store.assignments.get(current.targetAssignmentId!);
      this.#finishAssignmentCheck(current, [{ target: `Assignment: ${assignment?.title ?? "Unknown"}`, status: "verified" }]);
      this.#session?.dispose();
      this.#session = null;
      this.#sessionScanId = null;
      return this.state();
    }
    if (current?.state === "running" && this.#rotateSession) {
      this.#session?.dispose();
      this.#session = null;
      this.#sessionScanId = null;
      if (sessionsRemaining > 1) return this.#run(current, "Continue this scan from its saved source checkpoints. Read scan_status; inspect remaining sources and use scan_read_assignment only for the assignment needing detail. Do not repeat already checked sources in this scan. Finish with explicit coverage or request help if access is blocked.", sessionsRemaining - 1);
      this.#store.school.putScan({ ...current, state: "partial", completedAt: this.#now(), updatedAt: this.#now(),
        currentStep: "Saved scan progress. More sources remain to check.", failures: ["This check reached its source-session budget; continue from the saved checkpoints."], handoff: null });
      this.#updateProfileState("profile_saved");
      return this.state();
    }
    if (current?.state === "running") {
      const reason = terminalOutcome === "aborted"
        ? "The school scan was aborted before it recorded coverage."
        : terminalOutcome === "failed"
          ? `The school scan agent failed before it recorded coverage: ${terminalReason ? providerFailureText(terminalReason) : "the provider returned an error"}`
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

  #createStructuredTools(scanId: string): ToolDefinition[] {
    const legacy = this.#createRecordingTools(scanId);
    const courseTool = legacy.find(tool => tool.name === "scan_record_course")!;
    const handoffTool = legacy.find(tool => tool.name === "scan_request_handoff")!;
    const rejected = new Map<string, number>();
    const observed = async (target: string, title: string, dueText?: string): Promise<boolean> => {
      return this.#browser.evaluateInPage<boolean>(`(() => {
        const target = ${JSON.stringify(target)};
        const title = ${JSON.stringify(title.trim().toLowerCase())};
        const due = ${JSON.stringify((dueText ?? "").trim().toLowerCase())};
        const same = (left, right) => { try { return new URL(left, location.href).href === new URL(right, location.href).href; } catch { return false; } };
        return [...document.querySelectorAll('a[href]')].some(link => {
          if (!same(link.href, target) || !link.textContent?.trim().toLowerCase().includes(title)) return false;
          if (!due) return true;
          const row = link.closest('tr, li, article, [data-region="event-list-item"], .assignment, .activity') ?? link.parentElement?.parentElement;
          return (row?.textContent ?? "").replace(/\\s+/g, " ").toLowerCase().includes(due);
        });
      })()`);
    };
    const status = defineTool({
      name: "scan_status",
      label: "Read school check progress",
      description: "Return saved course and work counts plus sources still unchecked.",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async () => {
        const scan = this.#requiredRunningScan(scanId);
        return toolResult({
          courses: scan.observedCourseIds.length,
          rows: scan.observedAssignmentIds.length,
          failures: scan.failures,
          remainingCourses: this.#store.school.listCourses().filter(course => !scan.observedCourseIds.includes(course.courseId)).map(course => ({ id: course.courseId, label: course.label, url: course.sourceTarget })),
        });
      },
    });
    const recordSystem = defineTool({
      name: "scan_record_system",
      label: "Record system access",
      description: "Record the access state of a school or linked system actually observed in the browser.",
      parameters: Type.Object({
        system: Type.String({ minLength: 1, maxLength: 200 }),
        url: Type.String({ minLength: 1, maxLength: 4096 }),
        state: Type.Union([Type.Literal("signed_in"), Type.Literal("needs_sign_in"), Type.Literal("denied"), Type.Literal("network"), Type.Literal("down")]),
      }, { additionalProperties: false }),
      execute: async (_id, input) => {
        const snapshot = await this.#observe(scanId);
        const url = SafeSourceTargetSchema.parse(input.url);
        if (exactTarget(url) !== exactTarget(snapshot.url) && !snapshot.elements.some(element => element.href && exactTarget(element.href) === exactTarget(url))) {
          throw new Error("Open or observe the system before recording its access state");
        }
        const scan = this.#requiredRunningScan(scanId);
        const target = `System: ${input.system.trim()}`.slice(0, 200);
        const failure = input.state === "signed_in" ? undefined : `${input.system.trim()}: ${input.state.replaceAll("_", " ")}`;
        const coverage = [...scan.coverage.filter(item => item.target !== target), {
          target,
          status: failure ? "partial" as const : "verified" as const,
          ...(failure ? { failure } : { evidence: this.#evidence(scanId, snapshot, `Observed ${input.system.trim()} signed in.`) }),
        }];
        this.#store.school.putScan({ ...scan, coverage, failures: failure ? addUnique(scan.failures, failure) : scan.failures, updatedAt: this.#now() });
        return toolResult({ saved: true, system: input.system, state: input.state });
      },
    });
    const recordCourse = { ...courseTool, execute: async (...args: Parameters<typeof courseTool.execute>) => {
      await courseTool.execute(...args);
      const scan = this.#requiredRunningScan(scanId);
      try { await this.#learnLtiLaunchHosts(scan.observedCourseIds.at(-1)!); }
      catch (error) { this.#reportError(error, scanId, "lti_launch_hosts"); }
      return toolResult({ saved: true, ids: scan.observedCourseIds.slice(-1) });
    } };
    const recordRows = defineTool({
      name: "scan_record_rows",
      label: "Record visible school work",
      description: "Record assignment, quiz, exam or project rows from the current list. Every title and link must be visible in that row. Do not record files, slides, grades or navigation.",
      parameters: Type.Object({
        courseKey: Type.String({ minLength: 1, maxLength: 500 }),
        rows: Type.Array(Type.Object({
          title: Type.String({ minLength: 1, maxLength: 500 }),
          href: Type.String({ minLength: 1, maxLength: 4096 }),
          dueText: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
          statusText: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
          kind: Type.String({ minLength: 1, maxLength: 50 }),
          instructions: Type.Optional(Type.String({ minLength: 1, maxLength: 8000 })),
        }, { additionalProperties: false }), { minItems: 1, maxItems: 100 }),
      }, { additionalProperties: false }),
      execute: async (_id, input) => {
        const course = this.#store.school.listCourses().find(item => item.courseId === input.courseKey || item.sourceIdentity === input.courseKey || item.label === input.courseKey);
        if (!course) throw new Error("Record this class before its work");
        const scan = this.#requiredRunningScan(scanId);
        if (!scan.observedCourseIds.includes(course.courseId)) throw new Error("Verify this class during the current check");
        const page = this.#browser.state.url;
        const key = `${page}|${course.courseId}`;
        if ((rejected.get(key) ?? 0) >= 3) return toolResult({ saved: 0, skipped: true, reason: "Three rejected attempts; move to another source." });
        try {
          for (const row of input.rows) {
            if (!/^(assignment|quiz|exam|project|homework|discussion)$/i.test(row.kind)) throw new Error(`Not school work: ${row.kind}`);
            const href = SafeSourceTargetSchema.parse(row.href);
            if (!await observed(href, row.title, row.dueText)) throw new Error(`The current page does not show the claimed row: ${row.title}`);
          }
        } catch (error) {
          rejected.set(key, (rejected.get(key) ?? 0) + 1);
          if (rejected.get(key) === 3) {
            const current = this.#requiredRunningScan(scanId);
            this.#store.school.putScan({ ...current, failures: addUnique(current.failures, `Skipped ${page} after three rejected row attempts.`) });
          }
          throw error;
        }
        const makeEvidence = (target: string, summary: string): EvidenceReference => {
          const evidenceId = `evidence-${scanId}-row-${randomUUID()}`;
          return { schemaVersion: STUDI_SCHEMA_VERSION, evidenceId, reference: evidenceId, kind: "agent_observation", sourceTarget: target, capturedAt: this.#now(), summary };
        };
        const ids: string[] = [];
        let saved = 0;
        for (const row of input.rows) {
          // A linked system can link back through a different school URL for
          // work already listed under its own URL. Keep one student task.
          const duplicate = row.dueText && this.#store.assignments.listAll().some(item =>
            item.courseId === course.courseId && item.sourceTarget && sameFact(item.title, row.title)
            && item.dueText && sameFact(item.dueText, row.dueText!)
            && exactTarget(item.sourceTarget) !== exactTarget(row.href));
          if (duplicate) continue;
          const before = this.#requiredRunningScan(scanId).observedAssignmentIds;
          this.#saveConnectorRow(scanId, course.courseId, {
            assignmentKey: row.href, courseKey: course.courseId, title: row.title, href: row.href,
            dueAt: null, dueText: row.dueText ?? null, statusText: row.statusText ?? null,
            kind: row.kind, instructions: row.instructions ?? null, sourceLabels: [],
          }, "browser", makeEvidence);
          ids.push(...this.#requiredRunningScan(scanId).observedAssignmentIds.filter(id => !before.includes(id)));
          saved += 1;
        }
        return toolResult({ saved, duplicatesSkipped: input.rows.length - saved, ids });
      },
    });
    const recordSource = defineTool({
      name: "scan_record_source",
      label: "Save course study source",
      description: "Save a syllabus or study guide from its currently open course page for Learn.",
      parameters: Type.Object({
        courseKey: Type.String({ minLength: 1, maxLength: 500 }),
        title: Type.String({ minLength: 1, maxLength: 300 }),
        url: Type.String({ minLength: 1, maxLength: 4096 }),
        text: Type.String({ minLength: 1, maxLength: 20000 }),
      }, { additionalProperties: false }),
      execute: async (_id, input) => {
        if (!this.#recordSyllabus) return toolResult({ saved: false, reason: "Study source storage is unavailable" });
        const course = this.#store.school.listCourses().find(item => item.courseId === input.courseKey || item.label === input.courseKey);
        if (!course || !this.#requiredRunningScan(scanId).observedCourseIds.includes(course.courseId)) throw new Error("Verify the source's class first");
        const snapshot = await this.#observe(scanId);
        const source = SafeSourceTargetSchema.parse(input.url);
        if (exactTarget(source) !== exactTarget(snapshot.url) || !normalizeFact(snapshot.text).includes(normalizeFact(input.text))) throw new Error("Open the source and quote its visible text");
        await this.#recordSyllabus({ courseId: course.courseId, title: input.title, text: input.text, sourceTarget: source });
        const scan = this.#requiredRunningScan(scanId);
        this.#store.school.putScan({ ...scan, materialSourceCount: scan.materialSourceCount + 1, updatedAt: this.#now() });
        return toolResult({ saved: true, courseId: course.courseId });
      },
    });
    const handoff = { ...handoffTool, execute: async (...args: Parameters<typeof handoffTool.execute>) => {
      await handoffTool.execute(...args);
      return toolResult({ saved: true, state: "needs_user" });
    } };
    const tools = [status, recordSystem, recordCourse, recordRows, recordSource, handoff];
    if (tools.some((tool, index) => tool.name !== SCAN_TOOL_NAMES[index])) throw new Error("Structured scan tools do not match the shared capability contract");
    return tools;
  }

  #createDetailsTools(scanId: string): ToolDefinition[] {
    const legacy = this.#createRecordingTools(scanId);
    const names = new Set([
      "scan_status", "scan_record_assignment", "scan_request_handoff",
      "scan_check_source", "scan_record_source", "scan_read_assignment",
      "scan_read_material", "scan_add_source", "scan_skip_source",
    ]);
    return legacy.filter(tool => names.has(tool.name));
  }

  #createRecordingTools(scanId: string): ToolDefinition[] {
    const pdf = createScanMaterialReader({ store: this.#store, browser: this.#browser, scan: () => this.#requiredRunningScan(scanId), observe: () => this.#observe(scanId), now: this.#now });
    const status = defineTool({
      name: "scan_status",
      label: "Read scan progress",
      description: "Read durable discoveries, inventory coverage and outstanding gaps. Use returned IDs when resuming after a handoff.",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async () => toolResult(this.#checkpoint(scanId)),
    });
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
        const snapshot = await this.#observe(scanId, [input.observationRef]);
        const scan = this.#requiredRunningScan(scanId);
        const observation = requireSnapshotFact(snapshot, input.label, input.observationRef, "course label");
        const evidence = this.#evidence(scanId, snapshot, `Observed course ${input.label.trim()} in ${observation}.`);
        const sourceTarget = observedTarget(snapshot, input.label, input.observationRef);
        const identity = schoolIdentity(sourceTarget, "course");
        return this.#store.database.transaction(() => {
          const courses = this.#store.school.listCourses();
          const matches = courses.filter(course => identity
            ? courseIdentity(this.#store, course) === identity
            : courseObservations(course).some(observation => exactTarget(observation.sourceTarget) === exactTarget(sourceTarget) && sameFact(observation.label, input.label)));
          if (!identity && matches.length > 1) throw new Error("Several classes match this observation; open the course page before recording it");
          let priorCourse = matches[0];
          if (!priorCourse && exactTarget(sourceTarget) !== exactTarget(snapshot.url)) {
            // A newly visible course link may refine a legacy directory observation.
            // Preserve its ID, permissions and homework folders when unambiguous.
            const legacy = courses.filter(course => exactTarget(course.sourceTarget) === exactTarget(snapshot.url) && sameFact(course.label, input.label));
            if (legacy.length === 1) priorCourse = legacy[0];
          }
          const courseId = priorCourse?.courseId ?? stableId("course", identity ?? `${exactTarget(sourceTarget)}|${normalize(input.label)}`);
          let course = this.#store.school.putCourse({
            schemaVersion: STUDI_SCHEMA_VERSION,
            ...priorCourse,
            courseId,
            label: input.label.trim(),
            sourceTarget,
            ...(identity ? { sourceIdentity: identity } : {}),
            ...(priorCourse ? { sourceAliases: courseObservations(priorCourse) } : {}),
            lastVerifiedScanId: scanId,
            lastVerifiedAt: evidence.capturedAt,
            evidence,
          });
          this.#store.courseConflicts = reconcileCourses(this.#store);
          const canonicalId = this.#store.school.resolveCourseId(course.courseId);
          course = this.#store.school.listCourses().find(item => item.courseId === canonicalId)!;
          this.#store.school.putScan({
            ...scan,
            updatedAt: this.#now(),
            currentStep: `Verified course: ${course.label}`,
            observedCourseIds: addUnique(scan.observedCourseIds, course.courseId),
          });
          return toolResult(course);
        });
      },
    });

    const assignmentParameters = Type.Object({
      courseId: Type.String({ minLength: 1, maxLength: 256 }),
      title: Type.String({ minLength: 1, maxLength: 500 }),
      assignmentKey: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
      instructions: Type.Optional(Type.String({ minLength: 1, maxLength: 8000 })),
      requirementExcerpts: Type.Optional(Type.Array(Type.Object({
        text: Type.String({ minLength: 1, maxLength: 8000 }),
        sourceRef: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
        observationRef: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
      }), { maxItems: 100 })),
      requirementsComplete: Type.Optional(Type.Boolean()),
      replaceRequirementsFromSource: Type.Optional(Type.Boolean()),
      missingRequirements: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 30 })),
      schoolStatus: Type.Optional(Type.Object({
        state: Type.Union([Type.Literal("unknown"), Type.Literal("not_submitted"), Type.Literal("submitted"), Type.Literal("graded"), Type.Literal("locked")]),
        text: Type.String({ minLength: 1, maxLength: 1000 }),
        observationRef: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
      })),
      latePolicy: Type.Optional(Type.Object({
        state: Type.Union([Type.Literal("accepted"), Type.Literal("not_accepted"), Type.Literal("unknown")]),
        text: Type.String({ minLength: 1, maxLength: 1000 }),
        until: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
        untilText: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      })),
      dueAt: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
      dueText: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      observationRef: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    }, { additionalProperties: false });
    const persistAssignments = async (inputs: readonly {
      readonly courseId: string;
      readonly title: string;
      readonly assignmentKey?: string;
      readonly instructions?: string;
      readonly requirementExcerpts?: readonly { text: string; observationRef?: string; sourceRef?: string }[];
      readonly requirementsComplete?: boolean;
      readonly replaceRequirementsFromSource?: boolean;
      readonly missingRequirements?: string[];
      readonly schoolStatus?: { state: "unknown" | "not_submitted" | "submitted" | "graded" | "locked"; text: string; observationRef?: string };
      readonly latePolicy?: { state: "accepted" | "not_accepted" | "unknown"; text: string; until?: string; untilText?: string };
      readonly dueAt?: string;
      readonly dueText?: string;
      readonly observationRef?: string;
    }[]) => {
      const snapshot = await this.#observe(scanId, inputs.flatMap((input) => [input.observationRef, input.schoolStatus?.observationRef, ...(input.requirementExcerpts ?? []).map(item => item.observationRef)]));
      const scan = this.#requiredRunningScan(scanId);
      return this.#store.database.transaction(() => {
        const changes = [...scan.changes];
        const assignments = inputs.map((rawInput) => {
          const input = { ...rawInput, courseId: this.#store.school.resolveCourseId(rawInput.courseId) };
          const selected = scan.targetAssignmentId ? this.#store.assignments.get(scan.targetAssignmentId) : null;
          if (scan.sourceScanTarget && !scan.targetSourceTargets?.some(url => exactTarget(url) === exactTarget(snapshot.url))) throw new Error("Check only the added homework link and its observed linked sources.");
          if (scan.targetAssignmentId && (!selected || selected.courseId !== input.courseId || !sameFact(selected.title, input.title)
            || !scan.targetSourceTargets?.some(url => exactTarget(url) === exactTarget(snapshot.url)))) {
            throw new Error("This details check can record only the selected assignment from its known or observed linked sources");
          }
          if (!selected && !scan.observedCourseIds.map(id => this.#store.school.resolveCourseId(id)).includes(input.courseId)) {
            throw new Error("The assignment's course has not been verified in this scan");
          }
          const observedCourse = schoolIdentity(snapshot.url, "course");
          const knownCourse = this.#store.school.listCourses().find(course => course.courseId === input.courseId)!;
          const knownIdentity = courseIdentity(this.#store, knownCourse);
          if (observedCourse && knownIdentity && observedCourse !== knownIdentity) throw new Error("This assignment list belongs to a different course");
          const observation = requireSnapshotFact(snapshot, input.title, input.observationRef, "assignment title");
          if (input.instructions) requireSnapshotFact(snapshot, input.instructions, undefined, "assignment instructions");
          const sourceTarget = observedTarget(snapshot, input.title, input.observationRef);
          if (input.dueText ?? input.dueAt) requireAssignmentFact(snapshot, sourceTarget, input.title, (input.dueText ?? input.dueAt)!, undefined, "assignment due date");
          const dueAt = input.dueAt === undefined && input.dueText === undefined
            ? undefined
            : requireObservedDueAt(snapshot, input.dueAt, input.dueText);
          const evidence = this.#evidence(scanId, snapshot, `Observed assignment ${input.title.trim()} in ${observation}.`);
          const newRequirements = [...(input.requirementExcerpts ?? []), ...(input.instructions ? [{ text: input.instructions, sourceRef: undefined, observationRef: undefined }] : [])];
          for (const excerpt of newRequirements) if (!excerpt.sourceRef) requireAssignmentFact(snapshot, sourceTarget, input.title, excerpt.text, excerpt.observationRef, "requirement excerpt");
          if (input.schoolStatus) {
            requireAssignmentFact(snapshot, sourceTarget, input.title, input.schoolStatus.text, input.schoolStatus.observationRef, "school submission status");
            requireSchoolStatus(input.schoolStatus.state, input.schoolStatus.text);
          }
          let lateUntil: string | undefined;
          if (input.latePolicy) {
            requireAssignmentFact(snapshot, sourceTarget, input.title, input.latePolicy.text, undefined, "late-submission policy");
            if (input.latePolicy.state === "accepted") {
              const text = normalizeFact(input.latePolicy.text);
              const negative = /\b(no|not|never|cannot|can t|closed|expired)\b/.test(text);
              if (negative || !/\b(late|extension|extended|accepted|accepting|open)\b/.test(text)) throw new Error("Late acceptance requires explicit non-contradictory school evidence");
            }
            if (input.latePolicy.until || input.latePolicy.untilText) {
              if (!input.latePolicy.untilText || !includesFact(input.latePolicy.text, input.latePolicy.untilText)) throw new Error("The late cutoff must occur in the observed acceptance statement");
              lateUntil = requireObservedDueAt(snapshot, input.latePolicy.until, input.latePolicy.untilText);
            }
          }
          if (isMoodleIndex(sourceTarget) || schoolIdentity(sourceTarget, "course")) {
            throw new Error("Open the assignment detail page; this list has no unambiguous assignment link");
          }
          // Generic pages without links retain a course/title-scoped identity. This
          // avoids collapsing several list entries into the page's URL.
          const hasLink = snapshot.elements.some(element => element.href === sourceTarget && normalize(element.name).includes(normalize(input.title)));
          const sourceIdentity = schoolIdentity(sourceTarget, "assignment") ?? (hasLink
            ? assignmentIdentity(sourceTarget)
            : `observed|${input.courseId}|${exactTarget(sourceTarget)}|${normalize(input.title)}`);
          if (!selected && hasLink && exactTarget(sourceTarget) !== exactTarget(snapshot.url)) {
            // Upgrade only an unambiguous legacy observation from this very list
            // and course, confirmed now by its actual link (never title alone).
            const candidates = this.#store.assignments.listAll().filter(assignment =>
              assignment.sourceTarget &&
              (assignment.courseId === input.courseId || isMoodleIndex(snapshot.url)) &&
              (!assignment.sourceIdentity || assignment.sourceIdentity.startsWith("observed|")) && exactTarget(assignment.sourceTarget) === exactTarget(snapshot.url) &&
              sameFact(assignment.title, input.title) && (dueAt === undefined || assignment.dueAt === undefined || assignment.dueAt === dueAt));
            if (candidates.length === 1) this.#store.assignments.put({ ...candidates[0], sourceIdentity, sourceTarget });
          }
          const conflicts = selected ? this.#store.assignmentConflicts : reconcileAssignments(this.#store);
          this.#store.assignmentConflicts = conflicts;
          const matches = this.#store.assignments.listAll().filter(assignment =>
            assignment.sourceTarget && ((assignment.sourceIdentity ?? schoolIdentity(assignment.sourceTarget, "assignment")) === sourceIdentity ||
            (assignment.sourceIdentity === assignmentIdentity(sourceTarget)) ||
            ((!assignment.sourceIdentity || assignment.sourceIdentity.startsWith("observed|")) && assignment.courseId === input.courseId &&
              exactTarget(assignment.sourceTarget) === exactTarget(sourceTarget) && sameFact(assignment.title, input.title))));
          const conflict = conflicts.find(item => matches.some(match => item.assignmentIds.includes(match.assignmentId)));
          if (selected && matches.some(match => match.assignmentId !== selected.assignmentId)) throw new Error("This source identifies a different assignment");
          if (matches.length > 1 && !conflict) throw new Error("Assignment identity is ambiguous; open its detail page before recording it");
          // Commit confirmed identity even when merging needs review. Rolling it
          // back would let a later detail scan forget the conflict and run a copy.
          const priorAssignment = selected ?? matches.find(item => item.courseId === input.courseId) ?? matches[0];
          const assignmentId = priorAssignment?.assignmentId ?? stableId("assignment", sourceIdentity);
          if (input.replaceRequirementsFromSource && (snapshot.truncated || snapshot.search || snapshot.nextOffset !== undefined || !newRequirements.length)) throw new Error("Replacing source requirements needs a full unfiltered observation and current excerpts");
          const priorRequirements = (priorAssignment?.requirementEvidence ?? []).filter(item => !input.replaceRequirementsFromSource || exactTarget(item.evidence.sourceTarget) !== exactTarget(snapshot.url));
          const requirementEvidence = mergeRequirementEvidence(priorRequirements, newRequirements.map(item => ({ text: item.text.trim(), evidence: item.sourceRef ? pdf.resolveExcerpt(item.sourceRef, assignmentId, item.text) : evidence })));
          const missingRequirements = input.missingRequirements ?? priorAssignment?.missingRequirements ?? [];
          if (input.requirementsComplete && (!requirementEvidence.length || missingRequirements.length)) throw new Error("Complete requirements need evidence and no unresolved requirements");
          const requirementsChanged = JSON.stringify(requirementEvidence.map(item => item.text).sort()) !== JSON.stringify((priorAssignment?.requirementEvidence ?? []).map(item => item.text).sort());
          let assignment = this.#store.assignments.put({
            schemaVersion: STUDI_SCHEMA_VERSION,
            ...priorAssignment,
            assignmentId,
            courseId: priorAssignment?.courseId ?? input.courseId,
            title: input.title.trim(),
            ...classifyAssignmentKind(input.title, input.instructions ?? priorAssignment?.instructions), kindEvidence: evidence,
            origin: priorAssignment?.origin ?? "school",
            sourceTarget: selected?.sourceTarget ?? sourceTarget,
            sourceIdentity: selected ? selected.sourceIdentity : (!hasLink && priorAssignment?.sourceIdentity?.startsWith("url|")
              ? priorAssignment.sourceIdentity : sourceIdentity),
            ...(input.dueText === undefined ? {} : { dueAt, deadlinePrecision: dueAt ? "datetime" as const : /\d/.test(input.dueText) ? "date" as const : "unknown" as const, deadlineEvidence: evidence }),
            ...(input.instructions === undefined && !input.replaceRequirementsFromSource ? {} : { instructions: input.instructions?.trim() }),
            ...(newRequirements.length ? { requirementEvidence } : {}),
            ...(input.requirementsComplete !== undefined || requirementsChanged || input.missingRequirements !== undefined ? {
              requirementsState: input.requirementsComplete === true ? "complete" as const : "partial" as const,
              missingRequirements,
            } : {}),
            ...(input.schoolStatus ? { schoolStatus: { state: input.schoolStatus.state, text: input.schoolStatus.text, evidence } } : {}),
            ...(input.latePolicy ? { latePolicy: { state: input.latePolicy.state, text: input.latePolicy.text, until: lateUntil, evidence } } : {}),
            ...(input.dueText === undefined ? {} : { dueText: input.dueText.trim() }),
            discoveredAt: priorAssignment?.discoveredAt ?? evidence.capturedAt,
            lastVerifiedScanId: scanId,
            evidence: [...(priorAssignment?.evidence ?? []), evidence],
          });
          // Newly recorded list-page evidence can identify a provisional class.
          // Reconcile now so this scan cannot leave another directory alias behind.
          if (!selected) this.#store.courseConflicts = reconcileCourses(this.#store);
          assignment = this.#store.assignments.get(assignment.assignmentId)!;
          const fields = priorAssignment ? ["title", "dueAt", "dueText", "instructions", "requirementsState", "missingRequirements"].filter(field => JSON.stringify(assignment[field as keyof Assignment]) !== JSON.stringify(priorAssignment[field as keyof Assignment])) : [];
          if (priorAssignment && assignment.schoolStatus?.state !== priorAssignment.schoolStatus?.state) fields.push("schoolStatus");
          if (priorAssignment && JSON.stringify(assignment.requirementEvidence?.map(item => item.text)) !== JSON.stringify(priorAssignment.requirementEvidence?.map(item => item.text))) fields.push("instructions");
          if (priorAssignment && (assignment.latePolicy?.state !== priorAssignment.latePolicy?.state || assignment.latePolicy?.until !== priorAssignment.latePolicy?.until)) fields.push("latePolicy");
          const existingChange = changes.find(change => change.assignmentId === assignmentId);
          const dateChanged = fields.includes("dueAt") || fields.includes("dueText");
          const dueChange = priorAssignment && dateChanged ? {
            before: { dueAt: priorAssignment.dueAt, dueText: priorAssignment.dueText },
            after: { dueAt: assignment.dueAt, dueText: assignment.dueText },
          } : undefined;
          if (existingChange) {
            existingChange.fields = [...new Set([...existingChange.fields, ...fields])];
            if (existingChange.kind === "updated" && dueChange) {
              existingChange.dueChange = { before: existingChange.dueChange?.before ?? dueChange.before, after: dueChange.after };
            }
          } else if (!priorAssignment || fields.length) {
            changes.push({ assignmentId, kind: priorAssignment ? "updated" : "new", fields, ...(dueChange ? { dueChange } : {}) });
          }
          if (!selected && !conflict && !this.#store.courseConflicts.some(item => item.courseIds.includes(assignment.courseId))) this.#ensureTaskOrigin(assignment, scanId);
          return assignment;
        });
        this.#store.school.putScan({
          ...scan,
          updatedAt: this.#now(),
          currentStep: assignments.length === 1
            ? `Verified assignment: ${assignments[0]!.title}`
            : `Verified ${assignments.length} assignments on the current page`,
          changes,
          observedAssignmentIds: assignments.reduce(
            (ids, assignment) => addUnique(ids, assignment.assignmentId),
            scan.observedAssignmentIds,
          ),
        });
        return assignments;
      });
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
        const snapshot = await this.#observe(scanId, [input.observationRef, input.stateObservationRef]);
        const scan = this.#requiredRunningScan(scanId);
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
        if (input.kind === "linked_system_sign_in" && !scan.targetAssignmentId) {
          if (!input.linkedSystemId || !scan.observedLinkedSystemIds.includes(input.linkedSystemId)) {
            throw new Error("A linked-system handoff requires a linked system observed in this scan");
          }
        }
        const snapshot = await this.#observe(scanId);
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

    const inventory = defineTool({
      name: "scan_record_inventory",
      label: "Verify a complete inventory",
      description: "Record the completed course directory or one course's assignment inventory after inspecting every page/filter and recording its items. Supply all discovered item IDs and exact visible text from the final inventory page. An empty inventory requires an explicit empty-list message. Search results and truncated observations cannot prove completeness.",
      parameters: Type.Object({
        kind: Type.Union([Type.Literal("courses"), Type.Literal("assignments")]),
        courseId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
        state: Type.Union([Type.Literal("complete"), Type.Literal("empty")]),
        itemIds: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 10_000 }),
        evidenceText: Type.String({ minLength: 1, maxLength: 300 }),
        observationRef: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
      }, { additionalProperties: false }),
      execute: async (_id, input) => {
        const snapshot = await this.#observe(scanId, [input.observationRef]);
        const scan = this.#requiredRunningScan(scanId);
        if (snapshot.truncated || snapshot.search) throw new Error("Inspect the remaining inventory without a search filter before recording completeness");
        input = { ...input,
          ...(input.courseId ? { courseId: this.#store.school.resolveCourseId(input.courseId) } : {}),
          itemIds: [...new Set(input.itemIds.map(id => resolveRecordId(this.#store.database, input.kind === "courses" ? "course" : "assignment", id)))],
        };
        requireSnapshotFact(snapshot, input.evidenceText, input.observationRef, "inventory evidence");
        if (input.kind === "assignments" && (!input.courseId || !scan.observedCourseIds.includes(input.courseId))) {
          throw new Error("Verify the course before its assignment inventory");
        }
        if (input.kind === "courses" && input.courseId) throw new Error("The course directory cannot have a courseId");
        const expected = input.kind === "courses" ? scan.observedCourseIds : scan.observedAssignmentIds.filter(
          (id) => this.#store.assignments.get(id)?.courseId === input.courseId,
        );
        if (new Set(input.itemIds).size !== input.itemIds.length || input.itemIds.length !== expected.length || expected.some((id) => !input.itemIds.includes(id))) {
          throw new Error("Inventory IDs must match all items recorded for this inventory in the current scan");
        }
        if (input.state === "empty") {
          const empty = input.kind === "assignments"
            ? isEmptyAssignmentIndex(normalizeFact(input.evidenceText))
            : /\b(?:no courses|0 courses)\b/.test(normalizeFact(input.evidenceText));
          if (input.itemIds.length || !empty) throw new Error("An empty inventory requires explicit empty-list evidence and zero recorded items");
        } else if (input.itemIds.length === 0) {
          throw new Error("A complete nonempty inventory needs recorded items");
        }
        // A final page must identify this inventory, rather than an unrelated
        // account dashboard or a different course's empty list.
        if (input.kind === "assignments") {
          const course = this.#store.school.listCourses().find((item) => item.courseId === input.courseId)!;
          requireSnapshotFact(snapshot, course.label, undefined, "inventory course");
        }
        const recorded = {
          kind: input.kind,
          ...(input.courseId ? { courseId: input.courseId } : {}),
          state: input.state,
          itemIds: input.itemIds,
          evidence: this.#evidence(scanId, snapshot, `Inventory ${input.state}: ${input.evidenceText.trim()}`),
        };
        this.#store.school.putScan({
          ...scan,
          inventories: [...scan.inventories.filter((item) => item.kind !== input.kind || item.courseId !== input.courseId), recorded],
          currentStep: input.kind === "courses" ? "Verified the course directory" : "Verified a course's assignment inventory",
          updatedAt: this.#now(),
        });
        return toolResult(recorded);
      },
    });

    const finish = defineTool({
      name: "scan_finish",
      label: "Finish school scan",
      description: "Finish with explicit coverage. Verified targets must use recorded labels, for example Course: Writing 101 or Assignment: Observation paragraph, never URLs. At least one course must have been verified in this scan. Navigation hints must be plain text or Markdown, never HTML.",
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
        if (scan.targetAssignmentId) return toolResult(this.#finishAssignmentCheck(scan, input.coverage));
        if (scan.sourceScanTarget) {
          const assignments = scan.observedAssignmentIds.map(id => this.#store.assignments.get(id)!).filter(Boolean);
          if (!assignments.length) throw new Error("No homework was verified from the added link. Request help or record a failure.");
          if (input.coverage.some(item => item.status === "verified" && !assignments.some(assignment => sameFact(`Assignment: ${assignment.title}`, item.target)))) throw new Error("Report only the assignments verified from this link.");
          const failures = [...input.coverage.flatMap(item => item.status === "verified" ? [] : [item.failure?.trim() || "Some details remain unchecked."]), ...this.#steeredSourceGaps(scan)];
          return toolResult(this.#store.school.putScan({ ...scan, state: failures.length ? "partial" : "succeeded", completedAt: this.#now(), updatedAt: this.#now(), handoff: null,
            currentStep: failures.length ? "Saved homework from your link. Some sources remain unchecked." : "Saved homework from your link.", failures,
            coverage: assignments.map(assignment => ({ target: `Assignment: ${assignment.title}`.slice(0, 200), status: "verified", evidence: assignment.evidence.at(-1) })),
          }));
        }
        if (scan.observedCourseIds.length === 0) {
          this.#fail(scanId, "The scan found no browser-verified courses. Nothing was marked complete.");
          throw new Error("A scan cannot complete without at least one browser-verified course");
        }
        const observedCoverage = this.#verifiedCoverage(scan);
        const observedCourses = this.#store.school.listCourses().filter(course => scan.observedCourseIds.includes(course.courseId));
        const requestedCoverage = input.coverage.flatMap((item) => {
          if (item.status === "verified") {
            const courseAlias = observedCourses.some(course => courseObservations(course)
              .some(observation => sameFact(`Course: ${observation.label}`, item.target)));
            if (!courseAlias && !observedCoverage.some((observed) => sameFact(observed.target, item.target))) {
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
        const inventoryGaps = [...this.#inventoryGaps(scan), ...this.#steeredSourceGaps(scan)].map((failure) => ({
          target: "Inventory coverage", status: "partial" as const, failure,
        }));
        const coverage = [...observedCoverage, ...requestedCoverage, ...inventoryGaps];
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
            this.#reportError(error, scanId);
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

    const tools: ToolDefinition[] = [status, recordCourse, recordAssignment, recordAssignments, recordLinkedSystem, inventory, requestHandoff, finish,
      ...createSourceCheckpointTools({ store: this.#store, scanId, scan: () => this.#requiredRunningScan(scanId),
        observe: () => this.#observe(scanId), evidence: (snapshot, summary) => this.#evidence(scanId, snapshot, summary), now: this.#now,
        checkpointSaved: () => {
          if (++this.#sourceChecksThisSession < this.#maxSourcesPerSession) return;
          this.#rotateSession = true;
          void this.#session?.abort().catch(error => this.#reportError(error, scanId));
        } }),
      pdf.tool,
      defineTool({ name: "scan_add_source", label: "Add a source to this check", description: "Add a student-mentioned or currently visible linked source to this check. Inspect it and save a checked scan_record_source checkpoint before finishing, or explicitly skip it with a reason. This never grants homework permissions.",
        parameters: Type.Object({ sourceTarget: Type.String({ minLength: 1, maxLength: 4096 }) }, { additionalProperties: false }),
        execute: async (_id, input) => {
          const sourceTarget = SafeSourceTargetSchema.parse(input.sourceTarget);
          const snapshot = await this.#observe(scanId);
          const scan = this.#requiredRunningScan(scanId);
          const studentMentioned = scan.messages.some(message => message.role === "user" && message.text.includes(sourceTarget));
          if (!studentMentioned && exactTarget(snapshot.url) !== exactTarget(sourceTarget) && !snapshot.elements.some(element => element.href && exactTarget(element.href) === exactTarget(sourceTarget))) throw new Error("Use a source the student mentioned or a link on the current page.");
          return toolResult(this.#store.school.putScan({ ...scan, updatedAt: this.#now(), addedSourceTargets: addUnique(scan.addedSourceTargets, sourceTarget),
            ...(scan.targetSourceTargets ? { targetSourceTargets: addUnique(scan.targetSourceTargets, sourceTarget) } : {}),
          }));
        },
      }),
      defineTool({ name: "scan_skip_source", label: "Skip a source in this check", description: "Record why a source is skipped. Skipped coverage stays incomplete and is never reported verified.",
        parameters: Type.Object({ sourceTarget: Type.String({ minLength: 1, maxLength: 4096 }), reason: Type.String({ minLength: 1, maxLength: 300 }) }, { additionalProperties: false }),
        execute: async (_id, input) => {
          const sourceTarget = SafeSourceTargetSchema.parse(input.sourceTarget);
          const scan = this.#requiredRunningScan(scanId);
          return toolResult(this.#store.school.putScan({ ...scan, updatedAt: this.#now(), skippedSources: [...scan.skippedSources.filter(item => exactTarget(item.sourceTarget) !== exactTarget(sourceTarget)), { sourceTarget, reason: input.reason.trim() }] }));
        },
      }),
    ];
    if (this.#recordSyllabus) tools.push(defineTool({
      name: "scan_record_syllabus", label: "Save an observed syllabus", description: "Save exact visible syllabus or exam-plan text for a course verified in this scan. Does not infer exam dates, topic weights, or start a model.",
      parameters: Type.Object({ courseId: Type.String({ minLength: 1, maxLength: 256 }), title: Type.String({ minLength: 1, maxLength: 300 }), text: Type.String({ minLength: 1, maxLength: 20000 }), sourceTarget: Type.String({ minLength: 1, maxLength: 4096 }) }, { additionalProperties: false }),
      execute: async (_id, input) => {
        const scan = this.#requiredRunningScan(scanId);
        if (scan.targetAssignmentId || scan.sourceScanTarget) throw new Error("Save syllabus sources during a school check, not a single-homework check.");
        const courseId = this.#store.school.resolveCourseId(input.courseId);
        const course = this.#store.school.listCourses().find(course => course.courseId === courseId);
        if (!course || !scan.observedCourseIds.includes(courseId) || course.lastVerifiedScanId !== scanId) throw new Error("Verify this course before saving its syllabus.");
        const snapshot = await this.#observe(scanId);
        const sourceTarget = SafeSourceTargetSchema.parse(input.sourceTarget);
        if (exactTarget(sourceTarget) !== exactTarget(snapshot.url) || !sameOrigin(sourceTarget, course.sourceTarget)) throw new Error("Open the course's school syllabus page before saving its text.");
        const sourceCourse = schoolIdentity(sourceTarget, "course");
        const knownCourse = courseIdentity(this.#store, course);
        if (sourceCourse && knownCourse && sourceCourse !== knownCourse) throw new Error("This syllabus page belongs to another course.");
        const pathCourse = (target: string) => new URL(target).pathname.match(/\/courses?\/([^/]+)(?:\/|$)/)?.[1];
        const sourcePathCourse = pathCourse(sourceTarget);
        const knownPathCourse = pathCourse(course.sourceTarget);
        if (sourcePathCourse && knownPathCourse && sourcePathCourse !== knownPathCourse) throw new Error("This syllabus page belongs to another course.");
        requireSnapshotFact(snapshot, course.label, undefined, "syllabus course");
        requireSnapshotFact(snapshot, input.title, undefined, "syllabus title");
        const normalizeText = (text: string) => text.replace(/\s+/g, " ").trim();
        if (!normalizeText(input.text) || !normalizeText(snapshot.text).includes(normalizeText(input.text))) throw new Error("Quote syllabus text visible on the current page.");
        this.#requiredRunningScan(scanId);
        return toolResult(await this.#recordSyllabus!({ courseId, title: input.title.trim(), text: input.text.trim(), sourceTarget }));
      },
    }));
    const expectedNames = this.#recordSyllabus ? [...LEGACY_SCAN_TOOL_NAMES, "scan_record_syllabus"] : LEGACY_SCAN_TOOL_NAMES;
    if (tools.some((tool, index) => tool.name !== expectedNames[index])) throw new Error("Scan tools do not match the shared capability contract");
    return tools.map(tool => {
      if (!["scan_record_course", "scan_record_inventory", "scan_record_linked_system"].includes(tool.name)) return tool;
      return { ...tool, execute: async (...args: Parameters<typeof tool.execute>) => {
        if (this.#requiredRunningScan(scanId).targetAssignmentId) throw new Error("An assignment details check cannot change school inventories, courses or linked-system records");
        return tool.execute(...args);
      } };
    });
  }

  async #observe(scanId: string, refs: readonly (string | undefined)[] = []): Promise<BrowserSnapshot> {
    if (this.#rotateSession) throw new Error("Saved source checkpoint; continuing in a fresh scan session.");
    this.#requiredRunningScan(scanId);
    const snapshot = this.#browser.evidenceSnapshot
      ? await this.#browser.evidenceSnapshot([...new Set(refs.filter((ref): ref is string => Boolean(ref)))])
      : await this.#browser.snapshot();
    const scan = this.#requiredRunningScan(scanId);
    if (scan.skippedSources.some(source => exactTarget(source.sourceTarget) === exactTarget(snapshot.url))) throw new Error("This source was skipped. Continue with another source; skipped coverage stays incomplete.");
    if ((scan.targetAssignmentId || scan.sourceScanTarget) && scan.targetSourceTargets?.some(url => exactTarget(url) === exactTarget(snapshot.url))) {
      const links = snapshot.elements.flatMap(element => {
        const parsed = SafeSourceTargetSchema.safeParse(element.href);
        return parsed.success ? [parsed.data] : [];
      });
      this.#store.school.putScan({ ...scan, targetSourceTargets: [...new Set([...scan.targetSourceTargets, ...links])].slice(0, 500) });
    }
    return snapshot;
  }

  #inventoryGaps(scan: SchoolScan): string[] {
    if (scan.targetAssignmentId) return [];
    const sameIds = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((id) => right.includes(id));
    const gaps: string[] = [];
    for (const source of scan.sourceCheckpoints) {
      if (source.scanId === scan.scanId && source.state === "blocked") gaps.push(source.note ?? "A source remains blocked.");
    }
    if (!scan.inventories.some((item) => item.kind === "courses" && sameIds(item.itemIds, scan.observedCourseIds))) {
      gaps.push("The complete course directory has not been verified.");
    }
    for (const courseId of scan.observedCourseIds) {
      const assignmentIds = scan.observedAssignmentIds.filter((id) => this.#store.assignments.get(id)?.courseId === courseId);
      if (!scan.inventories.some((item) => item.kind === "assignments" && item.courseId === courseId && sameIds(item.itemIds, assignmentIds))) {
        const course = this.#store.school.listCourses().find((item) => item.courseId === courseId);
        gaps.push(`The assignment inventory for ${course?.label ?? courseId} has not been verified.`);
      }
    }
    return gaps;
  }

  #checkpoint(scanId: string) {
    const scan = this.#store.school.getScan(scanId);
    if (!scan) throw new Error("Scan does not exist");
    return {
      scan: { scanId: scan.scanId, targetAssignmentId: scan.targetAssignmentId, state: scan.state, currentStep: scan.currentStep, inventories: scan.inventories,
        sourceCheckpoints: scan.sourceCheckpoints, failures: scan.failures, messages: scan.messages.slice(-10),
        sourceScanTarget: scan.sourceScanTarget, targetSourceTargets: scan.targetSourceTargets, addedSourceTargets: scan.addedSourceTargets, skippedSources: scan.skippedSources,
        observedCourseIds: scan.observedCourseIds, observedAssignmentIds: scan.observedAssignmentIds, observedLinkedSystemIds: scan.observedLinkedSystemIds },
      courses: this.#store.school.listCourses().filter((course) => scan.observedCourseIds.includes(course.courseId)),
      assignments: scan.observedAssignmentIds.flatMap((id) => {
        const assignment = this.#store.assignments.get(id);
        return assignment ? [{ assignmentId: id, courseId: assignment.courseId, title: assignment.title,
          sourceTarget: assignment.sourceTarget, dueAt: assignment.dueAt, dueText: assignment.dueText,
          schoolStatus: assignment.schoolStatus?.state, requirementsState: assignment.requirementsState,
          eligibility: assignmentWorkEligibility(assignment, this.#now()) }] : [];
      }),
      linkedSystems: this.#store.school.listLinkedSystems().filter((system) => scan.observedLinkedSystemIds.includes(system.linkedSystemId)),
      gaps: this.#inventoryGaps(scan),
    };
  }

  #assignmentScopePrompt(scan: SchoolScan): string {
    const assignment = this.#store.assignments.get(scan.targetAssignmentId!)!;
    return `Check only this selected assignment: ${JSON.stringify(assignment)}.
This is a read-only details check, including after a pause, restart or session rotation. It does not authorize starting homework, entering answers, saving drafts or submitting. Do not scan other assignments or record courses/inventories/linked systems.
Take fresh snapshots of the saved source and its relevant observed links. Call scan_check_source before following a page's links so their observed destinations are saved. Use scan_read_assignment for saved evidence. Record facts using this exact courseId and title; retain the same assignment identity. Gather missing instructions, rubric, deliverables, deadline and current submission state, with separate requirementExcerpts and explicit missingRequirements. If a linked page cannot be tied to this assignment, leave that question unresolved. For already submitted, graded or locked work, record the current state and stop investigating requirements for new work.
For login, request a school_sign_in handoff with the exact blocker; resume this same assignment when the student returns. Use scan_record_source for progress. When the selected assignment's facts and linked materials are checked, stop; Studi finishes this focused check. Do not claim the whole school is complete. A successful details check does not start work.`;
  }

  #finishAssignmentCheck(scan: SchoolScan, requested: readonly { target: string; status: "verified" | "partial" | "failed"; failure?: string }[]): SchoolScan {
    const assignment = this.#store.assignments.get(scan.targetAssignmentId!)!;
    const target = `Assignment: ${assignment.title}`.slice(0, 200);
    if (requested.some(item => item.status === "verified" && !sameFact(item.target, target))) throw new Error("This check can verify only the selected assignment");
    const recorded = scan.observedAssignmentIds.includes(assignment.assignmentId);
    const statusEvidence = assignment.schoolStatus?.evidence;
    const currentStatus = statusEvidence && Date.parse(statusEvidence.capturedAt) >= Date.parse(scan.startedAt)
      && statusEvidence.evidenceId.includes(scan.scanId);
    const terminal = currentStatus && ["submitted", "graded", "locked"].includes(assignment.schoolStatus!.state);
    const eligibility = assignmentWorkEligibility(assignment, this.#now());
    const failures = [...requested.flatMap(item => item.status === "verified" ? [] : [item.failure?.trim() || "Some assignment details still need checking."]), ...this.#steeredSourceGaps(scan)];
    for (const source of scan.sourceCheckpoints) if (source.scanId === scan.scanId && source.state === "blocked") failures.push(source.note ?? "An assignment source is blocked.");
    if (!recorded || !currentStatus) failures.push("The assignment's current school status still needs checking.");
    else if (!terminal && !eligibility.eligible) failures.push(eligibility.reason);
    const succeeded = failures.length === 0;
    const evidence = [...assignment.evidence].reverse().find(item => item.evidenceId.includes(scan.scanId));
    const finished = this.#store.school.putScan({ ...scan, state: succeeded ? "succeeded" : "partial", updatedAt: this.#now(), completedAt: this.#now(), handoff: null,
      currentStep: succeeded ? terminal ? "School status checked. This assignment will not be started." : "Assignment details checked. Ready when you choose to start." : "Saved assignment details. Some questions remain.",
      failures: [...new Set(failures)], coverage: [{ target, status: succeeded ? "verified" : "partial", ...(succeeded ? { evidence } : { failure: failures[0] }) }],
    });
    this.#updateProfileState(this.#requiredProfile().onboardingCompletedAt ? "ready" : "profile_saved");
    return finished;
  }

  #ensureTaskOrigin(assignment: Assignment, scanId: string): void {
    const existing = this.#store.tasks.listAll().find((task) => task.assignmentId === assignment.assignmentId);
    const task = existing ?? this.#createTaskOrigin(assignment, scanId);
    this.#manager?.reconcileQueue();
    if (!this.#manager || (task.state !== "discovered" && task.state !== "queued")) return;
    const permission = this.#manager.resolvePermission(assignment.assignmentId, assignment.courseId);
    if (this.#manager.allowsAutomaticWork && permission.mayAttempt && assignmentWorkEligibility(assignment, this.#now()).eligible) this.#manager.enqueue({ taskId: task.taskId, requestOrigin: "automatic" });
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

  #steeredSourceGaps(scan: SchoolScan): string[] {
    const skipped = new Set(scan.skippedSources.map(item => exactTarget(item.sourceTarget)));
    const checked = new Set(scan.sourceCheckpoints.filter(item => item.state === "checked").map(item => exactTarget(item.sourceTarget)));
    return [
      ...scan.skippedSources.map(item => `Skipped source: ${item.reason}`),
      ...scan.addedSourceTargets.filter(target => !skipped.has(exactTarget(target)) && !checked.has(exactTarget(target)))
        .map(target => `Added source still needs checking: ${target}`.slice(0, 500)),
    ];
  }

  #requiredRunningScan(scanId: string): SchoolScan {
    this.#assertUsable();
    if (this.#takingOver) throw new Error("The student is taking over the browser");
    const scan = this.#store.school.getScan(scanId);
    if (!scan || scan.state !== "running") {
      throw new Error("This scan is no longer accepting browser evidence");
    }
    if (scan.targetAssignmentId && !this.#store.assignments.get(scan.targetAssignmentId)) throw new Error("The selected assignment is no longer available. Reopen it from your week.");
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

  #reportError(error: unknown, scanId: string, toolName?: string): void {
    try { this.#onError(error, scanId, toolName); } catch { /* Reporting must not stop a scan. */ }
  }

  #fail(scanId: string, reason: string): void {
    reason = reason.slice(0, 500);
    const scan = this.#store.school.getScan(scanId);
    if (!scan || scan.state !== "running") return;
    const completedAt = this.#now();
    this.#store.school.putScan({
      ...scan,
      state: "failed",
      runtimeLoginRecoveredAt: undefined,
      updatedAt: completedAt,
      completedAt,
      currentStep: reason,
      failures: addUnique(scan.failures, reason),
      handoff: null,
    });
    this.#updateProfileState("profile_saved");
  }

  #updateProfileState(onboardingState: SchoolProfile["onboardingState"]): void {
    const latest = this.#store.school.latestScan();
    if (latest?.targetAssignmentId || latest?.sourceScanTarget) return;
    const profile = this.#store.school.getProfile();
    if (profile) {
      const scan = this.#store.school.latestScan();
      const onboardingCompletedAt = profile.onboardingCompletedAt ?? (scan?.completedAt && ["succeeded", "partial"].includes(scan.state) && scan.coverage.length ? scan.completedAt : undefined);
      this.#store.school.putProfile({ ...profile, ...(onboardingCompletedAt ? { onboardingCompletedAt } : {}), onboardingState, updatedAt: this.#now() });
    }
  }

  async #writeWorkflowHints(scanId: string, hints: readonly string[]): Promise<void> {
    const scan = this.#store.school.getScan(scanId);
    if (!scan || scan.state !== "succeeded" || scan.targetAssignmentId) return;
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
    // Each snapshot rotates refs. Revalidate stale refs against fresh page facts.
    if (!element) return requireSnapshotFact(snapshot, fact, undefined, label);
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
  dueAt: string | undefined,
  dueText: string | undefined,
): string | undefined {
  if (!dueText) throw new Error("A due date requires the exact visible due-date text from the current snapshot");
  requireSnapshotFact(snapshot, dueText, undefined, "assignment due date");
  const hasTime = /\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(?:am|pm)\b|T\d{2}:\d{2}/i.test(dueText);
  if (!hasTime) {
    if (dueAt !== undefined) throw new Error("A date-only deadline cannot claim an exact time");
    return undefined;
  }
  // Keep ambiguous dates as visible text rather than inventing a year or deadline.
  const parsedText = /\b\d{4}\b/.test(dueText)
    ? parseZonedDeadline(dueText) ?? Date.parse(dueText.replace(/\s+at\s+/i, " ").replace(/(\d)(am|pm)\b/ig, "$1 $2"))
    : NaN;
  if (dueAt === undefined) return Number.isFinite(parsedText) ? new Date(parsedText).toISOString() : undefined;
  const parsedDueAt = Date.parse(dueAt);
  if (!Number.isFinite(parsedDueAt) || !Number.isFinite(parsedText) || parsedDueAt !== parsedText) {
    throw new Error("The claimed due date does not match the visible due-date text");
  }
  return new Date(parsedDueAt).toISOString();
}

function requireAssignmentFact(snapshot: BrowserSnapshot, target: string, title: string, text: string, ref: string | undefined, label: string): void {
  requireSnapshotFact(snapshot, text, ref, label);
  if (exactTarget(snapshot.url) === exactTarget(target) && !isMoodleIndex(target)) return;
  const row = snapshot.elements.find(element => (!ref || element.ref === ref) && includesFact(`${element.name} ${element.value ?? ""}`, title) && includesFact(`${element.name} ${element.value ?? ""}`, text));
  if (!row) throw new Error(`Open the assignment detail page or provide a row containing its title and ${label}`);
}

function requireSchoolStatus(state: NonNullable<Assignment["schoolStatus"]>["state"], text: string): void {
  const fact = normalizeFact(text);
  const negative = /\b(not submitted|no submissions?|nothing submitted|not yet submitted|no attempts?|not attempted|to do)\b/g;
  const notSubmitted = Boolean(fact.match(negative));
  const positive = /\b(submitted|submission received|finished|completed)\b/.test(fact.replace(negative, ""));
  const markers = {
    unknown: true,
    not_submitted: notSubmitted && !positive && !/\b(locked|closed|no more attempts)\b/.test(fact),
    submitted: !notSubmitted && positive,
    graded: !/\b(not graded|ungraded|no grade|awaiting grade|pending|not yet)\b/.test(fact)
      && (/\bgraded\b/.test(fact) || /\b(grade|current score|final score)\b.*(?:\d|\b[abcdf]\b)/.test(fact)),
    locked: /\b(locked|closed|no more attempts|not available|unavailable)\b/.test(fact),
  };
  if (!markers[state]) throw new Error("School status does not match the visible status text");
}

function mergeRequirementEvidence(prior: NonNullable<Assignment["requirementEvidence"]>, incoming: NonNullable<Assignment["requirementEvidence"]>) {
  const items = new Map(prior.map(item => [normalizeFact(item.text), item]));
  for (const item of incoming) items.set(normalizeFact(item.text), item);
  if (items.size > 100) throw new Error("This assignment has too many requirement excerpts; consolidate verified excerpts before recording more");
  return [...items.values()];
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
    return Boolean(assignment?.sourceTarget && sameOrigin(assignment.sourceTarget, input.snapshot.url));
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
    .some((marker) => fact.includes(marker))
    || /\b(?:hasn t|has not) released any assignments yet\b/u.test(fact);
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

// Labels describe observed work. Only explicit student confirmation adds permission pattern matches.
function classifyAssignmentKind(title: string, instructions = ""): Pick<Assignment, "kind" | "possibleKinds" | "kindConfidence"> {
  const text = `${title} ${instructions}`.toLowerCase();
  const markers: [NonNullable<Assignment["kind"]>, RegExp][] = [
    ["group_work", /\b(group (work|project|assignment)|team project)\b/],
    ["quiz", /\b(quiz|quizzes)\b/], ["code", /\b(coding|programming|implement|source code)\b/],
    ["essay", /\b(essay|research paper)\b/], ["discussion", /\b(discussion|forum post)\b/],
    ["problem_set", /\b(problem set|problem sheet|worksheet)\b/], ["reading", /\b(reading|read chapter)\b/],
  ];
  const possibleKinds = markers.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
  const explicit = possibleKinds.length === 1 && markers.some(([kind, pattern]) => kind === possibleKinds[0] && pattern.test(title.toLowerCase()));
  return { possibleKinds, kind: possibleKinds.length === 1 ? possibleKinds[0] : undefined, kindConfidence: explicit ? "explicit" : "uncertain" };
}

/** Provider failures may contain JSON; preserve the useful message without its response body. */
function providerFailureText(reason: string): string {
  const json = reason.indexOf("{");
  if (json === -1) return reason;
  const prefix = reason.slice(0, json).trim();
  try {
    const parsed = JSON.parse(reason.slice(json)) as { error?: { message?: unknown }; message?: unknown };
    const message = parsed.error?.message ?? parsed.message;
    if (typeof message === "string" && message.trim()) return `${prefix} ${message}`.trim();
  } catch { /* Use the provider prefix when its response is not readable JSON. */ }
  return prefix || "The provider returned an unreadable error. Try reconnecting your subscription.";
}
