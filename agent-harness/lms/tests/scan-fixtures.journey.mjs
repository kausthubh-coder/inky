import assert from "node:assert/strict";

// Caller supplies a Playwright page and an isolated startLms() fixture. No login
// to real schools or dependency on a globally installed browser runner.
export async function verifyScanFixture(page, school, screenshot = async () => {}) {
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on("pageerror", onError);
  try {
    await page.goto(school.url);
    await page.getByRole("heading", { name: "Dashboard", exact: true }).waitFor();
    await page.getByRole("link", { name: "Exercise 05", exact: true }).waitFor();
    if (school.inspect().state.presentation.connectorApis) {
      const old = await page.locator("#timeline").elementHandle();
      await page.getByRole("button", { name: "Show more", exact: true }).click();
      assert.equal(await old.evaluate(element => element.isConnected), false, "Show more replaces the old nodes");
    }
    await screenshot("dashboard");
    await page.getByRole("button", { name: "Course index" }).click();
    await page.locator("#drawer").getByRole("link", { name: "CS 230 Programming in C" }).click();
    if (school.scenarioId === "moodle-noisy") {
      await screenshot("course");
      await page.locator("details:not([open]) > summary").evaluateAll(elements => elements.forEach(element => element.click()));
      assert.equal(await page.locator("tr.activity").count(), 130);
      await page.getByRole("link", { name: "Concept quiz", exact: true }).click();
      await page.frameLocator("iframe").getByText("Two attempts.", { exact: false }).waitFor();
      await screenshot("quiz");
      await page.goto(school.url + "/mod/lti/view.php?id=webassign-1");
      await page.getByRole("button", { name: "Open WebAssign", exact: true }).click();
      await page.getByRole("heading", { name: "WebAssign problem set 1", exact: true }).waitFor();
      assert.equal(new URL(page.url()).origin, school.origins.statistics);
      await screenshot("webassign");
      school.advance("expire-session");
      await page.goto(school.url);
      await page.getByRole("heading", { name: "Dashboard", exact: true }).waitFor();
    }
    assert.deepEqual(errors, []);
    return { scenarioId: school.scenarioId, pageErrors: errors };
  } finally {
    page.off("pageerror", onError);
  }
}
