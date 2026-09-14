import { createHash } from "node:crypto";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { SafeSourceTargetSchema, assignmentWorkEligibility, type BrowserSnapshot, type EvidenceReference, type SchoolScan } from "../../shared/index.js";
import type { LocalStore } from "../storage/index.js";
import { exactTarget } from "./source-identity.js";

type Context = {
  store: LocalStore;
  scanId: string;
  scan(): SchoolScan;
  observe(): Promise<BrowserSnapshot>;
  evidence(snapshot: BrowserSnapshot, summary: string): EvidenceReference;
  now(): string;
  checkpointSaved(): void;
};

const kindSchema = Type.Union(["directory", "inventory", "details", "schedule", "announcements", "linked"].map(value => Type.Literal(value)));
const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], details: value });

// Exclude rotating element references, never actual dates/status/content. A digest
// compares the visible observation; it cannot attest to hidden tabs or other pages.
export function sourceContentDigest(snapshot: BrowserSnapshot): string {
  const content = {
    url: exactTarget(snapshot.url), title: snapshot.title,
    text: snapshot.text.replace(/\br\d+:\d+\b/g, "ref").replace(/\s+/g, " ").trim(),
    elements: snapshot.elements.map(({ ref: _ref, ...element }) => element),
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(content)).digest("hex")}`;
}

export function createSourceCheckpointTools(context: Context): ToolDefinition[] {
  const { store, scanId } = context;
  const checkSource = defineTool({
    name: "scan_check_source", label: "Check source changes",
    description: "Compare a fresh full visible page with its saved checkpoint. Unchanged detail pages can reuse recorded facts; inventories and schedules still require their other pages/sections to be checked. Does not refresh the age of submission evidence.",
    parameters: Type.Object({ kind: kindSchema, courseId: Type.Optional(Type.String()) }, { additionalProperties: false }),
    execute: async (_id, input) => {
      const snapshot = await context.observe();
      SafeSourceTargetSchema.parse(snapshot.url);
      const scan = context.scan();
      const previous = scan.sourceCheckpoints.find(item => exactTarget(item.sourceTarget) === exactTarget(snapshot.url) && item.kind === input.kind && item.courseId === input.courseId);
      const completeObservation = !snapshot.truncated && !snapshot.search && snapshot.nextOffset === undefined;
      const unchanged = completeObservation && previous?.contentDigest === sourceContentDigest(snapshot);
      const reusable = Boolean(!scan.targetAssignmentId && unchanged && previous?.state === "checked" && input.kind === "details" && previous.assignmentIds.length && previous.courseIds.every(id => scan.observedCourseIds.includes(id)));
      if (reusable && previous) {
        const evidence = context.evidence(snapshot, "Rechecked unchanged assignment detail source.");
        const assignmentIds = previous.assignmentIds.filter(id => store.assignments.get(id));
        const courseIds = previous.courseIds.filter(id => store.school.listCourses().some(course => course.courseId === id));
        for (const assignmentId of assignmentIds) {
          const assignment = store.assignments.get(assignmentId)!;
          store.assignments.put({ ...assignment, lastVerifiedScanId: scanId, evidence: [...assignment.evidence.slice(-99), evidence] });
        }
        store.school.putScan({
          ...scan, updatedAt: context.now(),
          observedCourseIds: [...new Set([...scan.observedCourseIds, ...courseIds])],
          observedAssignmentIds: [...new Set([...scan.observedAssignmentIds, ...assignmentIds])],
          sourceCheckpoints: scan.sourceCheckpoints.map(item => item === previous ? { ...item, evidence, scanId } : item),
        });
        context.checkpointSaved();
      }
      return result({ sourceTarget: snapshot.url, unchanged, reusable, completeObservation,
        assignmentIds: previous?.assignmentIds ?? [], note: previous?.note,
        next: reusable ? "Reuse unchanged requirements. Refresh stale submission/deadline evidence before work; continue other sources." : "Inspect and record this source, then checkpoint it." });
    },
  });
  const recordSource = defineTool({
    name: "scan_record_source", label: "Save source checkpoint",
    description: "Save progress after inspecting the current source. Checked requires a full unfiltered observation; blocked requires an explanation. Supply only assignment IDs recorded from this page. This does not prove the entire class inventory is complete.",
    parameters: Type.Object({ kind: kindSchema, courseId: Type.Optional(Type.String()),
      state: Type.Union([Type.Literal("checked"), Type.Literal("blocked")]),
      assignmentIds: Type.Optional(Type.Array(Type.String(), { maxItems: 10000 })),
      note: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    }, { additionalProperties: false }),
    execute: async (_id, input) => {
      const snapshot = await context.observe();
      SafeSourceTargetSchema.parse(snapshot.url);
      const scan = context.scan();
      if (scan.targetAssignmentId && ((input.assignmentIds ?? []).some(id => id !== scan.targetAssignmentId)
        || !scan.targetSourceTargets?.some(url => exactTarget(url) === exactTarget(snapshot.url)))) throw new Error("Checkpoint sources and assignments must belong to this details check");
      if (input.state === "checked" && (snapshot.truncated || snapshot.search || snapshot.nextOffset !== undefined)) throw new Error("A truncated or filtered source cannot be checkpointed as checked");
      if (input.state === "blocked" && !input.note) throw new Error("A blocked source needs an explanation");
      if (input.courseId && !(scan.targetAssignmentId ? store.assignments.get(scan.targetAssignmentId)?.courseId === input.courseId : scan.observedCourseIds.includes(input.courseId))) throw new Error("Record the course before checkpointing its source");
      const assignmentIds = [...new Set(input.assignmentIds ?? [])];
      const assignments = assignmentIds.map(id => store.assignments.get(id));
      for (const assignment of assignments) {
        if (!assignment || assignment.lastVerifiedScanId !== scanId || !scan.observedAssignmentIds.includes(assignment.assignmentId) || !assignment.evidence.some(evidence => evidence.capturedAt >= scan.startedAt && exactTarget(evidence.sourceTarget) === exactTarget(snapshot.url))) throw new Error("Source checkpoint assignment must have evidence from this page in the current scan");
        if (input.courseId && assignment.courseId !== input.courseId) throw new Error("Source checkpoint assignment belongs to a different course");
      }
      const checkpoint = {
        sourceTarget: snapshot.url, kind: input.kind, courseId: input.courseId,
        state: input.state, contentDigest: sourceContentDigest(snapshot), scanId,
        evidence: context.evidence(snapshot, input.note ?? "Saved inspected source checkpoint."),
        courseIds: [...new Set([...(input.courseId ? [input.courseId] : []), ...assignments.map(item => item!.courseId)])],
        assignmentIds, note: input.note,
      };
      store.school.putScan({ ...scan, updatedAt: context.now(), sourceCheckpoints: [
        ...scan.sourceCheckpoints.filter(item => !(exactTarget(item.sourceTarget) === exactTarget(snapshot.url) && item.kind === input.kind && item.courseId === input.courseId)), checkpoint,
      ] });
      context.checkpointSaved();
      return result(checkpoint);
    },
  });
  const readAssignment = defineTool({
    name: "scan_read_assignment", label: "Read assignment evidence",
    description: "Read one saved assignment's full requirements and eligibility. Saved evidence keeps its original timestamp and is not fresh browser evidence.",
    parameters: Type.Object({ assignmentId: Type.String() }, { additionalProperties: false }),
    execute: async (_id, input) => {
      const scan = context.scan();
      if (scan.targetAssignmentId && input.assignmentId !== scan.targetAssignmentId) throw new Error("Read only the assignment selected for this details check");
      const assignment = store.assignments.get(input.assignmentId);
      if (!assignment) throw new Error("Assignment not found");
      return result({ assignment, eligibility: assignmentWorkEligibility(assignment, context.now()) });
    },
  });
  return [checkSource, recordSource, readAssignment];
}
