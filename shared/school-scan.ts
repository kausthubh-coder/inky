import { z } from "zod";

import { classifyAgentRuntimeAttention, type ProviderStatus } from "./agent-runtime.js";
import { AssignmentSchema } from "./assignment.js";
import { EvidenceReferenceSchema } from "./evidence.js";
import { SafeSourceTargetSchema } from "./ids.js";
import { PermissionModeSchema } from "./permission.js";
import { IsoTimestampSchema, SchemaVersionSchema } from "./schema-version.js";

export const ScanCadenceSchema = z.enum(["manual", "daily", "weekly"]);

export const SchoolProfileSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  profileId: z.literal("primary-school"),
  studentName: z.string().trim().min(1).max(100),
  schoolRoot: SafeSourceTargetSchema,
  defaultPermission: PermissionModeSchema,
  scanCadence: ScanCadenceSchema,
  onboardingState: z.enum(["profile_saved", "needs_sign_in", "scanning", "ready"]),
  missedCourseFeedback: z.array(z.string().trim().min(1).max(500)).max(20),
  updatedAt: IsoTimestampSchema,
});

export const SchoolScanCoverageSchema = z
  .strictObject({
    target: z.string().trim().min(1).max(200),
    status: z.enum(["verified", "partial", "failed"]),
    evidence: EvidenceReferenceSchema.optional(),
    failure: z.string().trim().min(1).max(500).optional(),
  })
  .superRefine((coverage, context) => {
    if (coverage.status === "verified" && !coverage.evidence) {
      context.addIssue({ code: "custom", path: ["evidence"], message: "Verified coverage requires browser evidence" });
    }
    if (coverage.status !== "verified" && !coverage.failure) {
      context.addIssue({ code: "custom", path: ["failure"], message: "Incomplete coverage requires a failure reason" });
    }
  });

export const SchoolScanHandoffSchema = z.strictObject({
  kind: z.enum(["school_sign_in", "linked_system_sign_in"]),
  linkedSystemId: z.string().min(1).max(256).optional(),
  reason: z.string().trim().min(1).max(500),
  requestedAt: IsoTimestampSchema,
  evidence: EvidenceReferenceSchema,
});

export const SchoolScanSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  scanId: z.string().min(1).max(256),
  kind: z.enum(["first_scan", "replay"]),
  state: z.enum(["running", "needs_user", "succeeded", "partial", "failed"]),
  startedAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  completedAt: IsoTimestampSchema.optional(),
  currentStep: z.string().trim().min(1).max(500),
  coverage: z.array(SchoolScanCoverageSchema).max(500),
  failures: z.array(z.string().trim().min(1).max(500)).max(100),
  handoff: SchoolScanHandoffSchema.nullable(),
  observedCourseIds: z.array(z.string().min(1).max(256)).max(1_000),
  observedAssignmentIds: z.array(z.string().min(1).max(256)).max(10_000),
  observedLinkedSystemIds: z.array(z.string().min(1).max(256)).max(1_000),
});

export const CourseSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  courseId: z.string().min(1).max(256),
  label: z.string().trim().min(1).max(300),
  sourceTarget: SafeSourceTargetSchema,
  lastVerifiedScanId: z.string().min(1).max(256),
  lastVerifiedAt: IsoTimestampSchema,
  evidence: EvidenceReferenceSchema,
});

export const LinkedSystemSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  linkedSystemId: z.string().min(1).max(256),
  label: z.string().trim().min(1).max(300),
  sourceTarget: SafeSourceTargetSchema,
  state: z.enum(["needs_user", "verified"]),
  lastObservedScanId: z.string().min(1).max(256),
  lastVerifiedScanId: z.string().min(1).max(256).optional(),
  lastObservedAt: IsoTimestampSchema,
  evidence: EvidenceReferenceSchema,
});

export const SchoolOnboardingStateSchema = z.strictObject({
  profile: SchoolProfileSchema.nullable(),
  scan: SchoolScanSchema.nullable(),
  courses: z.array(CourseSchema),
  assignments: z.array(AssignmentSchema),
  linkedSystems: z.array(LinkedSystemSchema),
  workflowRevision: z.number().int().positive().nullable(),
});

export const SaveSchoolProfileInputSchema = z.strictObject({
  studentName: z.string().trim().min(1).max(100),
  schoolRoot: SafeSourceTargetSchema,
  defaultPermission: PermissionModeSchema,
  scanCadence: ScanCadenceSchema,
});

export type SchoolProfile = z.infer<typeof SchoolProfileSchema>;
export type SchoolScan = z.infer<typeof SchoolScanSchema>;
export type SchoolScanCoverage = z.infer<typeof SchoolScanCoverageSchema>;
export type Course = z.infer<typeof CourseSchema>;
export type LinkedSystem = z.infer<typeof LinkedSystemSchema>;
export type SchoolOnboardingState = z.infer<typeof SchoolOnboardingStateSchema>;
export type SaveSchoolProfileInput = z.infer<typeof SaveSchoolProfileInputSchema>;

export type SchoolOnboardingScanKind =
  | "sign_in"
  | "scanning"
  | "handoff"
  | "retry"
  | "ready"
  | "runtime_login"
  | "runtime_usage"
  | "runtime_unavailable";

export type SchoolOnboardingScanPresentation = {
  readonly step: 1 | 5 | 6 | 7 | 8;
  readonly kind: SchoolOnboardingScanKind;
};

export function hasCompletedSchoolOnboarding(
  state: Pick<SchoolOnboardingState, "profile" | "scan" | "workflowRevision">,
): boolean {
  if (!state.profile) return false;
  if (state.workflowRevision !== null) return true;
  return Boolean(
    state.scan?.completedAt &&
    (state.scan.state === "succeeded" || state.scan.state === "partial") &&
    state.scan.coverage.length > 0,
  );
}

export function presentSchoolOnboardingScan(
  state: Pick<SchoolOnboardingState, "profile" | "scan" | "workflowRevision"> | null,
  provider?: Pick<ProviderStatus, "state" | "reason"> | null,
): SchoolOnboardingScanPresentation {
  const scan = state?.scan;
  if (scan?.state === "running") return { step: 6, kind: "scanning" };
  const failureText = scan?.state === "failed" ? scan.failures?.[0] ?? scan.currentStep : null;
  const attention = classifyAgentRuntimeAttention(provider, failureText);
  if (attention === "needs_login") return { step: 1, kind: "runtime_login" };
  if (attention === "usage") return { step: 7, kind: "runtime_usage" };
  if (attention === "unavailable") return { step: 7, kind: "runtime_unavailable" };
  if (scan?.state === "needs_user") return { step: 7, kind: "handoff" };
  if (state && hasCompletedSchoolOnboarding(state)) return { step: 8, kind: "ready" };
  if (scan?.state === "failed" || scan?.state === "partial") return { step: 7, kind: "retry" };
  return { step: 5, kind: "sign_in" };
}

export function nextSchoolScanAction(state: Pick<SchoolOnboardingState, "workflowRevision">): "scan" | "replay" {
  return state.workflowRevision === null ? "scan" : "replay";
}
