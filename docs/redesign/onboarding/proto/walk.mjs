// Clicks through the prototype and screenshots each moment to docs/redesign/onboarding/proto/shots/.
// Run from the repo root while `bun run preview:ui --no-open` serves on 4174.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.env.PREVIEW_URL ?? "http://127.0.0.1:4174";
const out = "docs/redesign/onboarding/proto/shots";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", error => console.log("pageerror", error.message));
page.on("console", message => { if (message.type() === "error") console.log("console", message.text().slice(0, 200)); });
let n = 0;
const shot = async (name, wait = 500) => { await page.waitForTimeout(wait); n += 1; await page.screenshot({ path: `${out}/${String(n).padStart(2, "0")}-${name}.png` }); console.log("shot", name); };
const click = async (text) => { await page.getByRole("button", { name: text, exact: true }).first().click(); };
const only = process.argv[2];

if (!only || only === "onboarding") {
  await page.goto(`${base}/docs/redesign/onboarding/proto/?step=gate`, { waitUntil: "networkidle" });
  await shot("gate", 900);
  await click("Hi Dot"); await shot("welcome", 900);
  await click("Show me"); await shot("welcome-find", 1600); await shot("welcome-work", 2600); await shot("welcome-your-turn", 1500);
  await click("Submit"); await shot("welcome-stamped", 700); await shot("welcome-chalky", 1500);
  await click("Let's do it"); await page.locator(".fable-pick", { hasText: "ChatGPT" }).click(); await shot("ai");
  await click("Let's go"); await shot("apps");
  await click("Continue"); await shot("folder");
  await click("Use this folder"); await shot("link-empty", 1400);
  await page.getByLabel("Class link").fill("canvas.ncsu.edu"); await shot("link-canvas");
  await click("That's the one"); await shot("permission");
  await click("Use this"); await click("Sounds good. Open school."); await shot("signin", 900);
  await click("I'm signed in. Look around."); await shot("scan-early", 2600); await shot("scan-later", 3400);
  await shot("ready", 4000);
  await page.goto(`${base}/docs/redesign/onboarding/proto/?step=failed`, { waitUntil: "networkidle" }); await shot("failed", 900);
  await page.goto(`${base}/docs/redesign/onboarding/proto/?step=in`, { waitUntil: "networkidle" }); await shot("skipped-school", 900);
}
if (!only || only === "tour") {
  n = 100;
  await page.goto(`${base}/docs/redesign/onboarding/proto/?preview=week&tour=0`, { waitUntil: "networkidle" });
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`${base}/docs/redesign/onboarding/proto/?preview=week&tour=0`, { waitUntil: "networkidle" });
  const steps = [
    ["tour-practice-card", async () => page.locator(".hw-card", { hasText: "Practice" }).first().click()],
    ["tour-start", async () => page.locator(".ag-dock-card button", { hasText: "Start" }).first().click()],
    ["tour-working", async () => click("Next")],
    ["tour-review", async () => { for (let i = 0; i < 2 && await page.getByRole("button", { name: "Looks fine" }).count(); i += 1) { await page.getByRole("button", { name: "Looks fine" }).first().click(); await page.waitForTimeout(300); } await page.locator(".ag-acts .rd-primary").click({ force: true }); }],
    ["tour-submitted", async () => click("Next")],
    ["tour-chat", async () => click("Next")],
    ["tour-learn-tab", async () => page.locator(".rd-mode-switch button", { hasText: "Learn" }).click()],
    ["tour-chalky", async () => page.locator(".lr-row", { hasText: "Practice quiz" }).click()],
    ["tour-lesson", async () => page.locator(".tu-opts button").first().click()],
    ["tour-right", async () => click("Next")],
  ];
  for (const [name, next] of steps) {
    await shot(name, 1700);
    await next();
    await page.waitForLoadState("networkidle");
  }
  await shot("tour-finale", 1500);
}
await browser.close();
