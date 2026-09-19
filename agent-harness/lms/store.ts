import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  activityById,
  SchoolError,
  unavailableReason,
  validateState,
  type Effect,
  type SchoolState,
  type Upload,
  type Service,
} from "./domain.js";
import { createScenario, refreshSyllabus } from "./scenarios.js";

export interface AdvanceOptions {
  activityId?: string;
  service?: Service;
  answer?: string;
  minutes?: number;
  examId?: string;
}

function mergeUploads(previous: Upload[], incoming: Upload[]): Upload[] {
  // Re-uploading a corrected source file replaces that draft version.
  return [...new Map([...previous, ...incoming].map((file) => [file.name, file])).values()];
}

export class SchoolStore {
  readonly database: DatabaseSync;
  readonly runId: string;
  constructor(
    readonly directory: string,
    scenarioId: string,
    seed: number,
    resume = false,
    initialState?: SchoolState,
  ) {
    mkdirSync(directory, { recursive: true });
    const path = join(directory, "school.sqlite");
    if (existsSync(path) && !resume)
      throw new Error("Run already exists. Use resume or a new run directory.");
    if (!existsSync(path) && resume)
      throw new Error("Cannot resume a missing run.");
    this.database = new DatabaseSync(path);
    this.database.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS school (id INTEGER PRIMARY KEY CHECK(id=1), run_id TEXT NOT NULL, state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS effects (sequence INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL)",
    );
    const existing = this.database
      .prepare("SELECT run_id FROM school WHERE id=1")
      .get();
    this.runId = existing ? String(existing.run_id) : randomUUID();
    if (!existing) {
      const initial = initialState ?? createScenario(scenarioId, seed);
      validateState(initial);
      this.database
        .prepare("INSERT INTO school (id,run_id,state) VALUES (1,?,?)")
        .run(this.runId, JSON.stringify(initial));
    }
    validateState(this.read());
  }
  read(): SchoolState {
    return JSON.parse(
      String(
        this.database.prepare("SELECT state FROM school WHERE id=1").get()!
          .state,
      ),
    );
  }
  effects(): Effect[] {
    return this.database
      .prepare("SELECT sequence,event FROM effects ORDER BY sequence")
      .all()
      .map((row) => ({
        ...JSON.parse(String(row.event)),
        sequence: Number(row.sequence),
      }));
  }
  change<T>(
    type: string,
    detail: Record<string, unknown>,
    mutate: (state: SchoolState) => T,
    activityId?: string,
  ): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const state = this.read();
      const result = mutate(state);
      state.revision++;
      this.database
        .prepare("UPDATE school SET state=? WHERE id=1")
        .run(JSON.stringify(state));
      this.database.prepare("INSERT INTO effects (event) VALUES (?)").run(
        JSON.stringify({
          type,
          at: state.clock,
          ...(activityId ? { activityId } : {}),
          detail,
        }),
      );
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
  record(
    type: string,
    detail: Record<string, unknown>,
    activityId?: string,
  ): void {
    const state = this.read();
    this.database.prepare("INSERT INTO effects (event) VALUES (?)").run(
      JSON.stringify({
        type,
        at: state.clock,
        ...(activityId ? { activityId } : {}),
        detail,
      }),
    );
  }
  save(id: string, answer: string, files: Upload[], revision: number, submissionTimeout = false): void {
    this.change(
      "draft_saved",
      { fileCount: files.length, answerBytes: Buffer.byteLength(answer) },
      (state) => {
        const activity = activityById(state, id),
          reason = unavailableReason(state, activity);
        if (reason) throw new SchoolError(409, reason);
        const previous = state.drafts[id];
        if ((previous?.revision ?? 0) !== revision)
          throw new SchoolError(
            409,
            "This draft changed in another tab. Reload before saving again.",
          );
        state.drafts[id] = {
          answer,
          files: mergeUploads(previous?.files ?? [], files),
          revision: revision + 1,
        };
        activity.status = "draft";
        if (submissionTimeout) {
          state.faults.assignmentTimeoutsRemaining = Math.max(0, (state.faults.assignmentTimeoutsRemaining ?? 0) - 1);
          // record() participates in this transaction: a restart cannot retain
          // the draft while forgetting that this timeout was consumed.
          this.record("fault_triggered", { fault: "double-timeout", action: "submit" }, id);
        }
      },
      id,
    );
  }
  submit(
    id: string,
    answer: string,
    files: Upload[],
    revision: number,
    key: string,
  ): { receiptId: string; repeated: boolean } {
    if (!key || key.length > 200)
      throw new SchoolError(400, "A submission key is required.");
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          id,
          answer,
          revision,
          files: files.map((file) => ({ hash: file.hash, name: file.name })),
        }),
      )
      .digest("hex");
    const replay = this.read().submissions.some(
      (item) => item.activityId === id && item.idempotencyKey === key,
    );
    return this.change(
      replay ? "submission_replayed" : "submission_committed",
      { key },
      (state) => {
        const previous = state.submissions.find(
          (item) => item.activityId === id && item.idempotencyKey === key,
        );
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            throw new SchoolError(
              409,
              "This submission key was already used for different work.",
            );
          return { receiptId: previous.id, repeated: true };
        }
        const activity = activityById(state, id),
          reason = unavailableReason(state, activity);
        if (reason) throw new SchoolError(409, reason);
        const draft = state.drafts[id];
        if ((draft?.revision ?? 0) !== revision)
          throw new SchoolError(
            409,
            "Reload the current draft before submitting.",
          );
        if (!answer.trim())
          throw new SchoolError(400, "Enter a response before submitting.");
        const submittedFiles = mergeUploads(draft?.files ?? [], files);
        for (const extension of activity.requiredFiles)
          if (
            !submittedFiles.some((file) =>
              file.name.toLowerCase().endsWith(extension),
            )
          )
            throw new SchoolError(
              400,
              `Upload the required ${extension} file before submitting.`,
            );
        const receiptId = randomUUID();
        for (const name of activity.requiredFileNames ?? []) {
          const matches = submittedFiles.filter((file) => file.name === name);
          if (matches.length !== 1 || matches[0]!.bytes === 0)
            throw new SchoolError(400, `Upload exactly one nonempty ${name} file before submitting.`);
        }
        state.submissions.push({
          id: receiptId,
          activityId: id,
          submittedAt: state.clock,
          answer,
          files: submittedFiles,
          idempotencyKey: key,
          fingerprint,
        });
        state.drafts[id] = {
          answer,
          files: submittedFiles,
          revision: revision + 1,
        };
        activity.status = "submitted";
        if (!state.completed.includes(id)) state.completed.push(id);
        return { receiptId, repeated: false };
      },
      id,
    );
  }
  complete(id: string): void {
    this.change(
      "lesson_completed",
      {},
      (state) => {
        const activity = activityById(state, id);
        if (activity.kind !== "lesson")
          throw new SchoolError(400, "Only lessons can be marked complete.");
        if (
          activity.prerequisites.some((key) => !state.completed.includes(key))
        )
          throw new SchoolError(409, "Complete the prerequisites first.");
        if (!state.completed.includes(id)) state.completed.push(id);
        activity.status = "submitted";
      },
      id,
    );
  }
  advance(event: string, options: AdvanceOptions = {}): void {
    this.change("school_advanced", { event, ...options }, (state) => {
      if (event === "next-week") {
        state.clock = "2026-09-20T16:00:00.000Z";
        state.courses.find((course) => course.id === "programming")!.title =
          "Programming in C (Section 01)";
        const changed = activityById(state, "exercise-05");
        changed.dueAt = "2026-09-23T03:59:00.000Z";
        changed.dueText = "September 22 at 11:59 PM";
        changed.closeAt = "2026-09-25T03:59:00.000Z";
        changed.announcement =
          "The exercise deadline was moved to September 22.";
        if (!state.activities.some((item) => item.id === "exercise-08"))
          state.activities.push({
            ...changed,
            id: "exercise-08",
            title: "Exercise 08",
            status: "not_started",
          });
        state.activities = state.activities.filter(
          (item) => item.id !== "closed-exercise",
        );
      } else if (event === "deadline-change") {
        const changed =
          state.activities.find((item) => item.id === "exercise-05") ??
          activityById(state, "observation");
        changed.dashboardDueText = changed.dueText;
        changed.dueAt = "2026-09-17T03:59:00.000Z";
        changed.dueText = "September 16, 2026 at 11:59 PM America/New_York";
        changed.announcement =
          "The due date has changed to September 16 at 11:59 PM Eastern. The dashboard may still show the old date.";
      } else if (event === "restore-access") {
        state.sessions.school = true;
        state.sessions.statistics = true;
        state.sessions.feedback = true;
      } else if (event === "expire-session") {
        const service = options.service ?? "school";
        if (!Object.hasOwn(state.sessions, service)) throw new SchoolError(400, "Unknown service.");
        state.sessions[service] = false;
      } else if (event === "student-edit") {
        const id = options.activityId ?? "observation";
        const item = activityById(state, id);
        const reason = unavailableReason(state, item);
        if (reason) throw new SchoolError(409, reason);
        const previous = state.drafts[id];
        const answer = options.answer ?? "Student edit: rain drummed on the green awning.";
        if (typeof answer !== "string" || answer.length > 100_000)
          throw new SchoolError(400, "Invalid student response.");
        state.drafts[id] = { answer, files: previous?.files ?? [], revision: (previous?.revision ?? 0) + 1 };
        item.status = "draft";
      } else if (event === "advance-minutes") {
        const minutes = options.minutes;
        if (typeof minutes !== "number" || !Number.isSafeInteger(minutes) || minutes <= 0 || minutes > 525_600)
          throw new SchoolError(400, "Minutes must be an integer from 1 to 525600.");
        state.clock = new Date(Date.parse(state.clock) + minutes * 60_000).toISOString();
      } else if (event === "double-timeout") {
        state.faults.assignmentTimeoutsRemaining = 2;
      } else if (event === "exam-moved") {
        const exam = state.exams?.find((item) => item.id === (options.examId ?? "structures-midterm"));
        if (!exam) throw new SchoolError(400, "Exam not found.");
        // Fixed replacement makes operator retries idempotent.
        exam.date = "2026-09-24T17:00:00.000Z";
        const syllabus = state.syllabi?.find((item) => item.courseId === exam.courseId);
        if (syllabus) {
          syllabus.updatedAt = state.clock;
          refreshSyllabus(state, exam.courseId);
        }
      } else if (event === "release-feedback") {
        const item = activityById(state, "hidden-feedback");
        item.gradeVisible = true;
        item.grade = 86;
        item.status = "graded";
      } else if (event === "build-success") {
        state.builds = state.builds.map((build) =>
          build.revision === "rev-current"
            ? {
                ...build,
                state: "success",
                description: "Current revision passed all checks.",
              }
            : build,
        );
      } else throw new SchoolError(400, "Unknown school event.");
    });
  }
  close(): void {
    this.database.close();
  }
}
