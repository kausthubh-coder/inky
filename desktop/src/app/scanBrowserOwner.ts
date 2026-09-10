import type { LifecycleState, SchoolOnboardingState } from "../../shared/index.js";

export function scanBrowserOwner(state: SchoolOnboardingState, lifecycle: LifecycleState) {
  const lease = lifecycle.manager.lease;
  if (!lease) return null;
  const execution = lifecycle.execution?.taskId === lease.taskId ? lifecycle.execution : null;
  const assignmentId = execution?.assignmentId ?? lifecycle.manager.entries.find(item => item.taskId === lease.taskId)?.assignmentId;
  return {
    taskId: lease.taskId,
    phase: execution?.phase ?? "starting",
    title: state.assignments.find(item => item.assignmentId === assignmentId)?.title ?? "another assignment",
    canStop: lease.state === "active" && !!execution && ["working", "needs_user", "ready_review"].includes(execution.phase),
  };
}

