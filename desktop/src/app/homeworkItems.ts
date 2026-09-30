import { homeworkRecord, type Assignment, type HomeworkRecord, type LifecycleState, type ManagerQueueEntry, type SchoolOnboardingState, type TaskSummary } from "../../shared/index.js";
import { assignmentDue } from "./homeworkText.js";
export { shortCourse } from "./homeworkText.js";

// Every homework screen (week, list, All, the assignment page) reads rows from here,
// so one assignment says the same thing wherever it shows up.
export type HomeworkItem = {
  readonly assignment: Assignment;
  readonly task: TaskSummary | null;
  readonly record: HomeworkRecord;
  readonly entry: ManagerQueueEntry | undefined;
  readonly due: number | null;
};

const NEEDS = new Set<HomeworkRecord["state"]>(["waiting", "ready", "stuck"]);
const DONE = new Set<HomeworkRecord["state"]>(["handed_in", "handed_in_at_school", "ignored"]);
export const needsYou = (item: HomeworkItem) => NEEDS.has(item.record.state);
export const isDone = (item: HomeworkItem) => DONE.has(item.record.state);

export function homeworkItems(
  onboarding: SchoolOnboardingState,
  tasks: readonly TaskSummary[],
  lifecycle: LifecycleState,
): HomeworkItem[] {
  const taskMap = new Map(tasks.map((task) => [task.assignment.assignmentId, task]));
  const all = new Map(onboarding.assignments.map((assignment) => [assignment.assignmentId, assignment]));
  for (const task of tasks) all.set(task.assignment.assignmentId, task.assignment);
  const items: HomeworkItem[] = [];
  for (const assignment of all.values()) {
    // Meetings, resources, grade items and exams are class context, not homework.
    if ((assignment.category ?? "work") !== "work") continue;
    const task = taskMap.get(assignment.assignmentId) ?? null;
    const execution = lifecycle.execution?.assignmentId === assignment.assignmentId ? lifecycle.execution : task?.execution;
    const entry = lifecycle.manager.entries.find((item) => item.assignmentId === assignment.assignmentId);
    const record = homeworkRecord({ assignment, task: task?.task ?? null, execution: execution ?? null, mayAttempt: task?.permission.mayAttempt ?? false });
    items.push({ assignment, task, record: entry && (record.state === "not_started" || record.state === "ready") ? { state: "scheduled" } : record, entry, due: assignmentDue(assignment) });
  }
  return items.sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity) || a.assignment.title.localeCompare(b.assignment.title));
}

const time = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

/** The one plain line under a title. */
export function homeworkLine(item: HomeworkItem, busy: boolean): string {
  const { record, entry } = item;
  switch (record.state) {
    case "not_started": return "Starts when you ask";
    case "left_to_you": return "Starts when you ask";
    case "scheduled":
      if (item.task?.execution?.reviewSubmissionRequestedAt) return "Hand-in next, when Dot is free";
      if (entry?.startRequestedAt) return busy ? "Next, when Dot is free" : "Starting now";
      if (entry?.scheduledStartAt) return `Dot starts ${time.format(new Date(entry.scheduledStartAt))}`;
      return busy ? "Dot starts after this one" : "Waiting its turn";
    case "working": return "Dot is on it";
    case "waiting": return { sign_in: "Needs you: sign in", answer: "Needs you: a question", files: "Needs you: a file", browser: "Needs you" }[record.needs ?? "browser"];
    case "ready": return "Ready to check";
    case "handing_in": return "Handing in";
    case "handed_in": return "Handed in by Dot";
    case "handed_in_at_school": return "Handed in at school";
    case "stopped": return "Stopped, work saved";
    case "stuck": return "Dot got stuck";
    case "yours": return "You're doing this";
    case "ignored": return item.assignment.ignoredReason === "already_done" ? "You marked it done" : "Not homework";
  }
}

export type HomeworkAction = { readonly label: string; readonly start: boolean };

/** The button on a row, named for the next step. Start buttons start; everything else opens the assignment. */
export function homeworkAction(item: HomeworkItem, busy = false): HomeworkAction {
  const { record } = item;
  // While Dot has the page, starting means going next.
  if (busy && ["not_started", "left_to_you", "stopped"].includes(record.state)) return { label: "Do this next", start: true };
  switch (record.state) {
    case "not_started": case "left_to_you": return { label: "Start", start: true };
    case "scheduled":
      if (item.task?.execution?.reviewSubmissionRequestedAt) return { label: "Open", start: false };
      return busy ? { label: "Open", start: false } : { label: "Start now", start: true };
    case "stopped": return { label: "Carry on", start: true };
    case "working": case "handing_in": return { label: "Watch", start: false };
    case "waiting": return { label: { sign_in: "Sign in", answer: "Answer", files: "Add file", browser: "Continue" }[record.needs ?? "browser"], start: false };
    case "ready": return { label: "Check it", start: false };
    case "stuck": return { label: "See why", start: false };
    case "handed_in": return { label: "Receipt", start: false };
    default: return { label: "Open", start: false };
  }
}

/** The headline's one fix, for the first thing that needs the student. */
export function homeworkFix(item: HomeworkItem): { readonly headline: string; readonly button: string } {
  const title = item.assignment.title;
  const { record } = item;
  if (record.state === "ready") return { headline: `${title} is ready to check.`, button: "Check it" };
  if (record.state === "stuck") return { headline: `Dot got stuck on ${title}.`, button: "See why" };
  switch (record.needs) {
    case "sign_in": return { headline: `${title} needs your sign-in.`, button: "Sign in" };
    case "answer": return { headline: `Dot has a question about ${title}.`, button: "Answer it" };
    case "files": return { headline: `${title} needs a file from you.`, button: "Add the file" };
    default: return { headline: `${title} needs you.`, button: "Open it" };
  }
}

export function dueLine(item: HomeworkItem, now: Date): string {
  if (item.due === null) return item.assignment.dueText ?? "Whenever";
  const due = new Date(item.due);
  const day = due.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  if (isDone(item)) return day;
  if (item.due < now.getTime()) return `Overdue since ${due.toLocaleDateString(undefined, { weekday: "short" })}`;
  return `Due ${day}, ${due.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}
