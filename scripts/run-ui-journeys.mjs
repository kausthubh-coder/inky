import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const evidenceDirectory = join(root, ".agents", "studi-qa", "journeys");
await mkdir(evidenceDirectory, { recursive: true });

const preview = spawn(process.execPath, ["scripts/preview-ui.mjs", "--no-open", "--port", String(port)], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let previewOutput = "";
preview.stdout.on("data", chunk => { previewOutput += chunk; });
preview.stderr.on("data", chunk => { previewOutput += chunk; });

let browser;
let failed = 0;
try {
  await waitForPreview(base, preview);
  browser = await chromium.launch({ headless: true });
  const files = (await readdir(join(root, "tests", "ui")))
    .filter(file => file.endsWith(".journey.mjs"))
    .sort();
  for (const file of files) {
    const module = await import(pathToFileURL(join(root, "tests", "ui", file)));
    const journeys = Object.entries(module).filter(([, value]) => typeof value === "function");
    if (journeys.length === 0) {
      console.log(`FAIL ${file} (no exported journey)`);
      failed += 1;
      continue;
    }
    for (const [name, journey] of journeys) {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await journey(page, base, evidenceDirectory);
        console.log(`PASS ${file} :: ${name}`);
      } catch (error) {
        failed += 1;
        console.error(`FAIL ${file} :: ${name}`);
        console.error(error instanceof Error ? error.stack : error);
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser?.close();
  preview.kill();
  await Promise.race([
    new Promise(resolveExit => preview.once("exit", resolveExit)),
    new Promise(resolveTimeout => setTimeout(resolveTimeout, 3_000)),
  ]);
}

if (failed) process.exitCode = 1;

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(error => error ? reject(error) : resolvePort(address.port));
    });
  });
}

async function waitForPreview(url, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Preview exited early (${child.exitCode}).\n${previewOutput}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error(`Preview did not become ready.\n${previewOutput}`);
}
