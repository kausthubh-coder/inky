import assert from "node:assert/strict";

// Controlled fixtures exercise the real React screen; no school or model calls.
export async function verifySchoolCheck(page, base = "http://127.0.0.1:4175") {
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto(`${base}/preview.html?preview=chat-handoff`);
  await page.getByRole("button", { name: "Sign in to WebAssign", exact: true }).waitFor();
  assert.equal(await page.locator(".scan-report .character").count(), 1);
  assert.equal(await page.getByRole("heading", { name: "Signed in", exact: true }).count(), 1);
  assert.equal(await page.locator(".scan-report").getByText("WebAssign needs you to sign in before I can keep checking.", { exact: true }).count(), 1);
  await page.getByRole("button", { name: "Sign in to WebAssign", exact: true }).click();
  await page.locator(".chat-browser").getByRole("button", { name: "Continue scan" }).waitFor();
  await page.getByRole("button", { name: "Close browser" }).click();

  const setScan = async (state, options = {}) => {
    await page.evaluate(async ({ state, options }) => {
      const current = await window.studi.getSchoolOnboardingState();
      const scan = current.scan;
      Object.assign(scan, {
        state,
        handoff: options.handoff ? { kind: "linked_system_sign_in", linkedSystemId: "preview-webassign", reason: "WebAssign needs you to sign in before I can keep checking.", requestedAt: scan.startedAt, evidence: current.courses[0].evidence } : null,
        failures: options.failures ?? [],
        currentStep: options.currentStep ?? "Checking CSC 316",
        completedAt: ["running", "needs_user"].includes(state) ? undefined : scan.startedAt,
      });
      scan.inventories = options.inventories === false ? [] : [
        { kind: "courses", state: "complete", itemIds: current.courses.map(course => course.courseId), evidence: current.courses[0].evidence },
        { kind: "assignments", state: "complete", courseId: current.courses[0].courseId, itemIds: current.assignments.map(item => item.assignmentId), evidence: current.courses[0].evidence },
      ];
      scan.observedCourseIds = current.courses.map(course => course.courseId);
      scan.observedAssignmentIds = current.assignments.map(item => item.assignmentId);
      scan.observedLinkedSystemIds = ["preview-gradescope"];
      scan.changes = [
        { assignmentId: current.assignments[0].assignmentId, kind: "new", fields: [] },
        { assignmentId: current.assignments[1].assignmentId, kind: "updated", fields: ["dueAt"], dueChange: { before: { dueAt: "2026-09-12T23:59:00.000Z" }, after: { dueAt: "2026-09-16T23:59:00.000Z" } } },
      ];
      scan.messages = [{ messageId: "journey-note", role: "assistant", text: "Unreleased future work stays in scan details.", createdAt: scan.startedAt }];
      current.linkedSystems = [
        { schemaVersion: 1, linkedSystemId: "preview-webassign", label: "WebAssign", sourceTarget: "https://webassign.example.edu", state: options.handoff ? "needs_user" : "verified", lastObservedScanId: scan.scanId, ...(options.handoff ? {} : { lastVerifiedScanId: scan.scanId }), lastObservedAt: scan.startedAt, evidence: current.courses[0].evidence },
        { schemaVersion: 1, linkedSystemId: "preview-gradescope", label: "Gradescope", sourceTarget: "https://gradescope.example.edu", state: "verified", lastObservedScanId: scan.scanId, lastVerifiedScanId: scan.scanId, lastObservedAt: scan.startedAt, evidence: current.courses[0].evidence },
      ];
      // Return a fresh snapshot like IPC does so the normal app polling rerenders.
      window.studi.getSchoolOnboardingState = async () => structuredClone(current);
    }, { state, options });
  };

  await setScan("succeeded");
  await page.getByRole("heading", { name: "Here’s what I found." }).waitFor();
  assert.equal(await page.locator(".inky-composer").count(), 0);
  assert.match(await page.locator(".scan-change-date").last().innerText(), /Sep 12.*→.*Sep 16/);
  assert.equal(await page.getByText("1 of 3 classes checked", { exact: true }).count(), 1);
  await page.locator(".scan-report").getByRole("button", { name: "Scan details", exact: true }).click();
  await page.getByRole("heading", { name: "Latest scan details" }).waitFor();
  assert.equal(await page.locator(".scan-details-page details").count(), 0);
  assert.equal(await page.getByText("Unreleased future work stays in scan details.").count(), 1);
  assert.equal(await page.getByRole("heading", { name: "Latest scan details" }).evaluate(node => node === document.activeElement), true);
  await page.getByRole("button", { name: "Scan result", exact: true }).click();
  assert.equal(await page.locator(".scan-report").getByRole("button", { name: "Scan details", exact: true }).evaluate(node => node === document.activeElement), true);

  await page.setViewportSize({ width: 800, height: 650 });
  assert.equal(await page.locator(".scan-report").evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  await setScan("running", { inventories: false, currentStep: "Reading ST 370 Probability & Statistics", failures: ["MA 241 calendar could not be opened."] });
  await page.getByRole("heading", { name: "Checking your classes.", exact: true }).waitFor();
  assert.equal(await page.getByText("ST 370 Probability & Statistics", { exact: true }).count(), 1);
  assert.equal(await page.getByText("3 due, 1 new", { exact: true }).count(), 1);
  assert.equal(await page.getByText("reading the course page", { exact: true }).count(), 1);
  assert.equal(await page.getByText("MA 241 calendar could not be opened.", { exact: true }).count(), 1);
  await page.getByRole("button", { name: "Finish with what you found", exact: true }).waitFor();
  assert.equal(await page.locator(".inky-composer").count(), 1);
  await setScan("needs_user", { handoff: true });
  await page.getByRole("button", { name: "Sign in to WebAssign", exact: true }).waitFor();
  await setScan("failed", { failures: ["The school connection timed out."] });
  await page.getByRole("button", { name: "Restart scan" }).waitFor();
  assert.equal(await page.locator(".scan-report").getByText("The school connection timed out.", { exact: true }).count(), 1);
  assert.equal(await page.locator(".inky-composer").count(), 0);
  await setScan("succeeded");
  await page.getByRole("button", { name: "Scan again", exact: true }).waitFor();
  await page.locator(".scan-change").first().click();
  await page.getByRole("button", { name: "Back to your week", exact: true }).waitFor();
  assert.equal(await page.locator(".ag-head h1").innerText(), "IBM Sorting Machine");
  return "Scan sign-in toolbar, result, details/focus, deadline change, narrow window, discovery, pause, failure and assignment navigation passed.";
}
