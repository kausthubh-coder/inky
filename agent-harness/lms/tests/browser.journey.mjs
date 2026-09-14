import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { startLms } from "../../../.studi-lms/build/server.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.STUDI_PLAYWRIGHT_PATH ?? "playwright");
const proofDirectory = resolve(".agents/studi-qa/lms-proof");
await mkdir(proofDirectory, { recursive: true });
const runDirectory = resolve(".studi-lms/runs", `browser-${randomUUID()}`);
let school = await startLms({ scenarioId: "smoke", runDirectory });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.STUDI_CHROMIUM_PATH
    ? { executablePath: process.env.STUDI_CHROMIUM_PATH }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(10_000);
const consoleErrors = [];
page.on("pageerror", (error) => consoleErrors.push(error.message));
try {
  await page.goto(`${school.url}/assignments/observation`);
  assert.match(await page.title(), /Observation paragraph/);
  await page.screenshot({
    path: join(proofDirectory, "desktop.png"),
    fullPage: true,
  });
  const answer =
    "Rain tapped against the blue window. Water rattled in the gutter. A grey cloud covered the sun.";
  await page.getByLabel("Your response").fill(answer);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Draft saved" }).waitFor();
  assert.equal(school.inspect().state.submissions.length, 0);
  await page.reload();
  assert.equal(await page.getByLabel("Your response").inputValue(), answer);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(proofDirectory, "narrow-draft.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  const oldUrl = school.url;
  await school.close();
  school = await startLms({
    runDirectory,
    resume: true,
    port: Number(new URL(oldUrl).port),
  });
  await page.goto(`${school.url}/assignments/observation`);
  assert.equal(await page.getByLabel("Your response").inputValue(), answer);
  await page
    .getByRole("button", { name: "Submit assignment", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Submission history", exact: true })
    .waitFor();
  const first = school.inspect();
  assert.equal(first.state.submissions.length, 1);
  const receiptId = first.state.submissions[0].id;
  assert.equal(
    await page.getByText(receiptId, { exact: true }).isVisible(),
    true,
  );
  await page.reload();
  assert.equal(school.inspect().state.submissions.length, 1);
  assert.equal(
    await page.getByText(receiptId, { exact: true }).isVisible(),
    true,
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({
    path: join(proofDirectory, "submission.png"),
    fullPage: true,
  });
  assert.deepEqual(consoleErrors, []);
  const receipt = {
    result: "passed",
    mode: "normal Chromium browser; local synthetic school",
    runDirectory,
    runId: school.runId,
    receiptId,
    checks: [
      "render",
      "save draft",
      "reload retains answer",
      "narrow viewport without overflow",
      "server restart retains answer",
      "submit receipt",
      "reload does not duplicate submission",
    ],
    state: school.inspect(),
    screenshots: ["desktop.png", "narrow-draft.png", "submission.png"],
    limits: [
      "No live model or production Electron assignment execution",
      "No live PostHog export",
    ],
  };
  await writeFile(
    join(proofDirectory, "browser-receipt.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(
    JSON.stringify({
      result: receipt.result,
      runId: school.runId,
      receiptId,
      checks: receipt.checks,
    }),
  );
} finally {
  await browser.close();
  await school.close();
}
