import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getDevelopmentUrl } from "../../dist/electron/development-url.js";

function context(switchValue = "", isPackaged = false) {
  return { isPackaged, switchValue };
}

test("development URL is absent unless configured", () => {
  assert.equal(getDevelopmentUrl(context()), undefined);
});

test("development URL permits only credential-free local HTTP", () => {
  assert.equal(
    getDevelopmentUrl(context("http://127.0.0.1:5173")),
    "http://127.0.0.1:5173/",
  );
  assert.equal(
    getDevelopmentUrl(context("http://localhost:5173/app")),
    "http://localhost:5173/app",
  );

  for (const url of [
    "https://localhost:5173",
    "http://school.example.edu:5173",
    "http://user:password@127.0.0.1:5173",
    "http://[::1]:5173",
    "http://localhost.school.example.edu:5173",
    "http://127.0.0.1.school.example.edu:5173",
  ]) {
    assert.throws(() => getDevelopmentUrl(context(url)), /credential-free local HTTP URL/);
  }
});

test("malformed development URLs fail closed", () => {
  for (const url of ["not a url", "://localhost", "http://[::1"]) {
    assert.throws(() => getDevelopmentUrl(context(url)));
  }
});

test("packaged launches ignore the development URL switch", () => {
  for (const switchValue of [
    "",
    "http://localhost:5173",
    "https://school.example.edu",
    "not a url",
  ]) {
    assert.equal(getDevelopmentUrl(context(switchValue, true)), undefined);
  }
});

test("Electron development renderer selection is explicit per launch", async () => {
  const [mainSource, packageSource] = await Promise.all([
    readFile(new URL("../../electron/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ]);
  const scripts = JSON.parse(packageSource).scripts;

  assert.match(
    mainSource,
    /getDevelopmentUrl\(\{\s*isPackaged:\s*app\.isPackaged,\s*switchValue:\s*app\.commandLine\.getSwitchValue\("studi-development-url"\),\s*\}\)/s,
  );
  assert.doesNotMatch(mainSource, /STUDI_DEVELOPMENT_MODE|VITE_DEV_SERVER_URL/);
  assert.match(
    scripts["dev:electron"],
    /electron \. --studi-development-url=http:\/\/127\.0\.0\.1:5173/,
  );
  assert.doesNotMatch(scripts["dev:electron"], /STUDI_DEVELOPMENT_MODE|VITE_DEV_SERVER_URL/);
  assert.equal(scripts.start, "npm run build && electron .");
});
