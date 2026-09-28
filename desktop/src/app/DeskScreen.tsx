import {
  classifyAgentRuntimeAttention,
  isLivePhase,
  type LifecycleState,
  type SchoolOnboardingState,
  type StudiWorkspaceState,
} from "../../shared/index.js";
import { dotState, type DotState } from "../../shared/characters/states.js";

export type DeskPanel =
  | { kind: "closed" }
  | { kind: "assignment"; assignmentId: string }
  | { kind: "desk" }
  | { kind: "school" };

export function viewingLiveDesk(
  panel: DeskPanel,
  execution: LifecycleState["execution"] | null | undefined,
): boolean {
  return Boolean(
    execution &&
      isLivePhase(execution.phase) &&
      (panel.kind === "desk" || (panel.kind === "assignment" && panel.assignmentId === execution.assignmentId)),
  );
}

export function openAssignmentId(
  panel: DeskPanel,
  execution: LifecycleState["execution"] | null | undefined,
): string | null {
  if (panel.kind === "assignment") return panel.assignmentId;
  if (panel.kind === "desk") return execution?.assignmentId ?? null;
  return null;
}
export function talkKeyForPanel(
  panel: DeskPanel,
  execution: LifecycleState["execution"] | null | undefined,
): string | null {
  const openId = openAssignmentId(panel, execution);
  if (openId) return openId;
  return panel.kind === "desk" ? "desk" : null;
}

export function deskDotState({
  execution,
  driver,
  scanState,
  runtimeAttention,
}: {
  execution?: LifecycleState["execution"];
  driver?: StudiWorkspaceState["browser"]["driver"];
  scanState?: NonNullable<SchoolOnboardingState["scan"]>["state"];
  runtimeAttention: ReturnType<typeof classifyAgentRuntimeAttention>;
}): DotState {
  // The same rule as the app icon badge (shared/characters/states.ts).
  return dotState({ phase: execution?.phase, steering: driver === "inky", scan: scanState, attention: runtimeAttention !== "none" });
}
