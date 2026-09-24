import assert from "node:assert/strict";
import test from "node:test";

import {
  completeOnboarding,
  expectedAssignments,
  normalizedExpected,
  publicState,
  requireCheckpoint4Hooks,
  withLmsApp,
} from "./harness.mjs";

test("J1: onboarding scans the isolated LMS and Today matches expected.json", async (t) => {
  if (!(await requireCheckpoint4Hooks(t, ["STUDI_E2E_RUNTIME_MODULE", "STUDI_E2E_HOMEWORK_ROOT"]))) return;
  const expected = await expectedAssignments("moodle-noisy.json");
  await withLmsApp({ scenario: "moodle-noisy", script: { scan: [[]] } }, async ({ page, school }) => {
    await completeOnboarding(page, school.url);
    await page.getByRole("button", { name: /All work/ }).click();

    const onboarding = await publicState(page, "getSchoolOnboardingState");
    const actual = onboarding.assignments.map((assignment) => ({
      course: onboarding.courses.find((course) => course.courseId === assignment.courseId)?.label,
      title: assignment.title,
      dueAt: assignment.dueAt ?? null,
      sourceTarget: assignment.sourceTarget,
    }));
    const wanted = normalizedExpected(expected, school.origins);
    assert.equal(actual.length, wanted.length, `Saved work: ${actual.map(item => item.title).join(", ")}`);
    for (const assignment of wanted) {
      const observed = actual.find((item) => item.title === assignment.title);
      assert.ok(observed, `Today is missing ${assignment.title}`);
      assert.equal(observed.course, assignment.course);
      assert.equal(observed.dueAt === null ? null : Date.parse(observed.dueAt), assignment.dueAt === null ? null : Date.parse(assignment.dueAt));
      assert.ok(assignment.sourceTargets.includes(observed.sourceTarget), `${assignment.title} has the wrong school link`);
    }
    for (const assignment of wanted) {
      await page.getByText(assignment.title, { exact: true }).waitFor({ state: "visible" });
    }
    assert.equal(school.inspect().effects.some((effect) => effect.type === "submission_committed"), false);
  });
});
