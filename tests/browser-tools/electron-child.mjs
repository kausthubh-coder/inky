import { app, BrowserWindow } from "electron";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const config = JSON.parse(process.argv[2]);
const moduleAt = path => import(pathToFileURL(join(config.root, "dist", path)).href);
const { BrowserController, formatSnapshot } = await moduleAt("electron/browser/controller.js");
const { createBrowserTools } = await moduleAt("electron/browser/tools.js");
const { installScanReadOnlyGuard } = await moduleAt("electron/browser/read-only-guard.js");
process.send?.({ progress: "modules loaded" });
await mkdir(join(config.directory, "electron"), { recursive: true });
app.setPath("userData", join(config.directory, "electron"));
app.on("will-finish-launching", () => process.send?.({ progress: "will finish launching" }));
app.on("ready", () => process.send?.({ progress: "ready event" }));
process.send?.({ progress: `waiting ready=${app.isReady()}` });
async function run() {
await app.whenReady();
process.send?.({ progress: "electron ready" });
const window = new BrowserWindow({ show: false, width: 1200, height: 900,
  webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    partition: `browser-replay-${Date.now()}` } });
const browser = new BrowserController(window.webContents);
window.webContents.on("did-navigate", () => browser.pageChanged());
const tools = createBrowserTools(browser, { readOnly: true });
const tool = name => tools.find(item => item.name === name);
const progress = message => process.send?.({ progress: message });
const actionSizes = [];
const beforeStyleSizes = [];
let staleRefErrors = 0;
const act = async (name, input) => {
  let result;
  try {
    result = await tool(name).execute("replay", input);
  } catch (error) {
    if (String(error).includes("Stale or unknown browser ref")) staleRefErrors++;
    throw error;
  }
  const text = result.content.find(part => part.type === "text")?.text ?? "";
  actionSizes.push(text.length);
  beforeStyleSizes.push(formatSnapshot(browser.lastSnapshot).length);
  if (text.includes("Stale or unknown browser ref")) throw new Error(text);
  return result;
};
let schoolPostBlocked = false, ssoPostAllowed = false;
const guard = installScanReadOnlyGuard(window.webContents.session, {
  signInHosts: [new URL(config.origins.unity).host],
  ltiLaunchHosts: [new URL(config.origins.statistics).host],
  onScanWrite: (details, decision) => { if (decision.action === "block" && details.url.includes("/assignments/exercise-05") && details.method === "POST") schoolPostBlocked = true; },
});
guard.setScanActive(true);
window.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
  if (details.url.includes("/sso/login") && details.method === "POST") ssoPostAllowed = true;
  callback({ requestHeaders: details.requestHeaders });
});
try {
  progress("navigate dashboard");
  await act("browser_navigate", { url: config.origins.school });
  progress("wait timeline");
  await browser.waitFor("Show more", 5_000);
  progress("snapshot dashboard");
  const first = await browser.snapshot();
  const showMore = first.elements.find(element => element.name === "Show more");
  if (!showMore) throw new Error("Show more was not rendered");
  await browser.snapshot();
  await act("browser_click", { ref: showMore.ref });
  progress("expanded timeline");
  const expanded = await browser.snapshot();
  const showMoreExpanded = expanded.text.includes("Concept quiz") || expanded.text.includes("Design document");
  const course = expanded.elements.find(element => element.href?.includes("/course/view.php?id=programming"));
  if (!course) throw new Error(`Course link missing: ${JSON.stringify(expanded.elements.filter(element => element.role === "link").map(element => [element.name, element.href]).slice(-12))}`);
  await act("browser_click", { ref: course.ref });
  progress("course open");
  const courseSnapshot = await browser.snapshot();
  let rowOffset = 0, rowCount = 0, rowCalls = 0;
  let lastRowRef;
  do {
    const page = await tool("browser_rows").execute("replay", { selector: "tr.activity", offset: rowOffset });
    rowCount += page.details.count;
    lastRowRef = page.details.rows.at(-1)?.ref;
    rowOffset = page.details.nextOffset;
    rowCalls++;
    if (rowCalls > 3) throw new Error("Noisy course required more than three row calls");
  } while (rowOffset !== null);
  const rowEvidence = await browser.evidenceSnapshot([lastRowRef]);
  if (!rowEvidence.elements.some(element => element.ref === lastRowRef)) throw new Error("Row evidence was not retained");
  progress("rows read");
  const submitLab3 = courseSnapshot.elements.find(element => element.name === "Submit Lab 3");
  if (!submitLab3) throw new Error("Submit Lab 3 link missing");
  await act("browser_click", { ref: submitLab3.ref });
  progress("lab link opened");
  const submitLab3Opened = window.webContents.getURL().includes("/mod/assign/view.php?id=pacific-lab");
  await act("browser_navigate", { url: `${config.origins.school}/mod/quiz/view.php?id=concept-quiz` });
  const quiz = await browser.snapshot();
  progress("quiz frame read");
  const iframeReadable = quiz.text.includes("push A then B");
  await act("browser_navigate", { url: `${config.origins.school}/course/view.php?id=programming` });
  const materials = await browser.snapshot();
  const pdf = materials.elements.find(element => element.name === "Lecture slides");
  if (!pdf) throw new Error("PDF link missing");
  const textPage = await tool("read_document").execute("replay", { ref: pdf.ref, page: 1 });
  progress("text PDF read");
  const pdfTextReadable = Boolean(textPage.details.text);
  const image = materials.elements.find(element => element.name === "Graded past quiz");
  const imagePage = await tool("read_document").execute("replay", { ref: image.ref, page: 1 });
  progress("image PDF read");
  const imagePdfReadable = imagePage.details.imageProvided === true;
  await window.webContents.executeJavaScript(`fetch(${JSON.stringify(config.origins.school + "/assignments/exercise-05")},{method:'POST',body:'answer=42'}).catch(()=>{})`);
  await window.webContents.loadURL(config.origins.unity + "/sso/login", {
    postData: [{ type: "rawData", bytes: Buffer.from("login=1") }],
    extraHeaders: "Content-Type: application/x-www-form-urlencoded",
  }).catch(() => {});
  process.send?.({ rows: rowCount, rowCalls, iframeReadable, submitLab3Opened, showMoreExpanded, pdfTextReadable,
    imagePdfReadable, schoolPostBlocked, ssoPostAllowed, staleRefErrors,
    averageActionResultChars: actionSizes.reduce((sum, n) => sum + n, 0) / actionSizes.length,
    beforeStyleActionResultChars: beforeStyleSizes.reduce((sum, n) => sum + n, 0) / beforeStyleSizes.length,
    actionResults: actionSizes.length });
} catch (error) {
  process.send?.({ error: error.stack ?? String(error) });
} finally {
  guard.dispose();
  window.destroy();
  app.quit();
}
}
void run().catch(error => { process.send?.({ error: error.stack ?? String(error) }); app.exit(1); });
