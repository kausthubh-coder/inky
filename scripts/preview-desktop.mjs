import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { windowChromeOptions } from "../dist/electron/window-chrome.js";

// A visible, isolated native preview. No production preload, auth, or backend.
const url = new URL(app.commandLine.getSwitchValue("studi-preview-url"));
if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.searchParams.get("preview") !== "week") throw new Error("Expected the local Studi preview server.");
const profile = join(process.cwd(), ".agents", "studi-qa", "ui-preview");
await mkdir(profile, { recursive: true });
app.setPath("userData", profile);
app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
app.commandLine.appendSwitch("remote-debugging-port", "0");
void app.whenReady().then(async () => {
const window = new BrowserWindow({
  width: 1280, height: 850, minWidth: 720, minHeight: 520,
  title: "Studi · design preview", autoHideMenuBar: true,
  icon: join(process.cwd(), "assets", "studi-inky.png"),
  ...windowChromeOptions,
  webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
});
window.setMenu(null);
window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
window.webContents.on("will-navigate", (event, target) => { if (new URL(target).origin !== url.origin) event.preventDefault(); });
await window.loadURL(url.href);
app.on("window-all-closed", () => app.quit());
}).catch(error => { console.error(error); app.exit(1); });
