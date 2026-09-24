import { verifySettings } from "./settings.journey.mjs";
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
    assert.equal(await page.locator(".assignment-workspace").count(), 1);
    await page.getByRole("button", { name: "Close assignment", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await verifySettings(page, base);
    await page.getByRole("button", { name: /Account for/ }).click();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("menu", { name: "Profile menu" }).count(), 0);
    await open("desk-review");
    const autoSubmit = page.locator('time[datetime="2026-09-04T03:30:00.000Z"]');
    await autoSubmit.waitFor();
    assert.equal(await autoSubmit.innerText(), new Date("2026-09-04T03:30:00.000Z").toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    assert.match(await page.locator(".rd-auto-submit").innerText(), /rule: do it and submit/);
    await page.evaluate(async () => {
      const library = await window.studi.getLibraryState();
      const review = library.tasks.find(item => item.execution?.phase === "ready_review");
      review.execution.reviewDeadline = "2026-09-04T04:05:00.000Z";
    });
    await page.locator('time[datetime="2026-09-04T04:05:00.000Z"]').waitFor();
    assert.equal(await autoSubmit.count(), 0);
    const sections = ["inky", "homework", "school", "notifications", "you"];
    for (const size of [{ width: 1280, height: 850 }, { width: 1024, height: 768 }, { width: 720, height: 520 }]) {
      await page.setViewportSize(size);
      for (const id of ["week-undated", ...sections.map(id => `settings-${id}`)]) {
        await open(id);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${id} horizontal overflow at ${size.width}`);
        if (id.startsWith("settings-")) assert.ok(await page.locator(".st-content .st-group").count() > 0, `${id} has no controls`);
      }
    }
    await page.goto(`${base}/?preview=gallery`);
    await page.waitForSelector("[data-studi-preview-gallery]");
    assert.equal(await page.locator('a[href="/?preview=week-undated"]').count(), 2);
    assert.equal(await page.locator('a[href="/?preview=settings-notifications"]').count(), 2);
    assert.deepEqual(errors, []);
    return { passed: ["undated separation, navigation retention, assignment opens", "five Settings tabs, autosave and recovery", "review shows actual auto-submit time and rule", "all five settings tabs at three window sizes", "preview gallery routes"], pageErrors: errors };
  } finally {
    page.off("pageerror", onError);
  }
}
