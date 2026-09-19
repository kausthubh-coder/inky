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
export function assignmentWorkEligibility(assignment: Assignment, now: string): AssignmentWorkEligibility {
  const blocked = (reason: string): AssignmentWorkEligibility => ({ eligible: false, reason });
  if (assignment.ignoredReason) return blocked("You marked this assignment as done or not homework.");
  if (assignment.owner === "student") return blocked("You chose to do this assignment yourself.");
  if (!assignment.sourceTarget) return blocked("Add a school source and check the instructions before Inky starts.");
  const status = assignment.schoolStatus;
  if (!status || status.state === "unknown") return blocked("Check whether this assignment is already submitted.");
  if (status.state === "submitted" || status.state === "graded") return blocked("The school already records this work as submitted or graded.");
  if (status.state === "locked") return blocked("The school has locked this assignment.");
  const currentTime = Date.parse(now);
  const fresh = (evidence: EvidenceReference | undefined) => {
    const age = evidence ? currentTime - Date.parse(evidence.capturedAt) : NaN;
    return Number.isFinite(age) && age >= 0 && age <= 24 * 60 * 60 * 1000;
  };
  if (!fresh(status.evidence)) return blocked("Refresh the school's submission status before starting.");
  if (assignment.requirementsState !== "complete" || !assignment.requirementEvidence?.length || assignment.missingRequirements?.length) {
    return blocked("Read the remaining assignment instructions before starting.");
  }
  if (!assignment.requirementEvidence.every(item => fresh(item.evidence))) return blocked("Refresh the assignment instructions and attached materials before starting.");
  if (!assignment.dueAt || (!assignment.dueDateOverride && (assignment.deadlinePrecision !== "datetime" || !fresh(assignment.deadlineEvidence)))) {
    return blocked("Confirm the exact deadline before starting.");
  }
  if (Date.parse(assignment.dueAt) <= currentTime) {
    const late = assignment.latePolicy;
    if (late?.state !== "accepted" || !fresh(late.evidence) || !late.until || Date.parse(late.until) <= currentTime) {
      return blocked("The deadline has passed; confirm a current late-submission window.");
    }
  }
  return { eligible: true, reason: "Current school evidence shows unfinished work with requirements and an open deadline." };
}
