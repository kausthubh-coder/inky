import type { StudiRendererApi } from "../../shared/index.js";

// Takeover waits for the worker to abort before cancellation releases its lease.
// A new owner or a failed stop must never turn into a scan request.
export async function stopAssignmentForScan(studi: Pick<StudiRendererApi, "getLifecycleState" | "requestAssignmentTakeover" | "cancelAssignment" | "getManagerState">, taskId: string): Promise<void> {
  const current = await studi.getLifecycleState();
  if (current.manager.lease?.taskId !== taskId || current.execution?.taskId !== taskId) {
    throw new Error("The browser’s work changed. Check what Inky is doing before scanning.");
  }
  if (current.execution.phase === "working") await studi.requestAssignmentTakeover({ taskId });
  else if (!["needs_user", "ready_review"].includes(current.execution.phase)) {
    throw new Error("This assignment can’t stop here yet. Wait for Inky to finish this step.");
  }
  await studi.cancelAssignment({ taskId });
  if ((await studi.getManagerState()).lease) {
    throw new Error("The school browser is still in use. Your scan hasn’t started. Try again when it’s free.");
  }
}
