import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import {
  AssignmentSchema,
  EvidenceReferenceSchema,
  EventEnvelopeSchema,
  GlobalPermissionRuleSchema,
  OpaqueIdSchema,
  PatternPermissionRuleSchema,
  PermissionAssignmentContextSchema,
  PermissionResolutionSchema,
  RunSchema,
  SafeSourceTargetSchema,
  TaskSchema,
  TaskCreatedEventSchema,
  ToolMutationEnvelopeSchema,
  ToolResultEnvelopeSchema,
} from "../../dist/shared/index.js";

import {
  assignment,
  event,
  evidence,
  run,
  task,
  taskCreatedEvent,
  timestamp,
  toolMutation,
  toolResult,
} from "./fixtures.mjs";

const versionedExamples = [
  ["assignment", AssignmentSchema, assignment],
  ["evidence", EvidenceReferenceSchema, evidence],
  [
    "permission rule",
    GlobalPermissionRuleSchema,
    {
      schemaVersion: 1,
      ruleId: "rule-1",
      scope: "global",
      mode: "attempt",
      updatedAt: timestamp,
    },
  ],
  ["task", TaskSchema, task],
  ["task-created event", TaskCreatedEventSchema, taskCreatedEvent],
  ["run", RunSchema, run],
  ["event", EventEnvelopeSchema, event],
  ["tool mutation", ToolMutationEnvelopeSchema, toolMutation],
  ["tool result", ToolResultEnvelopeSchema, toolResult],
];

for (const [name, schema, example] of versionedExamples) {
  test(`${name} accepts version 1 and rejects unknown versions`, () => {
    assert.deepEqual(schema.parse(example), example);
    assert.equal(schema.safeParse({ ...example, schemaVersion: 2 }).success, false);
  });
}

test("IDs and timestamps reject empty or non-normalized values", () => {
  assert.equal(OpaqueIdSchema.safeParse("").success, false);
  assert.equal(OpaqueIdSchema.safeParse("   ").success, false);
  assert.equal(TaskSchema.safeParse({ ...task, updatedAt: "2026-08-30T12:34:56Z" }).success, false);
  assert.equal(TaskSchema.safeParse({ ...task, taskId: "" }).success, false);
});

test("evidence rejects secret-shaped fields and credential-bearing targets", () => {
  for (const field of ["password", "cookie", "authorizationHeader", "pageHtml"]) {
    assert.equal(
      EvidenceReferenceSchema.safeParse({ ...evidence, [field]: "must-not-parse" }).success,
      false,
      `accepted forbidden evidence field: ${field}`,
    );
  }

  for (const target of [
    "https://user:password@school.example.edu/assignment/1",
    "https://school.example.edu/assignment/1?access_token=secret",
    "https://school.example.edu/assignment/1#authorization=secret",
    "file:///tmp/evidence.html",
  ]) {
    assert.equal(SafeSourceTargetSchema.safeParse(target).success, false, `accepted unsafe target: ${target}`);
  }
});

const sensitiveUrlKeyParts = [
  ["token"],
  ["auth"],
  ["session"],
  ["session", "id"],
  ["cookie"],
  ["api", "key"],
  ["access", "token"],
  ["authorization"],
  ["client", "secret"],
  ["password"],
  ["secret"],
];

test("evidence URL secret-key table covers query and fragment parameters", () => {
  const keys = [
    "token",
    "auth",
    "session",
    "sessionid",
    "cookie",
    "api_key",
    "api-key",
    "apikey",
    "access_token",
    "authorization",
    "client_secret",
  ];

  for (const key of keys) {
    for (const target of [
      `https://school.example.edu/assignment/1?${key}=secret`,
      `https://school.example.edu/assignment/1#${key}=secret`,
      `https://school.example.edu/assignment/1#${key}=secret?view=1`,
      `https://school.example.edu/assignment/1#view=1?${key}=secret`,
      `https://school.example.edu/assignment/1#/route?${key}=secret`,
    ]) {
      assert.equal(SafeSourceTargetSchema.safeParse(target).success, false, `accepted ${target}`);
    }
  }
});

