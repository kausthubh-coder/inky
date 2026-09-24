import assert from "node:assert/strict";
import test from "node:test";
import { dirname } from "node:path";
import { gradeWork } from "../../agent-harness/lms/grade-work.mjs";
import { gradeCodingArtifacts } from "../../agent-harness/lms/grade-code.mjs";
import { completeOnboarding, committedSubmissions, publicState, schoolPage, singleAssignmentScript, waitForPublicState, withLmsApp } from "../e2e/harness.mjs";

// Run explicitly before release. The regular scripted test:e2e suite excludes
// this file because it makes real model calls through the dedicated QA cache.
test("live J2: GPT-6 Sol solves and submits the fake-school quiz once", { timeout: 600_000 }, async () => {
  await withLmsApp({ scenario: "quiz", live: true, reviewWindowMs: 5_000, script: school => singleAssignmentScript(school, []) }, async ({ page, school }) => {
    await completeOnboarding(page, school.url, "Do it and submit");
    await page.getByText("Stacks, queues, and complexity quiz", { exact: true }).first().click();
    await page.getByRole("button", { name: /Check and start|Start/ }).first().click();
    await waitForPublicState(page, "getLifecycleState", state => ["ready_review", "submitted", "needs_user"].includes(state.execution?.phase), 300_000);
    const state = await waitForPublicState(page, "getLifecycleState", state => ["submitted", "needs_user"].includes(state.execution?.phase), 180_000);
    assert.equal(state.execution?.phase, "submitted", JSON.stringify({ error: state.execution?.lastError, effects: school.inspect().effects.filter(effect => effect.type !== "page_viewed"), grade: gradeWork(school.inspect(), "structures-quiz"), actions: state.execution?.actions?.map(action => action.label) }));
    assert.equal(committedSubmissions(school).length, 1);
    assert.ok(state.submissionReceipt);
    const grade = gradeWork(school.inspect(), "structures-quiz");
    assert.equal(grade.outcome, "passed", JSON.stringify(grade));
  });
});

test("live J2: coding work waits for the student, then submits one verified file set", { timeout: 600_000 }, async () => {
  await withLmsApp({ scenario: "coding-multifile", live: true, script: school => singleAssignmentScript(school, []) }, async ({ app, page, school }) => {
    await completeOnboarding(page, school.url, "Do it, I'll submit");
    await page.getByText("Rainfall calculator: multi-file C project", { exact: true }).first().click();
    await page.getByRole("button", { name: /Check and start|Start/ }).first().click();
    const state = await waitForPublicState(page, "getLifecycleState", value => ["ready_review", "needs_user"].includes(value.execution?.phase), 300_000);
    assert.equal(state.execution?.phase, "ready_review", state.execution?.lastError ?? "Live coding work stopped before review");
    assert.equal(committedSubmissions(school).length, 0);
    const workspace = await publicState(page, "getProductSettings");
    assert.ok(workspace.preferences.homeworkRoot);
    const draft = school.inspect().state.drafts["rainfall-project"];
    assert.deepEqual(draft?.files.map(file => file.name).sort(), ["main.c", "stats.c", "stats.h", "README.md"].sort());
    const browser = schoolPage(app, school.url);
    await browser.reload();
    await browser.getByRole("button", { name: "Submit assignment" }).click();
    assert.equal(committedSubmissions(school).length, 1);
    await page.getByLabel("Words shown after submission").fill("Submission received");
    await page.getByRole("button", { name: "I submitted it — check" }).click();
    const submitted = await waitForPublicState(page, "getLifecycleState", value => value.execution?.phase === "submitted");
    assert.ok(submitted.submissionReceipt);
    const grade = await gradeCodingArtifacts(school.inspect(), dirname(school.statePath));
    assert.equal(grade.outcome, "incomplete", JSON.stringify(grade));
  });
});
