import type {
  Assignment,
  TaskState,
  SchoolOnboardingState,
} from "../../shared/index.js";

export function courseLabel(
  courseId: string,
  courses: SchoolOnboardingState["courses"],
): string {
  return (
    courses.find((course) => course.courseId === courseId)?.label ??
    (courseId === "manual-homework" ? "Personal work" : "Homework")
  );
}

// Keep a class's existing calendar color everywhere its assignments appear.
export function courseTone(course: string): number {
  return (
    [...course].reduce(
      (total, character) => total + character.charCodeAt(0),
      0,
    ) % 6
  );
}

export function taskStatusCopy(
  state: TaskState | string,
  assignment?: Assignment,
): { label: string; tone: "plain" | "mint" | "yellow" | "coral" } {
  if (["discovered", "queued", "failed", "cancelled"].includes(state)) {
    if (assignment?.schoolStatus?.state === "submitted")
      return { label: "Submitted at school", tone: "mint" };
    if (assignment?.schoolStatus?.state === "graded")
      return { label: "Graded at school", tone: "mint" };
    if (assignment?.schoolStatus?.state === "locked")
      return { label: "Locked at school", tone: "plain" };
  }
  switch (state) {
    case "discovered":
      return { label: "Not started", tone: "plain" };
    case "queued":
      return { label: "Queued", tone: "plain" };
    case "working":
      return { label: "Inky is working", tone: "yellow" };
    case "needs_user":
      return { label: "Paused · needs you", tone: "coral" };
    case "ready_review":
      return { label: "Ready for review", tone: "yellow" };
    case "submitting":
      return { label: "Checking submission", tone: "yellow" };
    case "submitted":
      return { label: "Submitted", tone: "mint" };
    case "preserved":
      return { label: "Answers saved", tone: "mint" };
    case "failed":
      return { label: "Couldn’t finish", tone: "coral" };
    case "cancelled":
      return { label: "Stopped", tone: "plain" };
    case "ignored":
      return { label: "Won’t attempt", tone: "plain" };
    default:
      return { label: "Status unavailable", tone: "plain" };
  }
}
import type { LifecycleState, TaskSummary } from "../../shared/index.js";

export function assignmentState(
  task: TaskSummary | null,
  execution: LifecycleState["execution"],
) {
  return execution?.phase === "failed" && task?.task.state === "cancelled"
    ? "cancelled"
    : (execution?.phase ?? task?.task.state);
}
