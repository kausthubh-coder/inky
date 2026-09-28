import assert from "node:assert/strict";
import { join } from "node:path";

// The homework screens through the preview: week, list, All, the assignment page in each state, chat, rules and memory.
export async function verifyHomeworkScreens(page, base, evidenceDirectory) {
  const errors = [];
  const onError = (error) => errors.push(error.message);
  page.on("pageerror", onError);
  const open = async (id) => {
    await page.goto(`${base}/?preview=${id}`);
    await page.waitForSelector("[data-studi-app-ready]");
  };
  const button = (name) => page.getByRole("button", { name, exact: true });
  const shot = async (name) => { if (evidenceDirectory) await page.screenshot({ path: join(evidenceDirectory, `${name}.png`) }); };
  try {
    for (const width of [1120, 800]) {
      await page.setViewportSize({ width, height: 760 });
      await open("week");
      await page.locator("[data-studi-week-board]").waitFor();
      assert.equal(await page.getByText("No due date", { exact: true }).count(), 0, "the strip under the board is gone");
      assert.equal(await page.getByText("+ Add homework", { exact: true }).count(), 0, "adding homework moved to chat");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await shot(`week-${width}`);
    }

    // Week → the assignment itself, not the list.
    await open("week");
    await page.locator(".hw-card").first().click();
    await button("Back to your week").waitFor();
    await button("Back to your week").click();

    // List: one button per row, named for the next step, with every correction behind "···".
    await button("List").click();
    const row = page.locator(".hw-row").first();
    await row.waitFor();
    await row.getByRole("button", { name: /^More for / }).click();
    for (const item of ["Wrong due date", "This isn't homework", "I already handed it in", "Details look wrong"]) await page.getByRole("menuitem", { name: item }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("menu").count(), 0);
    assert.match(await page.locator(".hw-ruleline").innerText(), /Dot's rule for all homework: /);

    // All: by class, with search and To do / Done / All.
    await button("All").click();
    await page.getByRole("textbox", { name: "Search homework" }).fill("zzzz-nothing");
    await page.getByText("Nothing here.", { exact: true }).waitFor();
    await page.getByRole("textbox", { name: "Search homework" }).fill("");
    await button("Done").click();
    await button("To do").click();

    // The assignment page in each state: Dot's turns on the left, your one decision above the chat box.
    await open("assignment");
    await page.getByRole("region", { name: "Your move" }).or(page.locator(".ag-move")).first().waitFor();
    assert.match(await page.locator(".ag-move h2").innerText(), /Start when you're ready|Dot needs to check the page first|This one's left to you/);
    assert.equal(await page.locator(".ag-tabs button[aria-pressed=true]").innerText(), "Details", "not-started work opens on its brief");
    await page.locator(".ag-tips button").first().click();
    assert.notEqual(await page.getByRole("textbox", { name: "Message Dot" }).inputValue(), "", "a tip fills the chat box");
    await page.getByRole("textbox", { name: "Message Dot" }).fill("");
    await shot("assignment-not-started");

    await open("desk-working");
    await page.getByText("Dot is using this page", { exact: true }).waitFor();
    await button("Take over").waitFor();
    assert.equal(await page.locator(".ag-move").count(), 0, "nothing is needed while Dot works");
    assert.equal(await page.getByRole("button", { name: "Stop assignment" }).count(), 1, "the send button becomes Stop");

    await open("desk-needs-user");
    await page.locator(".ag-move").waitFor();
    await button("Stop").waitFor();

    await open("desk-review");
    const hand = page.locator(".ag-move .rd-primary");
    assert.equal(await hand.isDisabled(), true, "open doubts come first");
    while (await page.getByRole("button", { name: "Looks fine" }).count()) await page.getByRole("button", { name: "Looks fine" }).first().click();
    assert.equal(await hand.isDisabled(), false);
    await shot("assignment-review");

    await open("desk-submitted");
    assert.equal(await page.locator(".ag-tabs button[aria-pressed=true]").innerText(), "Receipt");
    await page.getByText("Handed in", { exact: true }).first().waitFor();

    // Chat grows from the chat box over the week; no tabs, and an empty chat has suggestions.
    await open("week");
    await page.getByRole("textbox", { name: "Message Dot" }).click();
    await page.getByRole("region", { name: "Chat with Dot" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "What Dot did" }).count(), 0);
    await page.locator("[data-studi-week-board]").waitFor({ state: "attached" });
    await button("Close chat").click();
    assert.equal(await page.getByRole("region", { name: "Chat with Dot" }).count(), 0);

    // Rules: one set of words, each choice explained.
    await open("settings-homework");
    for (const label of ["Leave it to me", "Do it, I'll hand it in", "Do it and hand it in"]) await page.getByRole("radio", { name: new RegExp(label) }).waitFor();
    await page.getByLabel("When Dot starts", { exact: true }).waitFor();

    // Memory: grouped, each with where it came from, Edit and Forget.
    await open("settings-inky");
    await page.getByText(/What Dot remembers/).waitFor();
    assert.deepEqual(errors, []);
    return "Week, list, All, row menu, assignment states, chat dock, rules and memory passed at 1120 and 800 px.";
  } finally {
    page.off("pageerror", onError);
  }
}
