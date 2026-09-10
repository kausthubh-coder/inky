import assert from "node:assert/strict";
import test from "node:test";
import { build } from "vite";
import { fileURLToPath } from "node:url";

test("production renderer excludes the preview entry, sample API, and school mock", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const result = await build({ root, logLevel: "silent", build: { write: false } });
  const outputs = Array.isArray(result) ? result : [result];
  const modules = outputs.flatMap(output => output.output.flatMap(chunk => chunk.type === "chunk" ? Object.keys(chunk.modules) : []));
  assert.ok(modules.some(path => path.replaceAll("\\", "/").endsWith("/desktop/src/app/StudiApp.tsx")));
  assert.deepEqual(modules.filter(path => path.replaceAll("\\", "/").includes("/desktop/src/preview/")), []);
});
