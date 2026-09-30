import assert from "node:assert/strict";
import test from "node:test";

import { completeOnboarding, publicState, requireCheckpoint4Hooks, singleAssignmentScript, withLmsApp } from "./harness.mjs";

// The fake school keeps its sign-in in a session cookie, which Chromium drops when the app quits.
// Studi saves it and puts it back, so after a restart the school still knows the student.
test("J4: the school sign-in survives quitting and reopening Studi", async (t) => {
  if (!(await requireCheckpoint4Hooks(t, ["STUDI_E2E_RUNTIME_MODULE", "STUDI_E2E_HOMEWORK_ROOT"]))) return;
  await withLmsApp({ scenario: "quiz", sessionCookies: true, script: (school) => singleAssignmentScript(school, []) }, async ({ page, school, restart }) => {
    await completeOnboarding(page, school.url);
    assert.equal(school.inspect().state.sessions.school, true);
    page = await restart();
    await publicState(page, "selectBrowserPage", { kind: "school" });
    await publicState(page, "navigateBrowser", { url: `${school.url}/`, target: { kind: "school" } });
    await page.waitForTimeout(1_500);
    assert.equal(school.inspect().state.sessions.school, true, "the school still sees the student signed in after the restart");
  });
});
