import { z } from "zod";

import { EvidenceReferenceSchema, type EvidenceReference } from "./evidence.js";
import { AssignmentIdSchema, CourseIdSchema, SafeSourceTargetSchema } from "./ids.js";
import { IsoTimestampSchema, SchemaVersionSchema } from "./schema-version.js";

export const AssignmentKindSchema = z.enum(["quiz", "problem_set", "essay", "code", "discussion", "reading", "group_work"]);

export const AssignmentSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  assignmentId: AssignmentIdSchema,
  courseId: CourseIdSchema,
  title: z.string().min(1).max(500),
  sourceTarget: SafeSourceTargetSchema.optional(),
  origin: z.enum(["manual", "school"]).optional(),
  owner: z.enum(["student", "inky"]).optional(),
  ownerPreviousMode: z.enum(["do_not_attempt", "attempt", "auto_submit"]).optional(),
  /** What the item is. Only work (the default) goes into the student's week; the rest is class context. */
  category: z.enum(["work", "exam", "resource", "grade"]).optional(),
  kind: AssignmentKindSchema.optional(),
  possibleKinds: z.array(AssignmentKindSchema).max(7).optional(),
  kindConfidence: z.enum(["explicit", "uncertain"]).optional(),
  kindEvidence: EvidenceReferenceSchema.optional(),
  dueDateOverride: z.strictObject({ dueAt: IsoTimestampSchema, updatedAt: IsoTimestampSchema }).optional(),
  ignoredReason: z.enum(["not_homework", "already_done"]).optional(),
  ignoredNote: z.string().trim().min(1).max(500).optional(),
  sourceIdentity: z.string().min(1).max(4096).optional(),
  dueAt: IsoTimestampSchema.optional(),
  dueText: z.string().min(1).max(200).optional(),
  deadlinePrecision: z.enum(["unknown", "date", "datetime"]).optional(),
  deadlineEvidence: EvidenceReferenceSchema.optional(),
  instructions: z.string().min(1).max(8000).optional(),
  schoolStatus: z.strictObject({
    state: z.enum(["unknown", "not_submitted", "submitted", "graded", "locked"]),
    text: z.string().min(1).max(1000),
    evidence: EvidenceReferenceSchema,
  }).optional(),
  latePolicy: z.strictObject({
    state: z.enum(["accepted", "not_accepted", "unknown"]),
    text: z.string().min(1).max(1000),
    until: IsoTimestampSchema.optional(),
    evidence: EvidenceReferenceSchema,
  }).optional(),
  requirementEvidence: z.array(z.strictObject({
    text: z.string().min(1).max(8000),
    evidence: EvidenceReferenceSchema,
  })).max(100).optional(),
  requirementsState: z.enum(["partial", "complete"]).optional(),
  missingRequirements: z.array(z.string().min(1).max(500)).max(30).optional(),
  discoveredAt: IsoTimestampSchema,
  lastVerifiedScanId: z.string().min(1).max(256).optional(),
  evidence: z.array(EvidenceReferenceSchema),
});

export type Assignment = z.infer<typeof AssignmentSchema>;

export type AssignmentWorkEligibility = { eligible: boolean; reason: string };

// This is a decision about saved school facts, never a grant of permission.
// Legacy records without these facts remain discoverable but cannot auto-run.
// Whether Dot may start this homework. Only hard stops live here. Dot reads the page, the instructions,
// attachments and the deadline itself as the first part of its run, so incomplete or stale saved details,
// a rubric the teacher never posted, or an unconfirmed deadline don't block a start.
export function assignmentWorkEligibility(assignment: Assignment, _now: string): AssignmentWorkEligibility {
  const blocked = (reason: string): AssignmentWorkEligibility => ({ eligible: false, reason });
  if ((assignment.category ?? "work") !== "work") return blocked("This is class material, not homework to do.");
  if (assignment.ignoredReason) return blocked("You marked this assignment as done or not homework.");
  if (assignment.owner === "student") return blocked("You chose to do this assignment yourself.");
  if (!assignment.sourceTarget) return blocked("Add a school link so Dot can open the assignment.");
  const status = assignment.schoolStatus?.state;
  if (status === "submitted" || status === "graded") return blocked("The school already records this work as submitted or graded.");
  if (status === "locked") return blocked("The school has locked this assignment.");
  return { eligible: true, reason: "Dot opens the assignment and reads what it needs as it starts." };
}
