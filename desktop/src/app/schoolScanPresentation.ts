import type { Assignment, SchoolOnboardingState, SchoolScan } from "../../shared/index.js";

type ScanChange = SchoolScan["changes"][number];

export function schoolScanPresentation(state: SchoolOnboardingState) {
  const scan = state.scan;
  const running = scan?.state === "running";
  const paused = scan?.state === "needs_user";
  const active = running || paused;
  const signIn = paused && (scan.handoff?.kind === "school_sign_in" || scan.handoff?.kind === "linked_system_sign_in");
  const directory = scan?.inventories.find(item => item.kind === "courses");
  const courses = directory ? state.courses.filter(course => directory.itemIds.includes(course.courseId)) : state.courses;
  const checkedIds = new Set(scan?.inventories.filter(item => item.kind === "assignments").map(item => item.courseId));
  const checked = courses.filter(course => checkedIds.has(course.courseId)).length;
  const checkedLabel = !directory ? "Class list not yet verified" : `${checked} of ${courses.length} classes checked`;
  const added = scan?.changes.filter(change => change.kind === "new").length ?? 0;
  const updated = scan?.changes.filter(change => change.kind === "updated").length ?? 0;
  const counts = [added ? `${added} new ${added === 1 ? "assignment" : "assignments"}` : "", updated ? `${updated} updated` : ""].filter(Boolean).join(" · ");
  const title = running ? "Let’s see what’s new…" : paused ? signIn ? "A little help?" : "I’ll wait right here."
    : scan?.state === "failed" ? "I hit a snag." : scan ? added || updated ? "Here’s what I found." : scan.state === "succeeded" ? "You’re all caught up." : "I saved what I could." : "Let’s find your homework.";
  const description = running ? !directory ? "Finding your classes" : scan.currentStep
    : paused ? signIn ? scan.handoff?.reason ?? scan.currentStep : `Scan paused · ${checkedLabel.toLowerCase()}`
    : scan?.state === "failed" ? scan.failures[0] ?? "The scan stopped before it finished."
    : scan ? counts || (scan.state === "succeeded" ? "No new or changed homework in this scan." : "Some school pages still need checking.")
    : "I’ll check your school for assignments and due dates.";
  const gaps = scan?.coverage.filter(item => item.status !== "verified").map(item => item.target) ?? [];
  return {
    running, paused, active, signIn, directoryKnown: Boolean(directory), courses, checkedIds, checkedLabel, title, description,
    mood: running ? "scanning" as const : paused ? signIn ? "needs" as const : "sleep" as const : scan?.state === "failed" ? "needs" as const : scan ? "done" as const : "hello" as const,
    incompleteLabel: gaps.length ? `Still needs checking: ${gaps.join(", ")}.` : "Some homework sources weren’t fully checked. See Scan details.",
    changes: (scan?.changes ?? []).flatMap(change => {
      const assignment = state.assignments.find(item => item.assignmentId === change.assignmentId);
      return assignment ? [{ change, assignment }] : [];
    }),
  };
}

export function scanChangeLabel(change: ScanChange): string {
  if (change.kind === "new") return "New";
  const labels = change.fields.map(field => ({ dueAt: "Due date", dueText: "Due date", instructions: "Instructions", title: "Title" })[field] ?? "Details");
  return (labels.length ? [...new Set(labels)].join(" & ") : "Details") + " changed";
}

function dueLabel(value: Pick<Assignment, "dueAt" | "dueText">): string {
  return value.dueAt ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value.dueAt)) : value.dueText ?? "No due date";
}

export function scanChangeDate(change: ScanChange, assignment: Assignment): string {
  if (change.dueChange) return `${dueLabel(change.dueChange.before)} → ${dueLabel(change.dueChange.after)}`;
  return dueLabel(assignment);
}
