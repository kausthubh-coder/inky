import assert from "node:assert/strict";
import test from "node:test";
import { gradeReplay, replayFixture as fixture } from "../../agent-harness/benchmark/replay-cases.mjs";

function correctResult() {
  return {
    status: "completed",
    scanState: "succeeded",
    errors: [],
    policyViolations: [],
    courses: fixture.courses.map((course) => ({
      courseId: `stored-${course.id}`,
      label: course.title,
      sourceTarget: `http://127.0.0.1:43119/course/view.php?id=${course.id}`,
    })),
    assignments: fixture.assignments.map((item) => ({
      assignmentId: `stored-${item.id}`,
      title: item.title,
      courseId: `stored-${item.course}`,
      sourceTarget: `http://127.0.0.1:43119/mod/assign/view.php?id=${item.id}`,
      schoolStatus: { state: item.status },
      dueAt: item.dateOnly ? undefined : item.due,
      dueText: item.due,
      deadlinePrecision: item.dateOnly ? "date" : "datetime",
      latePolicy: item.late ? { state: item.late, until: item.until } : undefined,
      requirementEvidence: item.requirements.map((text) => ({ text })),
      requirementsState: item.missing ? "partial" : "complete",
      missingRequirements: item.missing ?? [],
    })),
    queue: fixture.assignments
      .filter((item) => item.queue)
      .map((item) => ({ assignmentId: `stored-${item.id}`, state: "queued" })),
  };
}
const assignment = (result, id) => result.assignments.find((item) => item.assignmentId === `stored-${id}`);
function rejects(mutate, checkName) {
  const result = correctResult();
  mutate(result);
  const grade = gradeReplay(fixture, result);
  assert.equal(grade.passed, false, checkName);
  assert.ok(
    grade.checks.some((check) => check.name === checkName && !check.passed),
    checkName,
  );
}

test("correct stored records pass without depending on generated local IDs", () => {
  const result = correctResult();
  assert.equal(gradeReplay(fixture, result).passed, true);
  for (const record of [...result.courses, ...result.assignments])
    record.sourceTarget += "&action=editsubmission#details";
  result.queue.reverse();
  assert.equal(gradeReplay(fixture, result).passed, true);
});

test("canonical identity rejects wrong origin, route, credentials, ID, course and title", () => {
  for (const url of [
    "http://wrong.example/mod/assign/view.php?id=puzzle",
    "http://127.0.0.1:43120/mod/assign/view.php?id=puzzle",
    "http://127.0.0.1:43119/other?id=puzzle",
    "http://user@127.0.0.1:43119/mod/assign/view.php?id=puzzle",
    "http://127.0.0.1:43119/mod/assign/view.php?id=puzzle&id=graded",
    "http://127.0.0.1:43119/mod/assign/view.php?id=other",
    "broken",
  ]) {
    rejects((result) => {
      assignment(result, "puzzle").sourceTarget = url;
    }, "puzzle: identity");
  }
  rejects((result) => {
    assignment(result, "puzzle").courseId = "stored-statistics";
  }, "puzzle: identity");
  rejects((result) => {
    assignment(result, "puzzle").title = "Wrong title";
  }, "puzzle: identity");
  rejects((result) => {
    result.courses[0].label = "Other course";
  }, "programming: course identity");
  rejects((result) => {
    result.courses[0].sourceTarget = "http://wrong.example/course/view.php?id=programming";
  }, "programming: course identity");
  rejects((result) => {
    result.courses[1].courseId = result.courses[0].courseId;
  }, "every course persisted exactly once");
  rejects((result) => {
    result.assignments[1].assignmentId = result.assignments[0].assignmentId;
  }, "every assignment persisted exactly once");
});

test("discovery cannot pass with missing, invented or duplicated source identities", () => {
  rejects((result) => result.assignments.pop(), "every assignment persisted exactly once");
  rejects(
    (result) => result.assignments.push({ ...result.assignments[0], assignmentId: "invented" }),
    "every assignment persisted exactly once",
  );
  rejects((result) => {
    result.assignments[1] = { ...result.assignments[0], assignmentId: "duplicate" };
  }, "graded: identity");
  rejects((result) => {
    result.courses = [];
  }, "every course persisted exactly once");
});

