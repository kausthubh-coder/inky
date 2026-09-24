import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  committedSubmissions,
  completeOnboarding,
  publicState,
  projectRoot,
  requireCheckpoint4Hooks,
  singleAssignmentScript,
  schoolPage,
  waitForPublicState,
  withLmsApp,
} from "./harness.mjs";

const quizAnswer = "Q1: B\nQ2: A\nQ3: O(n)";
const quizWork = [
  { op: "typeByName", name: "Your response", text: quizAnswer },
  { op: "clickByName", name: "Save draft" },
  { op: "tool", name: "browser_snapshot" },
  { op: "tool", name: "assignment_start_review", input: {
    answers: quizAnswer,
    completedRequirements: [{ requirement: "Three labelled quiz answers", evidence: "Q1, Q2, and Q3 are filled on the visible school page." }],
    summary: "All three labelled answers are visible and the draft was saved.",
  } },
];

test("J2: attempt-only stops at review, student submits once, and Studi shows the receipt", async (t) => {
  if (!(await requireCheckpoint4Hooks(t, ["STUDI_E2E_RUNTIME_MODULE", "STUDI_E2E_HOMEWORK_ROOT"]))) return;
  const capture = process.env.STUDI_CP4_CAPTURE === "1";
  const work = capture ? [
    ...quizWork.slice(0, -1),
    { op: "delay", ms: 2500 },
    { ...quizWork.at(-1), input: {
      ...quizWork.at(-1).input,
      doubts: [{ where: "Question 3", why: "Check whether your class expects worst-case or average-case notation." }],
    } },
  ] : quizWork;
  await withLmsApp({ scenario: "quiz", script: (school) => singleAssignmentScript(school, [work]) }, async ({ app, page, school }) => {
    await completeOnboarding(page, school.url, "Do it, I'll submit");
    await startAssignment(page, "Stacks, queues, and complexity quiz");
    if (capture) {
      const screenshots = join(projectRoot, "docs/reports/screenshots");
      await mkdir(screenshots, { recursive: true });
      await waitForPublicState(page, "getLifecycleState", state => state.execution?.actions?.some(action => action.label?.startsWith("Opened Save draft")));
      await page.getByRole("button", { name: "Watch", exact: true }).click();
      await page.waitForTimeout(350);
      await captureNativeWindow(app, join(screenshots, "checkpoint-04-activity-native.png"));
    }
    await waitForPublicState(page, "getLifecycleState", (state) => state.execution?.phase === "ready_review");
    if (capture) {
      await page.getByRole("region", { name: "Inky’s doubts" }).waitFor({ state: "visible" });
      await page.waitForTimeout(1_000);
      await page.locator(".rd-work-side-scroll").evaluate(node => { node.scrollTop = 0; });
      await page.waitForTimeout(150);
      await captureNativeWindow(app, join(projectRoot, "docs/reports/screenshots/checkpoint-04-review-native.png"));
    }
    assert.equal(committedSubmissions(school).length, 0, "attempt-only permission must not submit");

    const schoolTab = schoolPage(app, school.url);
    await schoolTab.reload();
    await schoolTab.getByRole("button", { name: "Submit assignment" }).click();
    assert.equal(committedSubmissions(school).length, 1, JSON.stringify({ effects: school.inspect().effects, page: (await schoolTab.locator("body").innerText()).slice(0, 2500) }));
    await page.getByLabel("Words shown after submission").fill("Submission received");
    await page.getByRole("button", { name: "I submitted it — check" }).click();
    let lifecycle;
    try { lifecycle = await waitForPublicState(page, "getLifecycleState", (state) => state.execution?.phase === "submitted"); }
    catch (error) { throw new Error(`Student verification did not complete: ${JSON.stringify({ appError: (await page.locator("body").innerText()).match(/Error invoking[^\n]*/), schoolHasReceipt: (await schoolTab.locator("body").innerText()).includes("Submission received"), url: schoolTab.url(), pages: app.context().pages().map(tab => tab.url().startsWith("data:") ? "data: overlay" : tab.url()), browserUrl: (await publicState(page, "getWorkspaceState")).browser.url })}`, { cause: error }); }
    assert.ok(lifecycle.submissionReceipt);
    await page.getByText(/Submission received|Checked on the page/).first().waitFor({ state: "visible" });
  });
});

