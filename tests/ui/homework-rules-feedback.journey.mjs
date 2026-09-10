import assert from "node:assert/strict";

// Controlled fixture transport: never submits feedback to a real account.
export async function verifyHomeworkRulesFeedback(page, base) {
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on("pageerror", onError);
  try {
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.goto(`${base}/?preview=settings-rules`);
    const save = page.getByRole("button", { name: "Save rule", exact: true });
    await save.waitFor();
    assert.equal(await save.isEnabled(), false);
    assert.equal(await page.getByRole("radio", { name: /Work on it, then stop/ }).isChecked(), true);
    await page.evaluate(() => {
      window.ruleCalls = [];
      const save = window.studi.savePermissionRule;
      window.studi.savePermissionRule = input => { window.ruleCalls.push(input); return save(input); };
    });
    await page.getByLabel("Which class?").selectOption("course-csc316");
    await save.click();
    await page.getByRole("button", { name: "Remove rule for CSC 316 Data Structures", exact: true }).waitFor();
    await page.getByRole("radio", { name: /Work on it and submit/ }).check();
    await page.getByLabel("Apply this rule to").selectOption("global");
    assert.equal(await page.getByRole("radio", { name: /Work on it, then stop/ }).isChecked(), true, "scope changes reset submission permission");
    await page.getByRole("radio", { name: /Work on it and submit/ }).check();
    await save.click();
    await page.getByLabel("Apply this rule to").selectOption("assignment");
    await page.getByLabel("Which assignment?").selectOption("assignment-hw3");
    await save.click();
    await page.getByRole("button", { name: "Remove rule for HW 3", exact: true }).waitFor();
    await page.getByLabel("Apply this rule to").selectOption("course");
    await page.getByText("Advanced: a confirmed assignment group", { exact: true }).click();
    await page.getByLabel("Limit this rule to a confirmed group").check();
    assert.equal(await save.isEnabled(), false);
    await page.getByText("Enter the exact confirmed group ID.", { exact: true }).waitFor();
    await page.getByLabel("Exact group ID", { exact: false }).fill("  weekly-problem-set  ");
    await save.click();
    await page.getByRole("button", { name: "Remove rule for CSC 316 Data Structures · Group: weekly-problem-set", exact: true }).waitFor();
    const calls = await page.evaluate(() => window.ruleCalls);
    assert.deepEqual(calls, [
      { scope: "course", mode: "attempt", courseId: "course-csc316" },
      { scope: "global", mode: "auto_submit" },
      { scope: "assignment", mode: "attempt", assignmentId: "assignment-hw3" },
      { scope: "pattern", mode: "attempt", courseId: "course-csc316", patternId: "weekly-problem-set" },
    ]);
    await page.getByRole("button", { name: "Help & feedback", exact: true }).click();
    const note = page.getByRole("textbox", { name: "Your note", exact: true });
    await note.waitFor();
    await page.evaluate(() => {
      window.feedbackCalls = [];
      window.studi.submitFeedback = input => { window.feedbackCalls.push(input); return Promise.reject(new Error("Controlled feedback failure")); };
    });
    const message = "x".repeat(1000);
    await note.fill(message);
    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    await page.getByRole("button", { name: "Try sending again", exact: true }).waitFor();
    assert.equal(await note.inputValue(), message);
    await page.evaluate(() => {
      window.studi.submitFeedback = input => { window.feedbackCalls.push(input); return new Promise(resolve => { window.finishFeedback = () => resolve({ accepted: true, feedbackId: "00000000-0000-4000-8000-000000000002" }); }); };
    });
    await page.getByRole("button", { name: "Try sending again", exact: true }).click();
    await page.getByRole("button", { name: "Sending…", exact: true }).waitFor();
    assert.equal(await note.isEditable(), false);
    assert.equal(await note.inputValue(), message);
    await page.evaluate(() => window.finishFeedback());
    await page.getByText("Thanks — the Studi team received your note.", { exact: true }).waitFor();
    assert.equal(await note.inputValue(), "");
    assert.deepEqual(await page.evaluate(() => window.feedbackCalls), [{ message }, { message }], "only the exact note is sent, without overflowing hidden prefixes");
    await page.setViewportSize({ width: 720, height: 520 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole("button", { name: "Homework rules", exact: true }).click();
    await save.waitFor();
    await save.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    return { passed: ["exact course/assignment/global/group payloads", "safe default and scope-change reset", "specific group validation", "failed feedback retains 1000-character draft", "pending feedback cannot be edited or duplicated", "accepted feedback clears draft", "720px settings layout"], pageErrors: errors };
  } finally { page.off("pageerror", onError); }
}
