import { isLivePhase } from "../../shared/index.js";
import type { AssignmentExecutionCoordinator } from "./coordinator.js";
import type { ManagerCoordinator } from "../manager/coordinator.js";
import type { LocalStore } from "../storage/index.js";

export async function startSelectedAssignment(
  store: Pick<LocalStore, "lifecycle">,
  manager: Pick<ManagerCoordinator, "enqueue" | "steerNext">,
  executions: Pick<AssignmentExecutionCoordinator, "start">,
  taskId: string,
): Promise<void> {
  const live = store.lifecycle.getActiveExecution();
  if (live && isLivePhase(live.phase)) {
    throw new Error("Inky is already on another page.");
  }
  manager.enqueue({ taskId });
  manager.steerNext(taskId);
  await executions.start(taskId);
}