test("J2: auto-submit commits exactly once when the review window ends", async (t) => {
  if (!(await requireCheckpoint4Hooks(t, ["STUDI_E2E_RUNTIME_MODULE", "STUDI_E2E_HOMEWORK_ROOT", "STUDI_E2E_REVIEW_WINDOW_MS"]))) return;
  const submit = { op: "submitByName", name: "Submit assignment", expectedConfirmationText: "Submission received" };
  await withLmsApp({ scenario: "quiz", reviewWindowMs: 150, script: (school) => singleAssignmentScript(school, [quizWork, [submit]]) }, async ({ page, school }) => {
    await completeOnboarding(page, school.url, "Do it and submit");
    await startAssignment(page, "Stacks, queues, and complexity quiz");
    const lifecycle = await waitForPublicState(page, "getLifecycleState", (state) => state.execution?.phase === "submitted", 10_000);
    assert.ok(lifecycle.submissionReceipt);
    assert.equal(committedSubmissions(school).length, 1);
  });
});

test("J2: takeover pauses a working assignment and Stop this releases it", async (t) => {
  if (!(await requireCheckpoint4Hooks(t, ["STUDI_E2E_RUNTIME_MODULE", "STUDI_E2E_HOMEWORK_ROOT"]))) return;
  const pausedWork = [{ op: "waitForAbort" }];
  await withLmsApp({ scenario: "quiz", script: (school) => singleAssignmentScript(school, [pausedWork, pausedWork]) }, async ({ page, school }) => {
    await completeOnboarding(page, school.url, "Do it, I'll submit");
    await startAssignment(page, "Stacks, queues, and complexity quiz");
    const working = await publicState(page, "getLifecycleState");
    await publicState(page, "requestAssignmentTakeover", { taskId: working.execution.taskId });
    await waitForPublicState(page, "getLifecycleState", (state) => state.execution?.phase === "needs_user");
    await page.getByRole("button", { name: "Stop this assignment" }).click();
    await waitForPublicState(page, "getLifecycleState", (state) => state.manager?.lease === null);
    assert.equal(committedSubmissions(school).length, 0);
  });
});

test("J2: Stop from the composer cancels a working assignment without submitting", async (t) => {
  if (!(await requireCheckpoint4Hooks(t, ["STUDI_E2E_RUNTIME_MODULE", "STUDI_E2E_HOMEWORK_ROOT"]))) return;
  await withLmsApp({ scenario: "quiz", script: (school) => singleAssignmentScript(school, [[{ op: "waitForAbort" }]]) }, async ({ page, school }) => {
    await completeOnboarding(page, school.url, "Do it, I'll submit");
    await startAssignment(page, "Stacks, queues, and complexity quiz");
    await page.getByRole("button", { name: "Stop assignment", exact: true }).click();
    await waitForPublicState(page, "getLifecycleState", state => state.manager?.lease === null);
    assert.equal(committedSubmissions(school).length, 0);
  });
});

async function startAssignment(page, title) {
  try { await page.getByText(title, { exact: true }).first().click({ timeout: 8_000 }); }
  catch (error) { throw new Error(`Assignment absent from visible work: ${(await page.locator("body").innerText()).slice(0, 2200)}`, { cause: error }); }
  const start = page.getByRole("button", { name: /Check and start|Start|Make Inky do this/ }).first();
  try {
    await start.waitFor({ state: "visible", timeout: 8_000 });
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => /^(Check and start|Start|Make Inky do this)/.test(button.textContent?.trim() ?? "") && !button.disabled), undefined, { timeout: 8_000 });
  } catch (error) {
    const onboarding = await publicState(page, "getSchoolOnboardingState");
    const library = await publicState(page, "getLibraryState");
    throw new Error(`Start remained disabled: ${JSON.stringify({ scan: onboarding.scan?.state, failures: onboarding.scan?.failures, tasks: library.tasks?.map(item => ({ assignment: item.assignment, task: item.task })), lifecycle: await publicState(page, "getLifecycleState"), text: (await page.locator("body").innerText()).slice(0, 2500) })}`, { cause: error });
  }
  await start.click();
  await waitForPublicState(page, "getLifecycleState", (state) => state.execution?.phase === "working" || state.execution?.phase === "ready_review");
}

async function captureNativeWindow(app, path) {
  const dataUrl = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
    const window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().startsWith("file:"));
    if (!window) throw new Error("The Studi window is unavailable");
    for (let attempt = 0; attempt < 5; attempt++) {
      const source = (await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 1120, height: 760 } }))
        .find(candidate => candidate.id === window.getMediaSourceId());
      if (source) return source.thumbnail.toDataURL();
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error("The Studi window was not captured by Windows");
  });
  await writeFile(path, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
}
