// Load the ESM tool graph after Electron is ready (some Pi imports await native readiness).
const { app } = require("electron");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
process.env.STUDI_MATERIALS_QA_ROOT = mkdtempSync(join(tmpdir(), "studi-native-materials-"));
app.setPath("userData", join(process.env.STUDI_MATERIALS_QA_ROOT, "profile"));
app.removeAllListeners("window-all-closed");
app.on("window-all-closed", () => {});
app
  .whenReady()
  .then(() => import("./school-materials-native.mjs"))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
