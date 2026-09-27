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

// The connector saves the Moodle rows; external tools are doorways. Like the real agent, open each
// work tool from the course page, follow it to the vendor's index and record that vendor's rows.
// The reading-only Course-Ready Textbook is skipped.
function vendorScan(school) {
  const { activities } = school.inspect().state;
  const row = (id, href) => {
    const item = activities.find((activity) => activity.id === id);
    return { title: item.title, href, dueText: item.dueText, kind: "assignment" };
  };
  const course = "Programming in C", snapshot = { op: "tool", name: "browser_snapshot" };
  return { scan: [[
    { op: "clickByName", name: "CS 230 Programming in C" },
    snapshot,
    { op: "tool", name: "scan_record_course", input: { label: course } },
    { op: "clickByName", name: "Expand all" },
    { op: "clickByName", name: "WebAssign problem set 1", search: true },
    { op: "clickByName", name: "Open WebAssign" },
    { op: "clickByName", name: "Statistics homework" },
    snapshot,
    { op: "tool", name: "scan_record_rows", input: { courseKey: course, rows: [row("webassign-1", `${school.origins.school}/mod/lti/view.php?id=webassign-1`)] } },
    { op: "clickByName", name: "Dashboard" },
    { op: "clickByName", name: "CS 230 Programming in C" },
    { op: "clickByName", name: "Expand all" },
    { op: "clickByName", name: "Gradescope worksheet 1", search: true },
    { op: "clickByName", name: "Feedback" },
    snapshot,
    { op: "tool", name: "scan_record_rows", input: { courseKey: course, rows: [row("gradescope-1", `${school.origins.feedback}/assignments/gradescope-1`)] } },
  ]] };
}

test("J1: onboarding scans the isolated LMS and Today matches expected.json", async (t) => {
  if (!(await requireCheckpoint4Hooks(t, ["STUDI_E2E_RUNTIME_MODULE", "STUDI_E2E_HOMEWORK_ROOT"]))) return;
  const expected = await expectedAssignments("moodle-noisy.json");
  await withLmsApp({ scenario: "moodle-noisy", script: vendorScan }, async ({ page, school }) => {
    await completeOnboarding(page, school.url);
    await page.getByRole("button", { name: /All work/ }).click();

    const onboarding = await publicState(page, "getSchoolOnboardingState");
    // Meetings and other class context are saved too; the week holds only work.
    const actual = onboarding.assignments.filter((assignment) => (assignment.category ?? "work") === "work").map((assignment) => ({
      course: onboarding.courses.find((course) => course.courseId === assignment.courseId)?.label,
      title: assignment.title,
      dueAt: assignment.dueAt ?? null,
      status: assignment.schoolStatus?.state,
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
      if (assignment.status) assert.equal(observed.status, assignment.status, `${assignment.title} should read as ${assignment.status}`);
    }
    for (const assignment of wanted) {
      await page.getByText(assignment.title, { exact: true }).waitFor({ state: "visible" });
    }
    assert.equal(school.inspect().effects.some((effect) => effect.type === "submission_committed"), false);
  });
});
