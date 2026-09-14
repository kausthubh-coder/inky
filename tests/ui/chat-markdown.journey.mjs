// Run through the official Playwright MCP against `bun run preview:ui`.
import assert from "node:assert/strict";

export async function verifyChatMarkdown(page, base = "http://127.0.0.1:4174") {
  const errors = [];
  const onError = (e) => errors.push(e.message);
  page.on("pageerror", onError);
  try {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto(`${base}/?preview=chat-markdown`);
    await page.waitForSelector("[data-studi-app-ready]");
    const log = page.getByRole("log", { name: "Messages" });
    await log.waitFor();
    assert.equal(await log.locator("strong").filter({ hasText: "IBM Sorting Machine" }).count(), 1);
    assert.equal(await log.getByRole("list").count(), 1);
    assert.equal(await log.locator("ol li").count(), 3);
    assert.equal(await log.locator("code").filter({ hasText: "O(n · k)" }).count(), 1);
    assert.equal(await log.locator("pre").count(), 1);
    const link = log.getByRole("link", { name: "school page" });
    assert.equal(await link.count(), 1);
    assert.equal(await link.getAttribute("href"), "https://school.example.edu/courses/csc316/assignment-sort");
    const raw = await log.innerText();
    assert.equal(raw.includes("**IBM"), false);
    assert.equal(raw.includes("```"), false);
    await page.setViewportSize({ width: 720, height: 520 });
    await page.goto(`${base}/?preview=chat-expanded`);
    await page.waitForSelector("[data-studi-app-ready]");
    assert.match(await page.getByRole("log", { name: "Messages" }).innerText(), /Hey! What would you like to work on today\?/);
    await page.goto(`${base}/?preview=assignment`);
    await page.waitForSelector("[data-studi-app-ready]");
    const assignmentChat = page.getByRole("log", { name: "Messages" });
    assert.equal(await assignmentChat.locator("strong").filter({ hasText: "trace the IBM sort" }).count(), 1);
    assert.equal(await assignmentChat.locator("ol li").count(), 3);
    assert.deepEqual(errors, []);
    return { passed: ["markdown chat", "plain greeting still speech", "assignment sidebar markdown"], pageErrors: errors };
  } finally {
    page.off("pageerror", onError);
  }
}
