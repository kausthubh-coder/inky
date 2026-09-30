import type { Assignment } from "./assignment.js";
import type { AssignmentExecution } from "./lifecycle.js";
import type { Task } from "./task.js";

// One answer to "where is this assignment?", for every screen: the week, the list, the assignment page,
// chat and the icon badge. It reads the task, its latest run, the school's own status and the rule.
export type HomeworkState =
  | "not_started" // Dot may do it; nobody has started.
  | "left_to_you" // The rule leaves it to the student.
  | "scheduled" // Waiting in the queue: next, or at its planned time.
  | "working"
  | "waiting" // Dot needs the student: see `needs`.
  | "ready" // Done; the student checks it.
  | "handing_in"
  | "handed_in" // Handed in through Studi, with a receipt.
  | "handed_in_at_school" // The school already has it; Studi didn't touch it.
  | "stopped" // Stopped with the work saved.
  | "stuck" // Stopped by a problem; `reason` says what.
  | "yours" // The student is doing it.
  | "ignored"; // Marked done or not homework.

export type HomeworkRecord = {
  readonly state: HomeworkState;
  readonly needs?: NonNullable<AssignmentExecution["needs"]>;
  readonly reason?: string;
};

export function homeworkRecord(input: {
  readonly assignment: Pick<Assignment, "owner" | "ignoredReason" | "schoolStatus">;
  readonly task?: Pick<Task, "state"> | null;
  readonly execution?: Pick<AssignmentExecution, "phase" | "needs" | "lastError"> | null;
  readonly mayAttempt: boolean;
}): HomeworkRecord {
  const { assignment, task, execution, mayAttempt } = input;
  if (assignment.ignoredReason || task?.state === "ignored") return { state: "ignored" };
  if (assignment.owner === "student") return { state: "yours" };
  // Waiting in the queue is the news, even when an earlier run left saved work.
  if (task?.state === "queued") return { state: "scheduled" };
  switch (execution?.phase) {
    case "working": return { state: "working" };
    case "needs_user": return { state: "waiting", needs: execution.needs ?? "browser", ...(execution.lastError ? { reason: execution.lastError } : {}) };
    case "ready_review": return { state: "ready" };
    case "submitting": return { state: "handing_in" };
    case "submitted": return { state: "handed_in" };
    case "preserved": return { state: "stopped", ...(execution.lastError ? { reason: execution.lastError } : {}) };
    case "failed":
      // A run the student cancelled keeps its work; anything else is a problem Dot names.
      return execution.lastError === "Cancelled by the student." ? { state: "stopped" } : { state: "stuck", reason: execution.lastError ?? "Dot couldn't finish." };
  }
  const atSchool = assignment.schoolStatus?.state;
  if (atSchool === "submitted" || atSchool === "graded") return { state: "handed_in_at_school" };
  if (task?.state === "cancelled") return { state: "stopped" };
  return { state: mayAttempt ? "not_started" : "left_to_you" };
}
