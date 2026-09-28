import type { AssignmentAction, AssignmentExecution } from "../../shared/index.js";
import type { IconName } from "./Icon.js";

export type ThreadCall = { readonly key: string; readonly icon: IconName; readonly verb: string; readonly target?: string; readonly result?: string; readonly running: boolean; readonly failed: boolean };
export type ThreadStep =
  | { readonly kind: "text"; readonly key: string; readonly text: string }
  | { readonly kind: "call"; readonly call: ThreadCall }
  | { readonly kind: "memory"; readonly key: string; readonly title: string };

const VERBS: Record<string, [IconName, string]> = {
  browser_navigate: ["globe", "Opened"], browser_snapshot: ["globe", "Read the page"], browser_click: ["globe", "Clicked"],
  browser_type: ["pen", "Typed in"], browser_fill: ["pen", "Typed in"], browser_select: ["pen", "Chose in"],
  browser_scroll: ["globe", "Scrolled"], browser_upload: ["folder", "Attached"], browser_download: ["folder", "Downloaded"],
  browser_submit: ["done", "Handed in"], read: ["file", "Read"], file_read_pdf: ["file", "Read"], write: ["pen", "Wrote"],
  edit: ["pen", "Edited"], grep: ["search", "Searched"], find: ["search", "Looked for"], ls: ["folder", "Listed"],
  bash: ["term", "Ran"], powershell: ["term", "Ran"], note_search: ["note", "Searched notes for"], note_read: ["note", "Read note"],
  assignment_record_answer_snapshot: ["list", "Saved the answers"], assignment_start_review: ["done", "Checked the requirements"],
  assignment_tell_student: ["note", "Told you"], assignment_record_recovery: ["refresh", "Tried another way"],
  connected_apps_execute: ["globe", "Used"], connected_apps_search: ["search", "Looked in your apps for"],
};

/** Dot's run as a thread: what it said, and each tool call with its target and result. */
export function threadSteps(actions: readonly AssignmentAction[]): ThreadStep[] {
  const steps: ThreadStep[] = [];
  for (const action of actions) {
    if (action.kind === "text") {
      const text = action.label.trim();
      if (text) steps.push({ kind: "text", key: action.actionId, text });
      continue;
    }
    if (action.tool === "note_upsert") {
      if (action.outcome === "succeeded") steps.push({ kind: "memory", key: action.actionId, title: action.target ?? "a preference" });
      continue;
    }
    const [icon, verb] = action.kind === "retry" ? ["refresh" as const, "Trying again"] : VERBS[action.tool ?? ""] ?? ["right" as const, action.label];
    steps.push({ kind: "call", call: {
      key: action.actionId, icon, verb: action.target || action.kind === "retry" ? verb : action.label,
      ...(action.target ? { target: action.target } : action.kind === "retry" ? { target: action.label } : {}),
      ...(action.result ? { result: action.result } : {}),
      running: action.outcome === "started", failed: action.outcome === "failed",
    } });
  }
  return steps;
}

/** "Worked for 6m 12s", from the run's start to its last step. */
export function workedFor(execution: Pick<AssignmentExecution, "startedAt" | "actions" | "updatedAt">): string | null {
  const start = Date.parse(execution.startedAt ?? "");
  const end = Date.parse(execution.actions?.at(-1)?.occurredAt ?? execution.updatedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const seconds = Math.round((end - start) / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

const PLANS: Record<string, string> = {
  quiz: "I'll read the questions and your notes, answer on the school page, then check each answer.",
  problem_set: "I'll work each problem, show the working, and check every answer.",
  essay: "I'll read the prompt and the readings, write a draft, then go through the rubric.",
  code: "I'll read the handout, write the code in its own folder, and run the tests.",
  discussion: "I'll read the prompt and the thread, then draft a post for you to check.",
  reading: "I'll do the reading and write up what it asks for.",
  group_work: "I'll do your part and keep what the group needs clear.",
};
export const planFor = (kind: string | undefined) => PLANS[kind ?? ""] ?? "I'll read the instructions, do the work, and check it against what it asks.";

const TIPS: Record<string, string[]> = {
  quiz: ["Show your reasoning on written answers", "Ask me before guessing", "Use my class notes"],
  problem_set: ["Show all your working", "Give answers to two decimals", "Ask me before using the last try"],
  code: ["Comment every function", "Don't change the starter files", "Use recursion where it fits"],
  essay: ["Write in first person", "Keep it under 500 words", "Use this week's readings"],
  discussion: ["Keep it short and friendly", "Reply to one classmate too", "Use an example from class"],
};
export const tipsFor = (kind: string | undefined) => TIPS[kind ?? ""] ?? ["Show your working", "Ask me before guessing", "Use my class notes"];

export const workTabName = (kind: string | undefined) => kind === "code" ? "Files" : kind === "essay" || kind === "discussion" ? "Draft" : kind === "quiz" || kind === "problem_set" ? "Answers" : "Work";
