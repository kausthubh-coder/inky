// Controlled actual React preview. It does not prove live provider or school behavior.
export async function verifyRedesign(page, base) {
  const results = [];
  const check = (value, message) => {
    if (!value) throw new Error(message);
  };
  const open = async (id) => {
    await page.goto(base + "/?preview=" + id);
    await page.locator("[data-studi-app-ready]").waitFor();
  };
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.setViewportSize({ width: 1440, height: 950 });
  await open("today-needs");
  await button("Open IBM Sorting Machine details").click();
  await button("Something wrong?").click();
  await button("Wrong due date").click();
  await page.getByLabel("Correct due date").fill("2026-10-02T18:00");
  await button("Save date").click();
  await page.getByText("date set by you", { exact: false }).first().waitFor();
  const changed = await page.evaluate(async () =>
    (await window.studi.getSchoolOnboardingState()).assignments.find(
      (a) => a.assignmentId === "assignment-sort",
    ),
  );
  check(
    Boolean(changed.dueDateOverride),
    "Due-date correction did not persist.",
  );
  results.push(
    "Today correction uses real renderer API and updates saved state",
  );
  await open("desk-submitted");
  await page.locator(".rd-receipt").waitFor();
  await button("Open your conversation with Inky").click();
  await button("What Inky did").click();
  await button("View receipt →").click();
  await page.locator(".rd-receipt").waitFor();
  check(
    await page.locator(".rd-receipt").isVisible(),
    "Timeline receipt link did not reopen receipt.",
  );
  results.push("Timeline event navigates to actual saved assignment receipt");
  for (const id of ["tutor-typed", "tutor-explain"]) {
    await open(id);
    const field = page.getByRole("textbox", {
      name: id === "tutor-typed" ? "Your answer" : "Your explanation",
      exact: true,
    });
    await field.fill("A draft typed just before leaving.");
    await button("Leave").click();
    await button("Continue").click();
    await field.waitFor();
    check(
      (await field.inputValue()) === "A draft typed just before leaving.",
      "Tutor draft lost on immediate leave.",
    );
    const stored = await page.evaluate(async () => {
      const state = await window.studi.getLearnState();
      return (
        await window.studi.getTutorSession({
          sessionId: state.sessions[0].sessionId,
        })
      ).blocks[0].draft;
    });
    check(
      stored === "A draft typed just before leaving.",
      "Tutor draft was not flushed to IPC.",
    );
  }
  results.push(
    "Typed and explanation drafts flush before immediate Leave; reopen paused with draft intact",
  );
  await open("tutor-finished");
  await button("Open conversation").click();
  await button("What Inky did").click();
  await button("View session →").click();
  await page
    .getByRole("heading", { name: "That’s today’s session.", exact: true })
    .waitFor();
  results.push("Timeline completed-session event opens saved result");
  await open("tutor-code");
  const code = page.getByRole("textbox", { name: "JavaScript", exact: true });
  await button("Run code").click();
  await page.getByText("[1,2,3]", { exact: true }).waitFor();
  await code.fill(
    "console.log(typeof fetch, typeof indexedDB, typeof importScripts, typeof WebSocket, typeof Worker);",
  );
  await button("Run code").click();
  await page
    .getByText("undefined undefined undefined undefined undefined", {
      exact: true,
    })
    .waitFor();
  await code.fill("while (true) {}");
  await button("Run code").click();
  await page.getByText(/exceeded its time limit/).waitFor();
  await code.fill("console.log('recovered');");
  await button("Run code").click();
  await page.getByText("recovered", { exact: true }).waitFor();
  check(
    (await page
      .locator("iframe[title='Isolated JavaScript runner']")
      .getAttribute("sandbox")) === "allow-scripts",
    "Runner acquired origin privileges.",
  );
  results.push(
    "Isolated JS runs; network/storage/import globals absent; infinite loop terminates and next run recovers",
  );
  await open("settings-preferences");
  await button("Use APA citations").click();
  await page
    .getByLabel("What to remember")
    .fill("Use APA citations and page numbers.");
  await button("Save memory").click();
  const memory = await page.evaluate(async () => {
    const notes = await window.studi.listMemories();
    return window.studi.readMemory({ noteId: notes[0].noteId });
  });
  check(
    memory.content === "Use APA citations and page numbers." &&
      memory.frontmatter.revision === 2,
    "Memory edit failed revision check.",
  );
  results.push("Memory editing persists a new revision");
  for (const id of [
    "today-needs",
    "learn",
    "tutor-choice",
    "desk-review",
    "settings-rules",
  ]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(id);
    if (id === "tutor-choice") await page.locator(".rd-tutor-block").waitFor();
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "Horizontal page overflow: " + id,
    );
  }
  results.push("Five affected routes fit a 390px viewport");
  await open("today");
  const opener = button("Open your conversation with Inky");
  await opener.focus();
  await page.keyboard.press("Enter");
  await button("What Inky did").waitFor();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  check(await opener.evaluate(el => el === document.activeElement), "Conversation did not restore keyboard focus.");
  results.push("Keyboard opens the sheet; Escape restores the composer opener");
  return results;
}
