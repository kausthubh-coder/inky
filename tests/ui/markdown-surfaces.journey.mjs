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
    await locator.locator("strong").getByText("sign in", { exact: true }).waitFor({ timeout: 15_000 });
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
      // The result header now uses fixed sign-in copy. Rich scan notes live in details.
      await page.getByRole("heading", { name: "School sign-in signed you out", exact: true }).waitFor();
      await page.getByRole("button", { name: "Scan details", exact: true }).click();
      await check(page.locator(".scan-detail-note > .chat-markdown"));
      await check(page.locator(".scan-activity-entry .chat-markdown").first());
      assert.equal(await page.locator(".scan-student-message").innerText(), "Keep **this** as typed.");
      await capture(`scan-markdown-${width}`);
      await page.getByRole("button", { name: "Scan result", exact: true }).click();
      await page.getByRole("button", { name: "I've signed in", exact: true }).waitFor();
      await page.getByRole("button", { name: "Close school check", exact: true }).click();
      // The dashboard redesign replaced the Markdown scan banner with a short status.
      await page.getByRole("heading", { name: "Your school needs you to sign in.", exact: true }).waitFor();

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
        window.studi.getLifecycleState = async () => ({ ...state,
          execution: { ...state.execution, returnPredicate: text, lastError: text },
        });
      }, reply);
      // The dock has a plain action prompt; Dot's full handoff is Markdown in the thread.
      await check(page.locator(".ag-thread .chat-markdown").filter({ hasText: "School help" }));
      await capture(`assignment-handoff-markdown-${width}`);
    }

    assert.deepEqual(errors, []);
    return { passed: ["school notes and conversation", "onboarding handoff and progress", "assignment handoff thread", "literal student messages", "desktop and narrow layouts"], errors };
  } finally {
    page.off("pageerror", onError);
  }
}
