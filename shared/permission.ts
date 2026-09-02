import { z } from "zod";

import {
  AssignmentIdSchema,
  CourseIdSchema,
  PatternIdSchema,
  RuleIdSchema,
} from "./ids.js";
import { IsoTimestampSchema, SchemaVersionSchema } from "./schema-version.js";

export const PermissionModeSchema = z.enum(["do_not_attempt", "attempt", "auto_submit"]);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

const PermissionRuleBaseSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  ruleId: RuleIdSchema,
  mode: PermissionModeSchema,
  updatedAt: IsoTimestampSchema,
});

export const GlobalPermissionRuleSchema = PermissionRuleBaseSchema.extend({
  scope: z.literal("global"),
});

export const CoursePermissionRuleSchema = PermissionRuleBaseSchema.extend({
  scope: z.literal("course"),
  courseId: CourseIdSchema,
});

export const PatternPermissionRuleSchema = PermissionRuleBaseSchema.extend({
  scope: z.literal("pattern"),
  courseId: CourseIdSchema,
  patternId: PatternIdSchema,
});

export const AssignmentPermissionRuleSchema = PermissionRuleBaseSchema.extend({
  scope: z.literal("assignment"),
  assignmentId: AssignmentIdSchema,
});

export const PermissionRuleSchema = z.discriminatedUnion("scope", [
  GlobalPermissionRuleSchema,
  CoursePermissionRuleSchema,
  PatternPermissionRuleSchema,
  AssignmentPermissionRuleSchema,
]);

export type PermissionRule = z.infer<typeof PermissionRuleSchema>;

export const PermissionAssignmentContextSchema = z.strictObject({
  assignmentId: AssignmentIdSchema,
  courseId: CourseIdSchema,
  matchedPatternIds: z.array(PatternIdSchema).max(1_000).refine(
    (patternIds) => new Set(patternIds).size === patternIds.length,
    { message: "Matched pattern IDs must be unique" },
  ),
});

export type PermissionAssignmentContext = z.infer<typeof PermissionAssignmentContextSchema>;

export const PermissionResolutionSchema = z
  .strictObject({
    mode: PermissionModeSchema,
    mayAttempt: z.boolean(),
    maySubmit: z.boolean(),
    matchedRuleId: RuleIdSchema.nullable(),
    rationale: z.string().min(1),
  })
  .superRefine((resolution, context) => {
    const expectedMayAttempt = resolution.mode !== "do_not_attempt";
    const expectedMaySubmit = resolution.mode === "auto_submit";
    if (resolution.mayAttempt !== expectedMayAttempt) {
      context.addIssue({
        code: "custom",
        path: ["mayAttempt"],
        message: "mayAttempt must match the resolved permission mode",
      });
    }
    if (resolution.maySubmit !== expectedMaySubmit) {
      context.addIssue({
        code: "custom",
        path: ["maySubmit"],
        message: "Only auto_submit may set maySubmit",
      });
    }
  });

export type PermissionResolution = z.infer<typeof PermissionResolutionSchema>;

const specificity = {
  global: 0,
  course: 1,
  pattern: 2,
  assignment: 3,
} as const satisfies Record<PermissionRule["scope"], number>;

export function resolvePermission(
  assignment: PermissionAssignmentContext,
  rules: readonly PermissionRule[],
): PermissionResolution {
  const matchingRules = rules.filter((rule) => ruleMatches(rule, assignment));
  const selected = matchingRules.sort((left, right) => {
    const specificityDifference = specificity[right.scope] - specificity[left.scope];
    if (specificityDifference !== 0) {
      return specificityDifference;
    }

    const updatedAtDifference = right.updatedAt.localeCompare(left.updatedAt);
    if (updatedAtDifference !== 0) {
      return updatedAtDifference;
    }

    return left.ruleId.localeCompare(right.ruleId);
  })[0];

  if (!selected) {
    return {
      mode: "do_not_attempt",
      mayAttempt: false,
      maySubmit: false,
      matchedRuleId: null,
      rationale: "No permission rule matched; Studi will not attempt the assignment.",
    };
  }

  return {
    mode: selected.mode,
    mayAttempt: selected.mode === "attempt" || selected.mode === "auto_submit",
    maySubmit: selected.mode === "auto_submit",
    matchedRuleId: selected.ruleId,
    rationale: `Matched ${selected.scope} permission rule ${selected.ruleId}.`,
  };
}

function ruleMatches(
  rule: PermissionRule,
  assignment: PermissionAssignmentContext,
): boolean {
  switch (rule.scope) {
    case "global":
      return true;
    case "course":
      return rule.courseId === assignment.courseId;
    case "pattern":
      return (
        rule.courseId === assignment.courseId && assignment.matchedPatternIds.includes(rule.patternId)
      );
    case "assignment":
      return rule.assignmentId === assignment.assignmentId;
  }
}
