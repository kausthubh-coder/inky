// Actual React controls with the isolated preview API. No schoolwork runs.
import assert from "node:assert/strict";

export async function verifyAssignmentPreview(page, base) {
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on("pageerror", onError);
  const open = async id => {
    await page.goto(`${base}/?preview=${id}`);
    await page.locator("[data-studi-app-ready]").waitFor();
  };
  const button = name => page.getByRole("button", { name, exact: true });
  const status = text => page.locator(".assignment-meta [role=status]").filter({ hasText: text }).waitFor();
  const results = [];
  try {
    await page.setViewportSize({ width: 1440, height: 950 });
    await open("week");
    const card = page.getByRole("button", { name: /IBM Sorting Machine/ });
    const color = await card.evaluate(el => getComputedStyle(el, "::before").backgroundColor);
    await card.focus();
    await page.keyboard.press("Enter");
    await status("Not attempted");
    assert.equal(await page.locator(".assignment-course .course-dot").evaluate(el => getComputedStyle(el).backgroundColor), color);
    assert.match(await page.locator(".assignment-brief").innerText(), /radix sort/);
    assert.match(await page.locator(".assignment-due").innerText(), /Due/);
    await page.keyboard.press("Escape");
    assert.equal(await card.evaluate(el => el === document.activeElement), true);
    await card.click();
    await page.evaluate(() => {
      const start = window.studi.startAssignment;
      window.previewStartCount = 0;
      window.studi.startAssignment = async input => {
        window.previewStartCount++;
        await new Promise(resolve => { window.releasePreviewStart = resolve; });
        return start(input);
      };
    });
    await button("Start assignment").click();
    assert.equal(await button("Starting…").isDisabled(), true);
    await page.evaluate(() => window.releasePreviewStart());
    await button("Pause assignment").waitFor();
    assert.equal(await page.evaluate(() => window.previewStartCount), 1);
    await button("Pause assignment").click();
    await status("Paused");
    await button("Resume assignment").click();
    await status("Inky is working");
    await button("Stop work").click();
    await status("Stopped");
    assert.equal(await button("Try assignment again").isEnabled(), true);
    results.push("calendar color, instructions/date, keyboard open/close/focus, single start, pause/resume/stop");

    await open("assignment");
    await page.evaluate(() => {
      const start = window.studi.startAssignment;
      let fail = true;
      window.studi.startAssignment = async input => {
        if (fail) { fail = false; throw new Error("Preview: school connection unavailable. Try again."); }
        return start(input);
      };
    });
    await button("Start assignment").click();
    await page.getByRole("alert").filter({ hasText: "school connection unavailable" }).waitFor();
    assert.equal(await button("Start assignment").isEnabled(), true);
    await button("Start assignment").click();
    await status("Inky is working");
    assert.equal(await page.getByRole("alert").count(), 0);
    await open("assignment-failed");
    await status("Couldn’t finish");
    await button("Try assignment again").click();
    await status("Inky is working");
    await open("assignment-stopped");
    await status("Stopped");
    await open("assignment-restricted");
    assert.equal(await button("Start assignment").isDisabled(), true);
    await button("Homework rules").click();
    await page.getByRole("heading", { name: "What can I help with?", exact: true }).waitFor();
    results.push("failed start/retry, failed/stopped state, permission recovery");

    await open("desk-working");
    await button("Close assignment").click();
    await page.getByRole("button", { name: /HW 3/ }).click();
    assert.equal(await button("Start assignment").isDisabled(), true);
    await button("Go to current assignment").click();
    await button("Pause assignment").waitFor();
    await open("week-needs-user");
    await page.getByRole("button", { name: /IBM Sorting Machine/ }).click();
    assert.equal(await button("Start assignment").isDisabled(), true);
    await button("Open school check").click();
    await button("Close school check").waitFor();
    results.push("competing assignment and school check open their recovery action");

    await open("desk-review");
    await status("Ready for review");
    await button("Review assignment").click();
    await page.getByLabel("Words shown after submission").waitFor();
    assert.equal(await button("I submitted it — check").isDisabled(), true);
    await button("Review on school page ↗").click();
    await page.locator(".chat-browser").waitFor();
    assert.equal(await page.getByRole("textbox", { name: "Message Inky" }).isVisible(), true);
    await button("Close browser").click();
    await page.getByLabel("Words shown after submission").waitFor();
    await open("desk-submitted");
    await status("Submitted");
    assert.equal(await button("Start assignment").count(), 0);
    await open("assignment-saved");
    await status("Answers saved");
    assert.match(await page.locator(".assignment-summary").innerText(), /Submission hasn’t been confirmed/);
    await button("Review saved answers").click();
    await page.getByRole("article", { name: "Saved answer" }).waitFor();
    assert.match(await page.getByRole("article", { name: "Saved answer" }).innerText(), /Simulated saved answers/);
    results.push("review tab and school page keep Inky visible; saved and submitted remain distinct");

    await open("assignment");
    const draft = page.getByRole("textbox", { name: "Message Inky" });
    await draft.fill("Keep my question beside the file");
    await page.getByRole("tab", { name: /^Files/ }).click();
    await page.getByRole("button", { name: /answer.md/ }).click();
    await page.getByRole("article", { name: "File preview" }).waitFor();
    assert.equal(await draft.inputValue(), "Keep my question beside the file");
    await page.getByRole("tab", { name: "Assignment", exact: true }).focus();
    await page.keyboard.press("End");
    assert.equal(await page.getByRole("tab", { name: "Inky’s work" }).getAttribute("aria-selected"), "true");
    await page.keyboard.press("Home");
    assert.equal(await page.getByRole("tab", { name: "Assignment", exact: true }).getAttribute("aria-selected"), "true");
    await page.getByRole("tab", { name: /^Files/ }).click();
    await button("← All files").click();
    await page.evaluate(() => {
      window.studi.getAssignmentFiles = async () => [];
      let failed = false;
      window.studi.importAssignmentFiles = async () => {
        if (!failed) { failed = true; throw new Error("Preview: file could not be copied."); }
        const file = { path: "materials/notes.txt", kind: "file", size: 30, modifiedAt: new Date().toISOString() };
        window.studi.getAssignmentFiles = async () => [file];
        return { imported: [file.path], errors: [] };
      };
    });
    await page.getByRole("heading", { name: "A place for your materials." }).waitFor();
    await button("Choose files").click();
    await page.getByRole("alert").filter({ hasText: "could not be copied" }).waitFor();
    await button("Try again").click();
    await page.getByRole("button", { name: /notes.txt/ }).waitFor();
    assert.equal(await draft.inputValue(), "Keep my question beside the file");
    results.push("files, inline text preview, empty state, failed import/retry, retained draft, keyboard tabs");

    for (const size of [{ width: 1440, height: 950 }, { width: 1024, height: 768 }, { width: 720, height: 520 }]) {
      await page.setViewportSize(size);
      for (const id of ["assignment", "desk-needs-user", "assignment-failed", "assignment-restricted", "desk-review", "assignment-saved"]) {
        await open(id);
        await page.locator(".assignment-primary").waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${id}: overflow`);
        for (const selector of [".assignment-primary", ".inky-composer"]) {
          const rect = await page.locator(selector).boundingBox();
          assert.ok(rect && rect.y >= 0 && rect.y + rect.height <= size.height, `${id} ${selector}: clipped at ${size.width}`);
        }
      }
    }
    results.push("action and composer fit 1440×950, 1024×768, 720×520");
    assert.deepEqual(errors, []);
    return { passed: results, pageErrors: errors, evidence: "Controlled preview; no live agent or school submission" };
  } finally { page.off("pageerror", onError); }
}
