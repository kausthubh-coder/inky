import assert from "node:assert/strict";
import { join } from "node:path";

// Real renderer geometry with simulated native caption insets; native layers
// still require Electron verification. Check controls, not only document width.
export async function verifyDesktopLayouts(page, base, evidenceDirectory) {
  const observations = [];
  for (const width of [1120, 800]) {
    await page.setViewportSize({ width, height: 760 });
    for (const [route, header] of [
      ["today", ".app-chrome"],
      ["learn", ".app-chrome"],
      ["chat-handoff", ".conversation-header"],
      ["tutor-choice", ".rd-tutor-heading"],
      ["desk-review", ".rd-work-heading"],
    ]) {
      await page.goto(`${base}/?preview=${route}&desktop=win32`);
      await page.locator(header).waitFor();
      const failures = await page.locator(header).evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const controls = Array.from(element.querySelectorAll("button"))
          .filter(button => button.getClientRects().length)
          .map(button => ({ label: button.getAttribute("aria-label") ?? button.innerText, rect: button.getBoundingClientRect() }));
        const failures = [];
        for (const { label, rect } of controls) {
          if (rect.left < 0 || rect.right > innerWidth - 138 || rect.top < bounds.top || rect.bottom > bounds.bottom + 1) failures.push(`Clipped control: ${label}`);
        }
        for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
          const a = controls[i], b = controls[j];
          if (Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left) > 1 && Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top) > 1) failures.push(`Overlapping controls: ${a.label} / ${b.label}`);
        }
        return failures;
      });
      assert.deepEqual(failures, [], `${route} at ${width}px`);
      if (route === "chat-handoff") {
        assert.equal(await page.getByRole("region", { name: "School check report" }).isVisible(), true);
        await page.getByRole("button", { name: "Open sign-in", exact: true }).click();
        await page.locator(".chat-browser").getByRole("button", { name: "Continue scan" }).waitFor();
        assert.equal(await page.locator(".scan-result-copy").evaluate(el => el.clientWidth >= 160), true);
      }
      if (evidenceDirectory) await page.screenshot({ path: join(evidenceDirectory, `desktop-${width}-${route}.png`) });
      observations.push(`${route}: visible nonoverlapping controls at ${width}px`);
    }
  }
  await page.goto(`${base}/?preview=settings-folder`);
  await page.locator("#settings-folder").waitFor();
  assert.equal(await page.locator("#settings-folder").evaluate(el => {
    const rect = el.getBoundingClientRect(); return rect.top >= 0 && rect.top < innerHeight / 2;
  }), true, "Settings preview should land on its named section");
  for (const route of ["updates-ready", "updates-mac", "updates-error"]) {
    await page.goto(`${base}/?preview=${route}`);
    await page.getByRole("button", { name: "Close updates", exact: true }).waitFor();
    await page.getByRole("button", { name: "Close updates", exact: true }).click();
    assert.equal(await page.locator("dialog[open]").count(), 0);
  }
  observations.push("Settings and updater previews open the named state");
  return observations;
}
