import assert from "node:assert/strict";

// Controlled fixtures exercise the real React screen; no school or model calls.
export async function verifySchoolCheck(page, base = "http://127.0.0.1:4175") {
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto(`${base}/preview.html?preview=chat-handoff`);
  await page.getByRole("button", { name: "Open sign-in", exact: true }).waitFor();
  await page.getByRole("button", { name: "Open sign-in", exact: true }).click();
  await page.locator(".chat-browser").getByRole("button", { name: "Continue scan" }).waitFor();
  await page.getByRole("button", { name: "Close browser" }).click();

  const setScan = async (state, inventories = true) => {
    await page.evaluate(async ({ state, inventories }) => {
      const current = await window.studi.getSchoolOnboardingState();
      const scan = current.scan;
      Object.assign(scan, { state, handoff: null, failures: [], currentStep: "Checking CSC 316", completedAt: state === "running" ? undefined : scan.startedAt });
      scan.inventories = inventories ? [
        { kind: "courses", state: "complete", itemIds: current.courses.map(course => course.courseId), evidence: current.courses[0].evidence },
        { kind: "assignments", state: "complete", courseId: current.courses[0].courseId, itemIds: current.assignments.map(item => item.assignmentId), evidence: current.courses[0].evidence },
      ] : [];
      scan.changes = [
        { assignmentId: current.assignments[0].assignmentId, kind: "new", fields: [] },
        { assignmentId: current.assignments[1].assignmentId, kind: "updated", fields: ["dueAt"], dueChange: { before: { dueAt: "2026-09-12T23:59:00.000Z" }, after: { dueAt: "2026-09-16T23:59:00.000Z" } } },
      ];
      scan.messages = [{ messageId: "journey-note", role: "assistant", text: "Unreleased future work stays in scan details.", createdAt: scan.startedAt }];
      // Return a fresh snapshot like IPC does so the normal app polling rerenders.
      window.studi.getSchoolOnboardingState = async () => structuredClone(current);
    }, { state, inventories });
  };

  await setScan("succeeded");
  await page.getByRole("heading", { name: "Here’s what I found." }).waitFor();
  assert.equal(await page.locator(".inky-composer").count(), 0);
  assert.match(await page.locator(".scan-change-date").last().innerText(), /Sep 12.*→.*Sep 16/);
  assert.equal(await page.getByText("1 of 1 classes checked", { exact: true }).count(), 1);
  await page.getByRole("button", { name: "Scan details", exact: true }).click();
  await page.getByRole("heading", { name: "Latest scan details" }).waitFor();
  assert.equal(await page.locator(".scan-details-page details").count(), 0);
  assert.equal(await page.getByText("Unreleased future work stays in scan details.").count(), 1);
  assert.equal(await page.getByRole("heading", { name: "Latest scan details" }).evaluate(node => node === document.activeElement), true);
  await page.getByRole("button", { name: "Scan result", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Scan details", exact: true }).evaluate(node => node === document.activeElement), true);

  await page.setViewportSize({ width: 800, height: 650 });
  assert.equal(await page.locator(".scan-report").evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  await setScan("running", false);
  await page.getByText("Finding your classes", { exact: true }).waitFor();
  assert.equal(await page.locator(".scan-count").count(), 0);
  assert.equal(await page.locator(".inky-composer").count(), 1);
  await setScan("needs_user");
  await page.locator(".scan-hero-action").getByRole("button", { name: "Continue scan" }).waitFor();
  await setScan("failed");
  await page.getByRole("button", { name: "Restart scan" }).waitFor();
  assert.equal(await page.locator(".inky-composer").count(), 0);
  await setScan("succeeded");
  await page.getByRole("button", { name: "Scan again", exact: true }).waitFor();
  await page.locator(".scan-change").first().click();
  await page.getByRole("button", { name: "Close assignment", exact: true }).waitFor();
  return "Scan sign-in toolbar, result, details/focus, deadline change, narrow window, discovery, pause, failure and assignment navigation passed.";
}
