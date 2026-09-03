import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("fresh TypeScript entrypoints and build outputs exist", async () => {
  const requiredFiles = [
    "desktop/src/main.tsx",
    "desktop/src/app/StudiApp.tsx",
    "desktop/src/app/app.css",
    "desktop/src/types/window.d.ts",
    "desktop/shared/assignment.ts",
    "desktop/shared/agent-runtime.ts",
    "desktop/shared/artifact.ts",
    "desktop/shared/evidence.ts",
    "desktop/shared/event.ts",
    "desktop/shared/ids.ts",
    "desktop/shared/index.ts",
    "desktop/shared/ipc.ts",
    "desktop/shared/permission.ts",
    "desktop/shared/run.ts",
    "desktop/shared/schema-version.ts",
    "desktop/shared/task.ts",
    "desktop/shared/tool.ts",
    "desktop/electron/main.ts",
    "desktop/electron/agent/runtime.ts",
    "desktop/electron/storage/index.ts",
    "desktop/electron/development-url.ts",
    "desktop/electron/preload.cts",
    "desktop/electron/tsconfig.json",
    "dist/electron/main.js",
    "dist/electron/preload.cjs",
    "dist/client/index.html",
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
  for (const script of ["build", "build:electron", "typecheck", "test", "test:contracts", "test:agent", "test:storage", "test:foundation", "test:electron"]) {
    assert.equal(typeof packageJson.scripts[script], "string", `missing npm script: ${script}`);
  }

  const indexHtml = await readFile(new URL("index.html", root), "utf8");
  assert.match(indexHtml, /src="\/desktop\/src\/main\.tsx"/);
});

test("Electron boundary uses isolation and a frozen narrow bridge", async () => {
  const mainSource = await readFile(new URL("desktop/electron/main.ts", root), "utf8");
  const preloadSource = await readFile(new URL("desktop/electron/preload.cts", root), "utf8");
  const ipcSource = await readFile(new URL("desktop/shared/ipc.ts", root), "utf8");

  assert.match(mainSource, /nodeIntegration:\s*false/);
  assert.match(mainSource, /contextIsolation:\s*true/);
  assert.match(mainSource, /sandbox:\s*true/);
  assert.match(preloadSource, /createIpcApi\(studiIpcRegistry/);
  assert.match(ipcSource, /return Object\.freeze\(methods\)/);
  assert.match(preloadSource, /exposeInMainWorld\("studi", rendererApi\)/);
  assert.deepEqual(
    [...preloadSource.matchAll(/ipcRenderer\.([A-Za-z]+)\s*\(/g)].map((match) => match[1]),
    ["invoke", "on", "removeListener", "on", "removeListener"],
  );
  assert.equal((preloadSource.match(/exposeInMainWorld\s*\(/g) ?? []).length, 1);
  assert.equal((preloadSource.match(/studi:(?:runtime-info|contract-manifest)/g) ?? []).length, 0);
  assert.match(ipcSource, /getRuntimeInfo/);
  assert.match(ipcSource, /getContractManifest/);
  assert.doesNotMatch(preloadSource, /exposeInMainWorld\([^,]+,\s*ipcRenderer/);
  assert.doesNotMatch(preloadSource, /ipcRenderer\.(?:send|sendSync|once)\s*\(/);
  assert.doesNotMatch(preloadSource, /ipcRenderer\.on\s*\(\s*["'`]/);
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