test("evidence fragments reject sensitive keys on either side of later question marks", () => {
  for (const target of [
    "https://school.example.edu/assignment/1#token=secret?view=1",
    "https://school.example.edu/assignment/1#access-token=secret?view=1",
    "https://school.example.edu/assignment/1#ACCESS_TOKEN=secret?view=1",
    "https://school.example.edu/assignment/1#client_secret=secret?view=1",
    "https://school.example.edu/assignment/1#view=1?token=secret",
  ]) {
    assert.equal(SafeSourceTargetSchema.safeParse(target).success, false, `accepted ${target}`);
  }
});

test("evidence URL key normalization rejects generated case and separator variants", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...sensitiveUrlKeyParts),
      fc.constantFrom("", "_", "-", ".", " ", "--"),
      fc.boolean(),
      fc.constantFrom("query", "fragment", "fragment-before-question", "fragment-after-question"),
      (parts, separator, uppercase, location) => {
        const rawKey = parts.join(separator);
        const key = encodeURIComponent(uppercase ? rawKey.toLocaleUpperCase("en-US") : rawKey);
        const target = {
          query: `https://school.example.edu/assignment/1?${key}=secret`,
          fragment: `https://school.example.edu/assignment/1#${key}=secret`,
          "fragment-before-question": `https://school.example.edu/assignment/1#${key}=secret?view=1`,
          "fragment-after-question": `https://school.example.edu/assignment/1#view=1?${key}=secret`,
        }[location];
        assert.equal(SafeSourceTargetSchema.safeParse(target).success, false, `accepted ${target}`);
      },
    ),
    { numRuns: 1_000, seed: 301013 },
  );
});

test("evidence URL key normalization does not reject unrelated parameter names", () => {
  const unrelatedKeys = [
    "tokenizer",
    "authMethod",
    "sessionDate",
    "cookiePolicy",
    "apiKeyLabel",
    "accessibilityToken",
    "authorizationCodeFlow",
    "clientSecretary",
    "secretary",
  ];

  fc.assert(
    fc.property(
      fc.constantFrom(...unrelatedKeys),
      fc.constantFrom("query", "fragment", "fragment-before-question", "fragment-after-question"),
      (key, location) => {
        const target = {
          query: `https://school.example.edu/assignment/1?${key}=public-label`,
          fragment: `https://school.example.edu/assignment/1#${key}=public-label`,
          "fragment-before-question":
            `https://school.example.edu/assignment/1#${key}=public-label?view=1`,
          "fragment-after-question":
            `https://school.example.edu/assignment/1#view=1?${key}=public-label`,
        }[location];
        assert.equal(SafeSourceTargetSchema.safeParse(target).success, true, `rejected ${target}`);
      },
    ),
    { numRuns: 500, seed: 401013 },
  );
});

test("evidence fragments preserve credential-free routes", () => {
  for (const target of [
    "https://school.example.edu/assignment/1#/route?view=1",
    "https://school.example.edu/assignment/1#/authorization?view=1",
    "https://school.example.edu/assignment/1#/token/course?view=1",
    "https://school.example.edu/assignment/1#/route?authorizationCodeFlow=public-label",
  ]) {
    assert.equal(SafeSourceTargetSchema.safeParse(target).success, true, `rejected ${target}`);
  }
});

test("schemas reject unknown enum values and malformed results", () => {
  assert.equal(TaskSchema.safeParse({ ...task, state: "done" }).success, false);
  assert.equal(ToolResultEnvelopeSchema.safeParse({ ...toolResult, outcome: "ok" }).success, false);
  assert.equal(
    PermissionResolutionSchema.safeParse({
      mode: "attempt",
      mayAttempt: true,
      maySubmit: true,
      matchedRuleId: "rule-1",
      rationale: "malformed",
    }).success,
    false,
  );
});

test("pattern permission context is explicit, strict, and deduplicated", () => {
  const context = {
    assignmentId: assignment.assignmentId,
    courseId: assignment.courseId,
    matchedPatternIds: ["pattern-1", "pattern-2"],
  };
  assert.deepEqual(PermissionAssignmentContextSchema.parse(context), context);
  assert.equal(
    PermissionAssignmentContextSchema.safeParse({
      ...context,
      matchedPatternIds: ["pattern-1", "pattern-1"],
    }).success,
    false,
  );
  assert.equal(
    PatternPermissionRuleSchema.safeParse({
      schemaVersion: 1,
      ruleId: "pattern-rule",
      scope: "pattern",
      courseId: assignment.courseId,
      patternId: "pattern-1",
      mode: "attempt",
      updatedAt: timestamp,
    }).success,
    true,
  );
});
