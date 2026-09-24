import type { Assignment, SchoolScan } from "../../shared/index.js";

type ScanChange = SchoolScan["changes"][number];

export function assignmentScanChange(prior: Assignment | undefined, current: Assignment): ScanChange | null {
  if (!prior) return { assignmentId: current.assignmentId, kind: "new", fields: [] };
  const fields: string[] = (["title", "dueAt", "dueText"] as const).filter(
    field => current[field] !== prior[field],
  );
  if (current.schoolStatus?.state !== prior.schoolStatus?.state
    || current.schoolStatus?.text !== prior.schoolStatus?.text) fields.push("schoolStatus");
  if (!fields.length) return null;
  const dateChanged = fields.includes("dueAt") || fields.includes("dueText");
  return {
    assignmentId: current.assignmentId,
    kind: "updated",
    fields,
    ...(dateChanged ? {
      dueChange: {
        before: { dueAt: prior.dueAt, dueText: prior.dueText },
        after: { dueAt: current.dueAt, dueText: current.dueText },
      },
    } : {}),
  };
}

export function mergeScanChange(existing: ScanChange | undefined, incoming: ScanChange | null): ScanChange | undefined {
  if (!existing) return incoming ?? undefined;
  if (!incoming || existing.kind === "new") return existing;
  return {
    ...existing,
    fields: [...new Set([...existing.fields, ...incoming.fields])],
    ...(incoming.dueChange ? {
      dueChange: { before: existing.dueChange?.before ?? incoming.dueChange.before, after: incoming.dueChange.after },
    } : {}),
  };
}

export function removedScanChanges(
  before: readonly Assignment[],
  observedIds: ReadonlySet<string>,
  completedCourseIds: ReadonlySet<string>,
): ScanChange[] {
  return before
    .filter(item => item.origin === "school" && completedCourseIds.has(item.courseId) && !observedIds.has(item.assignmentId))
    .map(item => ({ assignmentId: item.assignmentId, kind: "removed", fields: ["sourcePresence"] }));
}
