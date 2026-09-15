import assert from "node:assert/strict";

const reply = "Please **sign in** to continue.\n\n- Open your school page.\n- Use [School help](https://example.com/help).\n\nUse `student@example.com` when prompted.";

// Synthetic messages through actual preview components; no live scan or provider request.
export async function verifyMarkdownSurfaces(page, base, evidenceDirectory) {
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on("pageerror", onError);
  const open = async id => {
    await page.goto(`${base}/?preview=${id}`);
    await page.waitForSelector("[data-studi-app-ready]");
  };
  const seedScan = async () => page.evaluate(async text => {
    const state = await window.studi.getSchoolOnboardingState();
    window.studi.getSchoolOnboardingState = async () => ({ ...state, scan: {
      ...state.scan, currentStep: text, failures: [text],
      handoff: state.scan.handoff ? { ...state.scan.handoff, reason: text } : null,
      messages: [
        { messageId: "markdown-user", role: "user", text: "Keep **this** as typed.", createdAt: "2026-09-14T12:00:00Z" },
        { messageId: "markdown-inky", role: "assistant", text, createdAt: "2026-09-14T12:00:01Z" },
      ],
    } });
  }, reply);
  const check = async locator => {
    await locator.locator("strong").getByText("sign in", { exact: true }).waitFor();
    assert.equal(await locator.locator("ul > li").count(), 2);
    assert.equal(await locator.getByRole("link", { name: "School help" }).getAttribute("href"), "https://example.com/help");
    assert.equal(await locator.locator("code").innerText(), "student@example.com");
    assert.equal(await locator.locator("p").first().evaluate(p => getComputedStyle(p).display), "block");
    assert.equal(await locator.evaluate(el => el.scrollWidth > el.clientWidth), false);
  };
  const capture = async name => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (evidenceDirectory) await page.screenshot({ path: `${evidenceDirectory}/${name}.png` });
  };
  try {
    for (const width of [1440, 720]) {
      await page.setViewportSize({ width, height: width === 1440 ? 950 : 720 });
      await open("chat-handoff");
      await seedScan();
      await check(page.locator(".scan-result-copy > .chat-markdown"));
      await page.getByRole("button", { name: "Scan details", exact: true }).click();
      await check(page.locator(".scan-detail-note > .chat-markdown"));
      await check(page.locator(".scan-activity-entry .chat-markdown").first());
      assert.equal(await page.locator(".scan-student-message").innerText(), "Keep **this** as typed.");
      await capture(`scan-markdown-${width}`);
      await page.getByRole("button", { name: "Scan result", exact: true }).click();
      await check(page.locator(".scan-result-copy > .chat-markdown"));
      await page.getByRole("button", { name: "Close school check", exact: true }).click();
      await check(page.locator(".scan-status__copy > .chat-markdown"));

      await open("onboarding-handoff");
      await seedScan();
      await check(page.locator(".fable-speech > .chat-markdown").last());
      await page.locator(".fable-speech > .chat-markdown").last().scrollIntoViewIfNeeded();
      await capture(`onboarding-markdown-${width}`);

      await open("onboarding-scan");
      await seedScan();
      await check(page.locator(".fable-scan-progress > .chat-markdown"));

      await open("desk-needs-user");
      await page.evaluate(async text => {
        const state = await window.studi.getLifecycleState();
        window.studi.getLifecycleState = async () => ({ ...state, execution: { ...state.execution, lastError: text } });
      }, reply);
      await check(page.locator("#assignment-action-note > .chat-markdown"));
      await capture(`assignment-handoff-markdown-${width}`);
    }

    await open("week");
    await page.evaluate(async text => {
      const fixture = await import("/.agents/skills/test-studi/journeys/markdown-drawer-fixture.tsx");
      await fixture.mountMarkdownDrawer(text);
    }, reply);
    await check(page.locator(".drawer-bubble--inky > .chat-markdown"));
    assert.equal(await page.locator(".drawer-bubble--you").innerText(), "Keep **this** as typed.");
    await capture("legacy-drawer-markdown-720");
    assert.deepEqual(errors, []);
    return { passed: ["school results, notes, conversation, and dashboard scan banner", "onboarding handoff and progress", "assignment handoff", "legacy drawer component", "literal student messages", "desktop and narrow layouts"], errors };
  } finally {
    page.off("pageerror", onError);
  }
}
