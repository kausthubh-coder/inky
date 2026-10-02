import assert from "node:assert/strict";

// Onboarding and the guided tour on the real screens, against preview fixtures. No school or model calls.
export async function verifyOnboardingAndTour(page, base = "http://127.0.0.1:4175") {
  await page.setViewportSize({ width: 1280, height: 800 });

  // The welcome shows how Studi works, and the student hands the work in themselves.
  await page.goto(`${base}/preview.html?preview=onboarding-welcome`);
  await page.getByRole("button", { name: "Show me", exact: true }).click();
  await page.getByText("Now you. Check it, then press Submit.").waitFor({ timeout: 10_000 });
  await page.locator(".ob-submit").click();
  await page.getByRole("button", { name: "Let's do it", exact: true }).waitFor({ timeout: 5_000 });

  // Dot lists homework and works when asked, by default.
  await page.goto(`${base}/preview.html?preview=onboarding-permission`);
  assert.match(await page.locator(".fable-pick.selected").innerText(), /Just tell me about it/);

  // The class link recognises the common sites and can be skipped.
  await page.goto(`${base}/preview.html?preview=onboarding-school`);
  await page.getByLabel("Class link").fill("canvas.example.edu");
  await page.getByText("Canvas.", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Skip", exact: true }).waitFor();

  // During the check the week fills on the right, and the tour can start without waiting.
  await page.goto(`${base}/preview.html?preview=onboarding-scan`);
  await page.getByRole("button", { name: "Your week", exact: true }).waitFor();
  assert.ok(await page.locator(".ob-day b").count() > 0, "found homework shows on the week");
  await page.getByRole("button", { name: "Show me around while I look", exact: true }).waitFor();

  // The tour: practice homework from open to handed in, then a practice lesson with Chalky.
  await page.goto(`${base}/preview.html?preview=onboarding-ready`);
  await page.getByRole("button", { name: "Show me around", exact: true }).click();
  const bubble = (title) => page.locator(".tour-bubble h2", { hasText: title }).waitFor({ timeout: 15_000 });
  await bubble("Let's try one together.");
  await page.locator(".hw-card", { hasText: "Practice: sort five numbers" }).first().click();
  await bubble("This is an assignment.");
  await page.getByRole("button", { name: /^Start( now)?$/ }).first().click();
  await bubble("I'm on it.");
  await bubble("Done. Your turn to check.");
  while (await page.getByRole("button", { name: "Looks fine", exact: true }).count()) await page.getByRole("button", { name: "Looks fine", exact: true }).first().click();
  await page.getByRole("button", { name: "Hand it in", exact: true }).click();
  await bubble("Handed in!");
  await page.locator(".tour-bubble").getByRole("button", { name: "Next" }).click();
  await bubble("Ask me anything here.");
  await page.locator(".tour-bubble").getByRole("button", { name: "Next" }).click();
  await bubble("Now meet Chalky.");
  await page.locator(".rd-mode-switch button", { hasText: "Learn" }).click();
  await bubble("Hi! I'm Chalky.");
  await page.locator(".lr-row", { hasText: "Practice quiz" }).click();
  await bubble("First, a quick check.");
  await page.locator(".lr-detail button.rd-button", { hasText: /^Start/ }).first().click();
  await bubble("Lessons are short.");
  await page.locator(".tu-opts button").first().click();
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await bubble("That's a lesson.");
  await page.locator(".tour-bubble").getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Let's go", exact: true }).click();

  // Afterwards the practice class is gone and the week is the student's own.
  await page.locator(".hw-hello").waitFor();
  assert.equal(await page.locator(".hw-card", { hasText: "Practice: sort five numbers" }).count(), 0);
  assert.equal(await page.locator(".tour-guide, .tour-finale").count(), 0);
}
