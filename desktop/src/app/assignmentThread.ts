import type { AssignmentAction, AssignmentExecution } from "../../shared/index.js";
import type { IconName } from "./Icon.js";

export type ThreadCall = { readonly key: string; readonly icon: IconName; readonly verb: string; readonly target?: string; readonly result?: string; readonly running: boolean; readonly failed: boolean; readonly tool?: string; readonly at: string };
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
    // Telling the student is Dot talking: the words follow as text (or sit in the move card), so the call is not a step.
    if (action.tool === "assignment_tell_student") continue;
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
      ...(action.tool ? { tool: action.tool } : {}), at: action.occurredAt,
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

// Like T3 Code's work log: back-to-back tool calls fold into one row that says what they did
// ("Read 6 files, downloaded 8 files and ran 4 commands"); what Dot says splits the groups.
export type ThreadBlock =
  | { readonly kind: "text"; readonly key: string; readonly text: string }
  | { readonly kind: "memory"; readonly key: string; readonly title: string }
  | { readonly kind: "group"; readonly key: string; readonly calls: readonly ThreadCall[]; readonly summary: string; readonly failed: boolean; readonly icon: IconName };

type Action = "read" | "page" | "download" | "change" | "command" | "notes" | "other";

function actionOf(call: ThreadCall): Action {
  const tool = call.tool ?? "";
  if (["read", "file_read_pdf", "read_document", "grep", "find", "ls"].includes(tool)) return "read";
  if (["browser_download", "browser_upload"].includes(tool)) return "download";
  if (["write", "edit"].includes(tool)) return "change";
  if (["powershell", "bash"].includes(tool)) return "command";
  if (tool.startsWith("note_")) return "notes";
  if (tool.startsWith("browser_")) return "page";
  // Older runs only kept a readable label.
  if (/school page|clicked|opened/i.test(call.verb)) return "page";
  if (/^read/i.test(call.verb)) return "read";
  return "other";
}

const ICONS: Record<Action, IconName> = { read: "file", page: "globe", download: "folder", change: "pen", command: "term", notes: "note", other: "right" };

function label(action: Action, count: number, calls: readonly ThreadCall[]): string {
  const n = (word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  switch (action) {
    case "read": return `Read ${n("file")}`;
    case "page": return count === 1 ? "Used the school page" : `Used the school page ${count} times`;
    case "download": return calls.some((call) => call.tool === "browser_upload") ? `Moved ${n("file")}` : `Downloaded ${n("file")}`;
    case "change": return `Changed ${n("file")}`;
    case "command": return `Ran ${n("command")}`;
    case "notes": return "Looked at its notes";
    case "other": return count === 1 ? calls[0]!.verb : `Did ${count} other steps`;
  }
}

export function summarizeCalls(calls: readonly ThreadCall[]): string {
  const byAction = new Map<Action, ThreadCall[]>();
  for (const call of calls) byAction.set(actionOf(call), [...(byAction.get(actionOf(call)) ?? []), call]);
  const parts = [...byAction].map(([action, list]) => label(action, list.length, list));
  const sentence = parts.map((part, index) => (index === 0 ? part : part.charAt(0).toLowerCase() + part.slice(1)));
  if (sentence.length < 2) return sentence[0] ?? "";
  return `${sentence.slice(0, -1).join(", ")} and ${sentence.at(-1)}`;
}

export function groupSteps(steps: readonly ThreadStep[]): ThreadBlock[] {
  const blocks: ThreadBlock[] = [];
  let calls: ThreadCall[] = [];
  const flush = () => {
    if (!calls.length) return;
    const common = new Set(calls.map(actionOf));
    blocks.push({ kind: "group", key: calls[0]!.key, calls, summary: summarizeCalls(calls), failed: calls.some((call) => call.failed),
      icon: common.size === 1 ? ICONS[actionOf(calls[0]!)] : "list" });
    calls = [];
  };
  for (const step of steps) {
    if (step.kind === "call") { calls.push(step.call); continue; }
    flush();
    blocks.push(step);
  }
  flush();
  return blocks;
}


const gist = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Keeps a thread from saying the same thing twice: `say` returns only the paragraphs not yet shown, and remembers them. */
export function onceOnly(): (text: string) => string {
  const said: string[] = [];
  return (text) => text.split(/\n{2,}/).filter((paragraph) => {
    const key = gist(paragraph);
    if (!key) return false;
    // A long paragraph inside one already shown (or the other way round) is the same news.
    if (said.some((earlier) => earlier === key || (key.length > 40 && (earlier.includes(key) || key.includes(earlier) && earlier.length > 40)))) return false;
    said.push(key);
    return true;
  }).join("\n\n");
}
