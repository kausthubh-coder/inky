import type {
  Assignment,
  LifecycleState,
  TaskSummary,
} from "../../shared/index.js";

export type TodayItem = {
  assignment: Assignment;
  task: TaskSummary | null;
  phase: string;
  due: number | null;
};
export type TodayGroups = Record<
  "needs" | "working" | "next" | "later" | "undated" | "submitted" | "done",
  TodayItem[]
>;

export function assignmentDue(assignment: Assignment): number | null {
  const value = Date.parse(assignment.dueAt ?? assignment.dueText ?? "");
  return Number.isFinite(value) ? value : null;
}

/** Saved facts choose the groups. Permission and scheduling remain backend decisions. */
export function todayGroups(
  assignments: readonly Assignment[],
  tasks: readonly TaskSummary[],
  lifecycle: LifecycleState,
  now: Date,
): TodayGroups {
  const groups: TodayGroups = {
    needs: [],
    working: [],
    next: [],
    later: [],
    undated: [],
    submitted: [],
    done: [],
  };
  const taskMap = new Map(
    tasks.map((task) => [task.assignment.assignmentId, task]),
  );
  const all = new Map(
    assignments.map((assignment) => [assignment.assignmentId, assignment]),
  );
  for (const task of tasks)
    all.set(task.assignment.assignmentId, task.assignment);
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  for (const assignment of all.values()) {
    const task = taskMap.get(assignment.assignmentId) ?? null;
    const execution =
      lifecycle.execution?.assignmentId === assignment.assignmentId
        ? lifecycle.execution
        : task?.execution;
    const phase = execution?.phase ?? task?.task.state ?? "discovered";
    const item = { assignment, task, phase, due: assignmentDue(assignment) };
    const handedIn =
      phase === "submitted" ||
      ["submitted", "graded"].includes(assignment.schoolStatus?.state ?? "");
    if (handedIn || task?.task.state === "ignored") {
      groups.done.push(item);
      if (
        handedIn &&
        Date.parse(
          execution?.updatedAt ??
            task?.task.updatedAt ??
            assignment.schoolStatus?.evidence.capturedAt ??
            "",
        ) >= weekStart.getTime()
      )
        groups.submitted.push(item);
    } else if (phase === "needs_user" || phase === "ready_review")
      groups.needs.push(item);
    else if (
      lifecycle.execution?.assignmentId === assignment.assignmentId &&
      ["working", "submitting"].includes(phase)
    )
      groups.working.push(item);
    else if (item.due === null) groups.undated.push(item);
    else if (item.due <= now.getTime() + 7 * 86_400_000) groups.next.push(item);
    else groups.later.push(item);
  }
  const dueOrder = (a: TodayItem, b: TodayItem) =>
    (a.due ?? Infinity) - (b.due ?? Infinity) ||
    a.assignment.title.localeCompare(b.assignment.title);
  const priority = new Map(
    lifecycle.manager.entries.map((entry) => [
      entry.assignmentId,
      entry.priority,
    ]),
  );
  groups.next.sort(
    (a, b) =>
      (priority.get(a.assignment.assignmentId) ?? Infinity) -
        (priority.get(b.assignment.assignmentId) ?? Infinity) || dueOrder(a, b),
  );
  groups.later.sort(dueOrder);
  groups.needs.sort((a, b) => {
    const deadline = (item: TodayItem) => {
      const execution =
        lifecycle.execution?.assignmentId === item.assignment.assignmentId
          ? lifecycle.execution
          : item.task?.execution;
      return (
        Date.parse(
          execution?.handoffDeadline ?? execution?.reviewDeadline ?? "",
        ) || Infinity
      );
    };
    return deadline(a) - deadline(b) || dueOrder(a, b);
  });
  groups.submitted.sort((a, b) =>
    (b.task?.task.updatedAt ?? "").localeCompare(a.task?.task.updatedAt ?? ""),
  );
  return groups;
}
