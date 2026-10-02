// Renders the two reference files to shots/. Run from the repo root: node docs/redesign/learn-v2/shoot.mjs
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
const dir = "docs/redesign/learn-v2/";
const home = ["home", "home-test", "home-self", "home-new", "home-empty"];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
page.on("pageerror", error => console.log("pageerror", error.message));
const lessonUrl = pathToFileURL(dir + "lesson.html").href;
await page.goto(lessonUrl);
const lesson = await page.evaluate(() => window.IDS);
for (const [file, ids] of [["home.html", home], ["lesson.html", lesson]]) {
  for (const id of ids) {
    await page.goto(`${pathToFileURL(dir + file).href}?screen=${id}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700);
    await page.locator(`#${id}`).screenshot({ path: `${dir}shots/${id}.png`, timeout: 8000 });
    console.log("ok", id);
  }
}
await browser.close();
