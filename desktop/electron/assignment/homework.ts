import { randomUUID } from "node:crypto";
import { AddAssignmentInputSchema, CorrectAssignmentInputSchema, SetAssignmentOwnerInputSchema, SafeSourceTargetSchema,
  type AddAssignmentInput, type CorrectAssignmentInput, type SetAssignmentOwnerInput } from "../../shared/index.js";
import type { LocalStore } from "../storage/index.js";
import type { ManagerCoordinator } from "../manager/coordinator.js";
import type { SchoolScanCoordinator } from "../scan/coordinator.js";

export class HomeworkCoordinator {
  constructor(private readonly store: LocalStore, private readonly manager: ManagerCoordinator,
    private readonly scan: SchoolScanCoordinator, private readonly now = () => new Date().toISOString()) {}

  async correctAssignment(value: CorrectAssignmentInput) {
    const input = CorrectAssignmentInputSchema.parse(value);
    this.store.database.transaction(() => {
      const assignment = this.store.assignments.get(input.assignmentId);
      if (!assignment) throw new Error("This assignment is no longer available.");
      if (input.correction === "due_date") this.store.assignments.setStudentDueDate(assignment.assignmentId, input.dueAt, this.now());
      else {
        this.manager.ignoreAssignment(assignment.assignmentId, input.reason ?? (input.correction === "already_done" ? "You already did this work." : "You marked this as not homework."));
        this.store.assignments.put({ ...assignment, ignoredReason: input.correction, ignoredNote: input.reason });
      }
      this.manager.reconcileQueue();
    });
    return this.scan.state();
  }

  async addAssignment(value: AddAssignmentInput) {
    const input = AddAssignmentInputSchema.parse(value);
    if (/^https?:\/\//i.test(input.text)) return this.scan.startSourceScan(SafeSourceTargetSchema.parse(input.text));
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(input.text)) throw new Error("Use an HTTP or HTTPS school link.");
    if (input.text.length > 500) throw new Error("Use a homework title of up to 500 characters.");
    const courseId = input.courseId ? this.store.school.resolveCourseId(input.courseId) : "manual-homework";
    if (input.courseId && !this.store.school.listCourses().some(course => course.courseId === courseId)) throw new Error("Choose a class from your school check.");
    const now = this.now();
    this.store.database.transaction(() => {
      const assignmentId = `assignment-${randomUUID()}`;
      this.store.assignments.put({ schemaVersion: 1, assignmentId, courseId, title: input.text, origin: "manual", discoveredAt: now, evidence: [] });
      const task = { schemaVersion: 1 as const, taskId: `task-${randomUUID()}`, assignmentId, state: "discovered" as const, revision: 0, createdAt: now, updatedAt: now };
      this.store.tasks.append({ expectedRevision: null, projection: task, event: {
        schemaVersion: 1, eventId: `event-${randomUUID()}`, aggregateType: "task", aggregateId: task.taskId,
        runId: `manual-${randomUUID()}`, sequence: 0, occurredAt: now, type: "task_created", payload: {
          taskId: task.taskId, assignmentId, state: "discovered", revision: 0, createdAt: now, updatedAt: now,
        },
      } });
    });
    return this.scan.state();
  }

  async setAssignmentOwner(value: SetAssignmentOwnerInput) {
    const input = SetAssignmentOwnerInputSchema.parse(value);
    await this.manager.setAssignmentOwner(input.assignmentId, input.owner);
    return this.scan.state();
  }
}
