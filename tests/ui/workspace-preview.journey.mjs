// Run with the official Playwright MCP against the local UI preview.
import assert from "node:assert/strict";

export async function verifyWorkspacePreview(page, base = "http://127.0.0.1:4174") {
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on("pageerror", onError);
  const open = async id => {
    await page.goto(`${base}/?preview=${id}`);
    await page.waitForSelector("[data-studi-app-ready]");
  };
  try {
    await page.setViewportSize({ width: 1280, height: 850 });
    await open("week");
    assert.equal(await page.getByText("Final project · reading notes", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "Next week", exact: true }).click();
    const nextWeek = await page.locator(".week-range").innerText();
    await page.getByRole("button", { name: /Without dates/ }).click();
    assert.equal(await page.locator(".week-grid").count(), 0);
    assert.equal(await page.getByText("Final project · reading notes", { exact: true }).count(), 1);
    await page.getByRole("button", { name: "Your week", exact: true }).click();
    assert.equal(await page.locator(".week-range").innerText(), nextWeek);
    await page.getByRole("button", { name: /Without dates/ }).click();
    await page.getByRole("button", { name: /Final project · reading notes/ }).click();
    assert.equal(await page.locator(".chat-view-expanded").count(), 1);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const search = page.getByRole("searchbox", { name: "Search settings" });
    await search.fill("sound");
    assert.equal(await page.getByRole("heading", { name: "Search results", exact: true }).count(), 1);
    assert.equal(await page.locator(".notification-rows").count(), 1);
    await search.fill("zzzzno-setting");
    assert.equal(await page.getByRole("heading", { name: "No settings found.", exact: true }).count(), 1);
    await page.getByRole("button", { name: "Clear search", exact: true }).first().click();
    await page.getByRole("button", { name: "Review & memory", exact: true }).click();
    await page.getByLabel("Minutes to look over answers", { exact: true }).fill("23");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    assert.equal(await page.evaluate(async () => (await window.studi.getProductSettings()).preferences.reviewMinutes), 23);
    await page.getByRole("button", { name: /Account for/ }).click();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("menu", { name: "Profile menu" }).count(), 0);
    const sections = ["inky", "preferences", "apps", "folder", "school", "rules", "notifications", "privacy", "usage", "support", "account"];
    for (const size of [{ width: 1280, height: 850 }, { width: 1024, height: 768 }, { width: 720, height: 520 }]) {
      await page.setViewportSize(size);
      for (const id of ["week-undated", ...sections.map(id => `settings-${id}`)]) {
        await open(id);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${id} horizontal overflow at ${size.width}`);
        if (id.startsWith("settings-")) assert.ok(await page.locator(".settings-content .paper-card").count() > 0, `${id} has no controls`);
      }
    }
    await page.goto(`${base}/?preview=gallery`);
    await page.waitForSelector("[data-studi-preview-gallery]");
    assert.equal(await page.locator('a[href="/?preview=week-undated"]').count(), 2);
    assert.equal(await page.locator('a[href="/?preview=settings-notifications"]').count(), 2);
    assert.deepEqual(errors, []);
    return { passed: ["undated separation, navigation retention, assignment opens", "settings search, empty results, save, account Escape", "all 11 settings sections at three window sizes", "preview gallery routes"], pageErrors: errors };
  } finally {
    page.off("pageerror", onError);
  }
}
