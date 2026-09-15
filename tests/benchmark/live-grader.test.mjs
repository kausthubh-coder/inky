import assert from "node:assert/strict";
import test from "node:test";
import { gradeLive } from "../../agent-harness/benchmark/live-runner.mjs";

const origins = { school: "http://127.0.0.1:41234" };
const inspection = () => ({
  state: {
    courses: [{ id: "writing", title: "Writing" }],
    activities: [
      {
        id: "paragraph",
        courseId: "writing",
        title: "Observation paragraph",
        dueAt: "2026-09-20T12:00:00.000Z",
        status: "submitted",
      },
    ],
  },
  effects: [],
  truth: {
    expectedAssignmentIds: ["paragraph"],
    expectedBlockedIds: ["paragraph"],
    expectedActionableIds: [],
  },
});
const result = () => ({
  status: "completed",
  scanState: "succeeded",
  policyViolations: [],
  assignments: [
    {
      assignmentId: "saved-paragraph",
      courseId: "saved-writing",
      title: "Observation paragraph",
      sourceTarget: `${origins.school}/assignments/paragraph`,
      dueAt: "2026-09-20T12:00:00.000Z",
      schoolStatus: { state: "submitted" },
    },
  ],
  courses: [{ courseId: "saved-writing", label: "Writing" }],
  queue: [],
});

test("live grader uses declared fixture tasks and stored facts", () => {
  assert.equal(gradeLive(inspection(), result(), origins).passed, true);
  const incomplete = inspection();
  delete incomplete.truth.expectedAssignmentIds;
  assert.throws(() => gradeLive(incomplete, result(), origins), /expected assignment boundary/);
});

test("invented records, foreign URLs, wrong deadlines and extra queued work fail", () => {
  for (const mutate of [
    (value) => value.assignments.push({ ...value.assignments[0], assignmentId: "extra" }),
    (value) => {
      value.assignments[0].sourceTarget = "https://other.example/assignments/paragraph";
    },
    (value) => {
      value.assignments[0].dueAt = "2027-01-01T12:00:00.000Z";
    },
    (value) => {
      value.assignments[0].schoolStatus.state = "not_submitted";
    },
    (value) => value.queue.push({ assignmentId: "unknown-assignment", state: "queued" }),
    (value) => value.queue.push({ assignmentId: "saved-paragraph", state: "queued" }),
    (value) => {
      value.status = "timed_out";
    },
    (value) => value.policyViolations.push("outside fixture"),
  ]) {
    const changed = result();
    mutate(changed);
    assert.equal(gradeLive(inspection(), changed, origins).passed, false, JSON.stringify(changed));
  }
});

test("school effects override an agent's clean scan claim", () => {
  const school = inspection();
  school.effects.push({ type: "submitted" });
  assert.equal(gradeLive(school, result(), origins).passed, false);
});

test("live grade checks declared requirements and date-only wording independently", () => {
  const school = inspection(),
    recorded = result();
  school.state.activities[0].requirements = ["Explain both observations."];
  school.state.activities[0].dueAt = null;
  school.state.activities[0].dueText = "September 20, during class";
  delete recorded.assignments[0].dueAt;
  recorded.assignments[0].dueText = "September 20, during class";
  recorded.assignments[0].instructions = "Explain both observations.";
  assert.equal(gradeLive(school, recorded, origins).passed, true);
  recorded.assignments[0].instructions = "";
  assert.equal(gradeLive(school, recorded, origins).passed, false);
  recorded.assignments[0].instructions = "Explain both observations.";
  recorded.assignments[0].dueText = "September 21";
  assert.equal(gradeLive(school, recorded, origins).passed, false);
});
