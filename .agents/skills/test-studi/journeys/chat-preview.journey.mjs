// Run through the official Playwright MCP against `bun run preview:ui`.
// Uses the actual application components with synthetic, non-networked fixtures.
import assert from "node:assert/strict";
export async function verifyChatPreview(page, base = "http://127.0.0.1:4174") {
  const errors = [];
  const onError = (e) => errors.push(e.message);
  page.on("pageerror", onError);
  const results = [];
  const open = async (id) => {
    await page.goto(`${base}/?preview=${id}`);
    await page.waitForSelector("[data-studi-app-ready]");
  };
  const box = () => page.getByRole("textbox", { name: "Message Inky" });
  try {
    await page.setViewportSize({ width: 1440, height: 950 });
    await open("week");
    await page.evaluate(() =>
      Object.keys(localStorage).filter(key => key.startsWith("studi-chat-draft:")).forEach(key => localStorage.removeItem(key)),
    );
    await page.reload();
    await page.waitForSelector(".composer-mascot");
    assert.equal(await page.locator(".composer-mascot").count(), 1);
    const range = await page
      .locator(".week-range")
      .innerText();
    await page.getByRole("button", { name: "Next week", exact: true }).click();
    assert.notEqual(
      await page.locator(".week-range").innerText(),
      range,
    );
    await page.getByRole("button", { name: "This week", exact: true }).click();
    assert.equal(
      await page.locator(".week-range").innerText(),
      range,
    );
    await box().fill("Help with @");
    await box().press("ArrowDown");
    await box().press("Enter");
    assert.equal(
      await page.locator(".inky-composer .chat-refs>span").count(),
      1,
    );
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    assert.equal(await page.locator(".workspace-dialog[open]").count(), 1);
    assert.equal(
      await page.locator(".composer-mascot,.chat-work-slip").count(),
      0,
    );
    await box().fill("Keep this next draft");
    await page.waitForTimeout(1800);
    assert.equal(await box().inputValue(), "Keep this next draft");
    assert.equal(await page.locator(".student-bubble").count(), 1);
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", {name:"Close chat",exact:true}).click();
    await page.locator(".composer-mascot").click();
    assert.equal(await page.locator(".student-bubble").count(), 1);
    assert.equal(await box().inputValue(), "Keep this next draft");
    await box().fill("name@example.com");
    assert.equal(await page.getByRole("listbox").count(), 0);
    await box().fill("@not-an-assignment");
    assert.match(
      await page.locator(".assignment-picker").innerText(),
      /No assignments/,
    );
    await box().press("Escape");
    assert.equal(await page.locator(".workspace-dialog[open]").count(), 1);
    await box().fill("Stop this reply");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page.getByRole("button", { name: "Stop reply", exact: true }).click();
    await page.waitForTimeout(1600);
    assert.match(await page.locator(".conversation-log").innerText(), /Paused/);
    results.push(
      "week arrows, mentions, retained draft, centered chat, retained drafts, mention Escape, stop",
    );
    await open("chat-error");
    await page.getByRole("log", {name:"Messages"}).getByRole("button", { name: "Try again", exact: true }).click();
    await page.waitForTimeout(1600);
    assert.equal(await page.locator(".student-bubble").count(), 2);
    results.push("saved failure and retry");
    for (const size of [
      { width: 1440, height: 950 },
      { width: 1024, height: 768 },
      { width: 720, height: 520 },
    ]) {
      await page.setViewportSize(size);
      for (const id of [
        "week",
        "chat-expanded",
        "week-error",
        "week-updating",
        "desk-needs-user",
      ]) {
        await open(id);
        await page.waitForTimeout(100);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          `${id} horizontal overflow`,
        );
        const rect = await page.locator(".inky-composer").boundingBox();
        assert.ok(
          rect && rect.y >= 0 && rect.y + rect.height <= size.height,
          `${id} composer outside viewport`,
        );
        if (id === "desk-needs-user") {
          await page.getByRole("button", { name: "Close assignment" }).click();
          assert.equal(await page.locator(".chat-work-slip").count(), 1);
          await page.locator(".chat-work-slip button").first().click();
          assert.equal(await page.locator(".chat-work-slip").count(), 0);
        }
      }
    }
    results.push("main states at 1440×950, 1024×768, 720×520");
    await open("updates-ready");
    await page
      .getByRole("button", { name: "Update ready", exact: true })
      .click();
    assert.equal(
      await page.getByRole("dialog", { name: "A new Studi is ready." }).count(),
      1,
    );
    await page.getByRole("button", { name: "Later", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "Update ready", exact: true })
        .count(),
      1,
    );
    await open("updates-mac");
    await page
      .getByRole("button", { name: "Update ready", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("button", { name: "Download for Mac", exact: true })
        .count(),
      1,
    );
    await page.getByRole("button", {name:"Download for Mac", exact:true}).click();
    assert.equal(await page.getByText("Save your work, quit Studi, open the downloaded DMG, replace Studi in Applications, then reopen.", {exact:true}).count(), 0);
    results.push("retained update ready state and unsigned Mac download UI");
    assert.deepEqual(errors, []);
    return { passed: results, pageErrors: errors };
  } finally {
    page.off("pageerror", onError);
  }
}
