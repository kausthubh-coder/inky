import { isLivePhase, type AssignmentExecution } from "../lifecycle.js";
import type { SchoolScan } from "../school-scan.js";

// Dot does the homework. Chalky teaches.
export const DOT_STATES = ["idle", "hello", "thinking", "scanning", "steering", "working", "waiting", "needs", "review", "done", "sleep"] as const;
export const CHALKY_STATES = ["idle", "hello", "listening", "thinking", "explaining", "hint", "quiz", "proud", "sleep"] as const;
export type DotState = (typeof DOT_STATES)[number];
export type ChalkyState = (typeof CHALKY_STATES)[number];
export type CharacterState = DotState | ChalkyState;

export type HomeworkActivity = {
  phase?: AssignmentExecution["phase"] | null | undefined;
  /** Dot is driving the school page. */
  steering?: boolean | undefined;
  scan?: SchoolScan["state"] | null | undefined;
  /** The provider or runtime needs the student (sign-in, quota, a broken model). */
  attention?: boolean | undefined;
};

/** What Dot is doing, from the engine's state. The app icon badge uses the same answer. */
export function dotState({ phase, steering, scan, attention }: HomeworkActivity): DotState {
  if (isLivePhase(phase ?? undefined)) {
    if (steering) return "steering";
    if (attention || phase === "needs_user") return "needs";
    if (phase === "working" || phase === "submitting") return "working";
    if (phase === "ready_review") return "review";
  }
  if (attention || scan === "partial" || scan === "failed" || scan === "needs_user") return "needs";
  if (scan === "running") return "scanning";
  if (scan === "succeeded") return "done";
  return "idle";
}

export type IconBadge =
  | { readonly kind: "none" }
  | { readonly kind: "needs" }
  | { readonly kind: "ready"; readonly count: number }
  | { readonly kind: "working" }
  | { readonly kind: "scanning" };

/** The app icon's badge: needs you first, then work to check, then what Dot is busy with. */
export function iconBadge(state: DotState, ready: number): IconBadge {
  if (state === "needs") return { kind: "needs" };
  if (ready > 0) return { kind: "ready", count: ready };
  if (state === "working" || state === "steering") return { kind: "working" };
  if (state === "scanning") return { kind: "scanning" };
  return { kind: "none" };
}

export function iconTooltip(badge: IconBadge): string {
  switch (badge.kind) {
    case "needs": return "Studi · Dot needs you";
    case "ready": return `Studi · ${badge.count} ready to check`;
    case "working": return "Studi · Dot is working";
    case "scanning": return "Studi · Dot is reading your school";
    default: return "Studi";
  }
}