test("date-only retains the observed date without invented midnight; exact deadlines remain exact", () => {
  rejects((result) => {
    assignment(result, "date-only").dueText = "Nov 30, 2099";
  }, "date-only: deadline precision");
  rejects((result) => {
    delete assignment(result, "date-only").dueText;
  }, "date-only: deadline precision");
  rejects((result) => {
    assignment(result, "date-only").dueAt = "2026-10-13T00:00:00.000Z";
  }, "date-only: deadline precision");
  rejects((result) => {
    assignment(result, "date-only").deadlinePrecision = "datetime";
  }, "date-only: deadline precision");
  rejects((result) => {
    assignment(result, "puzzle").dueAt = "2026-09-21T23:55:00.000Z";
  }, "puzzle: deadline precision");
});

test("school status and late acceptance are graded independently of resulting queue", () => {
  rejects((result) => {
    assignment(result, "graded").schoolStatus.state = "not_submitted";
  }, "graded: school status");
  rejects((result) => {
    assignment(result, "extension").latePolicy.state = "not_accepted";
  }, "extension: late policy");
  rejects((result) => {
    delete assignment(result, "extension").latePolicy.until;
  }, "extension: late policy");
  rejects((result) => {
    assignment(result, "extension").latePolicy.until = "2026-10-01T00:00:00.000Z";
  }, "extension: late policy");
  rejects((result) => {
    assignment(result, "puzzle").latePolicy = { state: "accepted" };
  }, "puzzle: no invented late permission");
});

test("requirements accept complete legacy excerpts, mixed storage and harmless whitespace", () => {
  const legacy = correctResult();
  for (const item of legacy.assignments) {
    item.instructions = item.requirementEvidence.map((fragment) => fragment.text).join("\nRubric section\n");
    delete item.requirementEvidence;
  }
  assert.equal(gradeReplay(fixture, legacy).passed, true);
  for (const item of legacy.assignments) item.requirementEvidence = [];
  assert.equal(gradeReplay(fixture, legacy).passed, true);
  const mixed = correctResult(),
    puzzle = assignment(mixed, "puzzle");
  puzzle.instructions = puzzle.requirementEvidence.pop().text.replaceAll(" ", "\n ");
  assert.equal(gradeReplay(fixture, mixed).passed, true);
  rejects(
    (result) => assignment(result, "puzzle").requirementEvidence.pop(),
    "puzzle: all requirement fragments retained",
  );
});

test("unknown requirements cannot disappear or be marked complete", () => {
  rejects((result) => {
    assignment(result, "incomplete").missingRequirements = [];
  }, "incomplete: unresolved requirements retained");
  rejects((result) => {
    assignment(result, "incomplete").requirementsState = "complete";
  }, "incomplete: unresolved requirements retained");
  rejects((result) => {
    delete assignment(result, "incomplete").requirementsState;
  }, "incomplete: unresolved requirements retained");
  rejects((result) => {
    assignment(result, "puzzle").missingRequirements = ["Invented gap"];
  }, "puzzle: unresolved requirements retained");
});

test("queue must contain eligible assignments exactly once with no unrelated entries", () => {
  for (const extra of [
    { assignmentId: "invented", state: "queued" },
    { assignmentId: "stored-graded", state: "queued" },
    { assignmentId: "stored-puzzle", state: "queued" },
    { assignmentId: "stored-closed", state: "running" },
  ]) {
    rejects((result) => result.queue.push(extra), "queue contains exactly the eligible assignments once");
  }
  rejects((result) => result.queue.pop(), "queue contains exactly the eligible assignments once");
  rejects((result) => {
    result.queue[0].state = "running";
  }, "queue contains exactly the eligible assignments once");
});

test("failed driver, partial coverage, recording errors and violations cannot pass", () => {
  rejects((result) => {
    result.status = "failed";
  }, "driver completed");
  rejects((result) => {
    result.scanState = "partial";
  }, "scan completes with explicit inventories");
  rejects((result) => {
    result.errors.push("Recording failed");
  }, "no recording errors");
  rejects((result) => {
    result.policyViolations.push("Denied navigation");
  }, "no policy violations");
  assert.equal(gradeReplay(fixture, {}).passed, false);
  assert.equal(gradeReplay(fixture, null).passed, false);
});
