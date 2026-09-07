import assert from "node:assert/strict";

// Run through the official Playwright MCP against the isolated preview fixture.
export async function verifyChatHandoff(page, base = "http://127.0.0.1:4177") {
  await page.goto(`${base}/?preview=chat-handoff`);
  await page.waitForSelector("[data-studi-app-ready]");
  await page.evaluate(() => {
    const api = window.studi;
    const resume = api.resumeSchoolScan;
    window.handoffCalls = [];
    api.resumeSchoolScan = async () => {
      window.handoffCalls.push("resume");
      await new Promise(resolve => setTimeout(resolve, 800));
      return resume();
    };
    api.replaySchoolScan = api.startSchoolScan = async () => {
      window.handoffCalls.push("new_scan");
      throw new Error("A paused scan still owns the browser");
    };
  });

  await page.getByRole("textbox", { name: "Message Inky" }).fill("I'm signed in now");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText("I'm signed in now", { exact: true }).waitFor();
  assert.deepEqual((await page.locator(".student-bubble").innerText()).split(/\n+/), ["You", "I'm signed in now"]);
  assert.equal(await page.locator(".student-bubble .chat-refs").count(), 0);
  assert.deepEqual(await page.locator(".conversation-log > *").evaluateAll(elements => elements.map(element =>
    element.classList.contains("chat-task-card") ? "card" : element.classList.contains("student-bubble") ? "user" : "inky"
  )), ["inky", "card", "user", "inky"]);

  await page.getByRole("button", { name: "I’m done — check", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Checking…", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "I’m done — check", exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.handoffCalls), ["resume"]);
  assert.equal(await page.getByRole("alert").count(), 0);
  return { emptyReferencesHidden: true, cardBeforeReplies: true, resumedOnce: true, busyButtonDisabled: true };
}
