import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import { PermissionRuleSchema, resolvePermission } from "../../dist/shared/index.js";

import { assignment, timestamp } from "./fixtures.mjs";

const permissionAssignment = {
  assignmentId: assignment.assignmentId,
  courseId: assignment.courseId,
  matchedPatternIds: ["pattern-cell-structure"],
};

function rule(scope, mode, ruleId, updates = {}) {
  const targets = {
    global: {},
    course: { courseId: assignment.courseId },
    pattern: { courseId: assignment.courseId, patternId: "pattern-cell-structure" },
    assignment: { assignmentId: assignment.assignmentId },
  };
  return PermissionRuleSchema.parse({
    schemaVersion: 1,
    ruleId,
    scope,
    mode,
    updatedAt: timestamp,
    ...targets[scope],
    ...updates,
  });
}

test("no matching rule safely returns do_not_attempt", () => {
  assert.deepEqual(resolvePermission(permissionAssignment, []), {
    mode: "do_not_attempt",
    mayAttempt: false,
    maySubmit: false,
    matchedRuleId: null,
    rationale: "No permission rule matched; Studi will not attempt the assignment.",
  });

  const unrelated = rule("course", "auto_submit", "unrelated", { courseId: "another-course" });
  assert.equal(resolvePermission(permissionAssignment, [unrelated]).mode, "do_not_attempt");
});

test("specificity is assignment, pattern, course, then global regardless of input order", () => {
  const rules = [
    rule("global", "auto_submit", "global-rule"),
    rule("course", "auto_submit", "course-rule"),
    rule("pattern", "attempt", "pattern-rule"),
    rule("assignment", "do_not_attempt", "assignment-rule"),
  ];

  fc.assert(
    fc.property(fc.shuffledSubarray(rules, { minLength: rules.length, maxLength: rules.length }), (order) => {
      const result = resolvePermission(permissionAssignment, order);
      assert.equal(result.mode, "do_not_attempt");
      assert.equal(result.matchedRuleId, "assignment-rule");
    }),
  );
});

test("equal specificity chooses latest updatedAt, then lexically smallest rule ID", () => {
  const older = rule("assignment", "auto_submit", "rule-z", {
    updatedAt: "2026-08-29T12:34:56.000Z",
  });
  const newer = rule("assignment", "attempt", "rule-y", {
    updatedAt: "2026-08-30T12:34:56.000Z",
  });
  assert.equal(resolvePermission(permissionAssignment, [newer, older]).matchedRuleId, "rule-y");

  const lexicalWinner = rule("assignment", "do_not_attempt", "rule-a");
  const lexicalLoser = rule("assignment", "auto_submit", "rule-b");
  const result = resolvePermission(permissionAssignment, [lexicalLoser, lexicalWinner]);
  assert.equal(result.matchedRuleId, "rule-a");
  assert.equal(result.mode, "do_not_attempt");
});

test("maySubmit is true only for auto_submit", () => {
  fc.assert(
    fc.property(fc.constantFrom("do_not_attempt", "attempt", "auto_submit"), (mode) => {
      const result = resolvePermission(permissionAssignment, [rule("assignment", mode, `rule-${mode}`)]);
      assert.equal(result.maySubmit, mode === "auto_submit");
      assert.equal(result.mayAttempt, mode !== "do_not_attempt");
    }),
  );
});

test("pattern matching requires both deterministic pattern identity and course context", () => {
  const matching = rule("pattern", "attempt", "pattern-match");
  const wrongPattern = rule("pattern", "auto_submit", "pattern-miss", {
    patternId: "pattern-calculus",
  });
  const wrongCourse = rule("pattern", "auto_submit", "pattern-other-course", {
    courseId: "course-calculus",
  });
  const result = resolvePermission(permissionAssignment, [wrongPattern, wrongCourse, matching]);
  assert.equal(result.matchedRuleId, "pattern-match");
});

test("a cross-course title match cannot authorize a pattern rule", () => {
  const courseRule = rule("course", "do_not_attempt", "course-safe");
  const crossCoursePattern = rule("pattern", "auto_submit", "other-course-pattern", {
    courseId: "other-course",
  });

  const titledLikeOtherCourse = {
    ...permissionAssignment,
    title: "Weekly quiz",
  };
  const result = resolvePermission(titledLikeOtherCourse, [courseRule, crossCoursePattern]);

  assert.equal(result.mode, "do_not_attempt");
  assert.equal(result.maySubmit, false);
  assert.equal(result.matchedRuleId, "course-safe");
  assert.equal(
    PermissionRuleSchema.safeParse({
      schemaVersion: 1,
      ruleId: "unsafe-title-rule",
      scope: "pattern",
      courseId: assignment.courseId,
      titleIncludes: "weekly",
      mode: "auto_submit",
      updatedAt: timestamp,
    }).success,
    false,
  );
});
