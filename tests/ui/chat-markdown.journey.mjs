// Controlled replies in the actual chat components; no provider or inbox access.
import assert from "node:assert/strict";

export const markdownReply = `I checked the past week's inbox. **These are the priorities:**

- **Statistics homework — due tonight.** Include MATLAB commands and output. [Email](https://example.com/inbox/homework)
- **Extension request:** Use *Request an Extension* at the top of the homework.
  - Your teacher has not confirmed approval yet.
- **Computer science:** Workshops 3 and 4, plus the team request form.

**Good news:** Your reflection journal was submitted.

## Next steps

1. Finish the homework.
2. Check your extension request.

> Save your work before you close the page.

Use \`mean(scores)\` to calculate the average.

\`\`\`matlab
scores = [85, 90, 95];
average = mean(scores);
\`\`\`

| Class | Due | Status |
| --- | --- | --- |
| Statistics | Tonight | **In progress** |
| Computer science | Tomorrow | Not started |

- [x] Reflection journal submitted
- [ ] Homework finished

~~Old deadline~~ Updated deadline.

<script>alert('not executable')</script>

[Unsafe link](javascript:alert%281%29) ![Image description](https://example.com/tracker.png)
`;

export async function verifyChatMarkdown(page, base, evidenceDirectory) {
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on("pageerror", onError);
  const failures = [];
  const checkRecovery = async (name, check) => {
    try { await check(); }
    catch (error) {
      failures.push(error);
      if (evidenceDirectory) await page.screenshot({ path: `${evidenceDirectory}/${name}.png` });
    }
  };
  const seed = async text => {
    await page.evaluate(text => {
      window.studi.getConversationTimeline = async () => ({
        hasMore: false,
        entries: [
          { id: "markdown-user", kind: "message", context: { kind: "home" }, role: "user", text: "Keep **my input** exactly as typed.", createdAt: "2026-09-12T12:00:00Z" },
          { id: "markdown-reply", kind: "message", context: { kind: "home" }, role: "assistant", text, createdAt: "2026-09-12T12:00:01Z" },
        ],
      });
    }, text);
    // The preview has no engine events; allow its ten-second safety poll.
    await page.waitForFunction(text => {
      const firstLine = text.split("\n")[0];
      return [...document.querySelectorAll(".hw-dock .chat-markdown")].some(el =>
        el.textContent.includes(firstLine) || el.textContent.includes(firstLine.replaceAll("**", "")));
    }, text, { timeout: 15_000 });
    await page.getByText("Keep **my input** exactly as typed.", { exact: true }).waitFor();
  };
  try {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto(`${base}/?preview=chat-expanded`);
    await page.waitForSelector("[data-studi-app-ready]");
    await seed(markdownReply);
    const reply = page.locator(".hw-dock .ag-text .chat-markdown");
    assert.equal(await reply.locator("strong").filter({ hasText: "These are the priorities:" }).count(), 1);
    assert.equal(await reply.locator("ul ul li").count(), 1);
    assert.equal(await reply.locator("ol > li").count(), 2);
    assert.equal(await reply.locator("pre code").count(), 1);
    assert.equal(await reply.locator("table tbody tr").count(), 2);
    assert.equal(await reply.locator("input[type=checkbox]:disabled").count(), 2);
    assert.equal(await reply.locator("del").innerText(), "Old deadline");
    assert.equal(await reply.locator("script, img, a[href^='javascript:']").count(), 0);
    assert.equal(await page.locator(".hw-dock .ag-you strong").count(), 0);
    const link = reply.getByRole("link", { name: "Email", exact: true });
    assert.equal(await link.getAttribute("href"), "https://example.com/inbox/homework");
    assert.equal(await link.getAttribute("target"), "_blank");
    // Fulfill the destination locally to verify keyboard activation without network traffic.
    await page.context().route("https://example.com/inbox/homework", route => route.fulfill({ contentType: "text/html", body: "<title>Controlled link destination</title>" }));
    await link.focus();
    const popupPromise = page.waitForEvent("popup");
    await link.press("Enter");
    const popup = await popupPromise;
    await popup.waitForLoadState();
    assert.equal(popup.url(), "https://example.com/inbox/homework");
    await popup.close();
    assert.match(page.url(), /preview=chat-expanded/);
    for (const size of [{ width: 1440, height: 950 }, { width: 720, height: 620 }]) {
      await page.setViewportSize(size);
      await page.locator(".hw-dock-log").evaluate(log => { log.scrollTop = 0; });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await page.locator(".hw-dock-log").evaluate(log => log.scrollWidth > log.clientWidth), false);
      if (evidenceDirectory) await page.screenshot({ path: `${evidenceDirectory}/markdown-${size.width}.png` });
    }
    await seed(`Long code:\n\n\`\`\`\n${"value = ".repeat(100)}\n\`\`\`\n\nLong link: https://example.com/${"very-long-path-".repeat(50)}`);
    await reply.getByText("Long code:", { exact: true }).waitFor();
    assert.equal(await page.locator(".hw-dock-log").evaluate(log => log.scrollWidth > log.clientWidth), false);
    assert.equal(await reply.locator("pre").evaluate(pre => pre.scrollWidth > pre.clientWidth), true);
    await seed("Still writing **a partial reply");
    await reply.getByText("Still writing **a partial reply", { exact: true }).waitFor();
    await seed("Still writing **a complete reply**");
    await reply.locator("strong").getByText("a complete reply", { exact: true }).waitFor();

    await checkRecovery("bug-chat-reopen", async () => {
      await page.getByRole("textbox", { name: "Message Dot" }).fill("Keep this draft");
      await page.getByRole("button", { name: "Close chat", exact: true }).click();
      await page.getByRole("button", { name: "Open your conversation with Dot" }).click();
      assert.equal(await page.getByRole("textbox", { name: "Message Dot" }).inputValue(), "Keep this draft");
      await reply.waitFor();
    });

    await page.goto(`${base}/?preview=chat-error`);
    await page.getByRole("log", { name: "Conversation" }).waitFor();
    await checkRecovery("bug-chat-retry", async () => {
      await page.getByRole("log", { name: "Conversation" }).getByRole("button", { name: "Try again", exact: true }).click();
      await page.locator(".chat-markdown").filter({ hasText: "Okay, I will keep that in mind:" }).waitFor({ timeout: 15_000 });
      assert.equal(await page.locator(".hw-dock .ag-you").count(), 2);
    });

    await page.goto(`${base}/?preview=assignment`);
    await page.getByRole("textbox", { name: "Message Dot" }).fill("Explain **average** using `mean(scores)`.");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.locator(".ag-thread .chat-markdown strong").getByText("average", { exact: true }).waitFor();
    assert.equal(await page.locator(".ag-thread .chat-markdown code").innerText(), "mean(scores)");
    assert.deepEqual(errors, []);
    assert.equal(failures.length, 0, failures.map(error => error.message).join("\n"));
    return { passed: ["formatted reply and literal student input", "safe links with keyboard activation", "retained draft and history", "desktop and narrow layout", "long content overflow", "partial then complete Markdown", "failed reply retry", "assignment chat formatting"], errors };
  } finally {
    page.off("pageerror", onError);
    await page.context().unroute("https://example.com/inbox/homework");
  }
}
