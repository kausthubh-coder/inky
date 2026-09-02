import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("fresh TypeScript entrypoints and build outputs exist", async () => {
  const requiredFiles = [
    "src/main.tsx",
    "src/app/StudiApp.tsx",
    "src/app/app.css",
    "src/types/window.d.ts",
    "shared/assignment.ts",
    "shared/agent-runtime.ts",
    "shared/artifact.ts",
    "shared/evidence.ts",
    "shared/event.ts",
    "shared/ids.ts",
    "shared/index.ts",
    "shared/ipc.ts",
    "shared/permission.ts",
    "shared/run.ts",
    "shared/schema-version.ts",
    "shared/task.ts",
    "shared/tool.ts",
    "electron/main.ts",
    "electron/agent/runtime.ts",
    "electron/storage/index.ts",
    "electron/development-url.ts",
    "electron/preload.cts",
    "electron/tsconfig.json",
    "dist/electron/main.js",
    "dist/electron/preload.cjs",
    "dist/client/index.html",
    "dist/server/index.js",
    "dist/.openai/hosting.json",
  ];

  await Promise.all(requiredFiles.map((relativePath) => access(new URL(relativePath, root))));
});

test("production client output excludes discarded prototype fixtures", async () => {
  const discardedOutputs = [
    "dist/client/demo/assignment.html",
    "dist/client/demo/external.html",
    "dist/client/demo/lms.html",
    "dist/client/demo/moodle.html",
    "dist/client/assets/studi-mascot.png",
    "dist/client/qa/compare-focus.html",
    "dist/client/qa/compare.html",
    "dist/client/qa/implementation.png",
    "dist/client/qa/reference.png",
  ];

  const existingOutputs = [];
  await Promise.all(
    discardedOutputs.map(async (relativePath) => {
      try {
        await access(new URL(relativePath, root));
        existingOutputs.push(relativePath);
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
    }),
  );

  assert.deepEqual(existingOutputs.sort(), []);
});

test("package scripts target the fresh foundation", async () => {
  const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(packageJson.main, "dist/electron/main.js");
  for (const script of ["build", "build:electron", "typecheck", "test", "test:contracts", "test:agent", "test:storage", "test:foundation", "test:sites", "test:electron"]) {
    assert.equal(typeof packageJson.scripts[script], "string", `missing npm script: ${script}`);
  }

  const indexHtml = await readFile(new URL("index.html", root), "utf8");
  assert.match(indexHtml, /src="\/src\/main\.tsx"/);
});

test("Electron boundary uses isolation and a frozen narrow bridge", async () => {
  const mainSource = await readFile(new URL("electron/main.ts", root), "utf8");
  const preloadSource = await readFile(new URL("electron/preload.cts", root), "utf8");
  const ipcSource = await readFile(new URL("shared/ipc.ts", root), "utf8");

  assert.match(mainSource, /nodeIntegration:\s*false/);
  assert.match(mainSource, /contextIsolation:\s*true/);
  assert.match(mainSource, /sandbox:\s*true/);
  assert.match(preloadSource, /createIpcApi\(studiIpcRegistry/);
  assert.match(ipcSource, /return Object\.freeze\(methods\)/);
  assert.match(preloadSource, /exposeInMainWorld\("studi", studiApi\)/);
  assert.deepEqual(
    [...preloadSource.matchAll(/ipcRenderer\.([A-Za-z]+)\s*\(/g)].map((match) => match[1]),
    ["invoke"],
  );
  assert.equal((preloadSource.match(/exposeInMainWorld\s*\(/g) ?? []).length, 1);
  assert.equal((preloadSource.match(/studi:(?:runtime-info|contract-manifest)/g) ?? []).length, 0);
  assert.match(ipcSource, /getRuntimeInfo/);
  assert.match(ipcSource, /getContractManifest/);
  assert.doesNotMatch(preloadSource, /exposeInMainWorld\([^,]+,\s*ipcRenderer/);
  assert.doesNotMatch(preloadSource, /ipcRenderer\.(?:send|sendSync|on|once)\s*\(/);
  assert.doesNotMatch(preloadSource, /\b(?:invoke|send|on)\s*:\s*\([^)]*channel/);
});

test("preload allowlist assertions reject injected arbitrary IPC", () => {
  const injectedPreload = `
    contextBridge.exposeInMainWorld("studi", {
      invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
      on: (channel, listener) => ipcRenderer.on(channel, listener),
    });
  `;

  assert.match(injectedPreload, /ipcRenderer\.on\s*\(/);
  assert.doesNotMatch(injectedPreload, /exposeInMainWorld\("studi", studiApi\)/);
});
