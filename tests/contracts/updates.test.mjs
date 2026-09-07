import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { UpdateService } from "../../dist/electron/updates/service.js";
function fixture(overrides = {}) {
  const native = new EventEmitter();
  const calls = [];
  let block = null;
  let now = 0;
  Object.assign(native, {
    setFeedURL: ({ url }) => calls.push(["feed", url]),
    checkForUpdates: () => calls.push(["check"]),
    quitAndInstall: () => calls.push(["install"]),
  });
  const service = new UpdateService({
    platform: "win32",
    arch: "x64",
    packaged: true,
    version: "0.1.2",
    firstRun: false,
    native,
    blocked: () => block,
    prepare: async () => {
      calls.push(["prepare"]);
    },
    openDownload: async (url) => calls.push(["download", url]),
    report: (error) => calls.push(["error", error.message]),
    now: () => now,
    ...overrides,
  });
  return {
    service,
    native,
    calls,
    setBlock: (value) => (block = value),
    setTime: (value) => (now = value),
  };
}
test("native checks coalesce, downloaded readiness survives failure, blocked work never restarts", async () => {
  const f = fixture();
  await Promise.all([f.service.check(), f.service.check()]);
  assert.equal(f.calls.filter((c) => c[0] === "check").length, 1);
  f.native.emit("update-available");
  assert.equal(f.service.state().phase, "downloading");
  f.native.emit("update-downloaded", {}, "Release notes", "0.1.3");
  await f.service.check();
  assert.equal(f.calls.filter((c) => c[0] === "check").length, 1);
  f.native.emit("error", new Error("Network dropped"));
  assert.equal(f.service.state().phase, "ready");
  f.setBlock("Finish your handoff");
  await f.service.install();
  assert.equal(
    f.calls.some((c) => c[0] === "prepare"),
    false,
  );
  f.setBlock(null);
  await Promise.all([f.service.install(), f.service.install()]);
  assert.equal(f.calls.filter((c) => c[0] === "install").length, 1);
  assert.equal(f.service.state().installedVersion, "0.1.2");
});
test("first-run lock blocks manual checks too; unavailable development build never calls native updater", async () => {
  const f = fixture({ firstRun: true });
  await f.service.check();
  assert.equal(
    f.calls.some((c) => c[0] === "check"),
    false,
  );
  f.setTime(10000);
  await f.service.check();
  assert.equal(
    f.calls.some((c) => c[0] === "check"),
    true,
  );
  const dev = fixture({ packaged: false });
  await dev.service.check();
  await dev.service.install();
  assert.deepEqual(dev.calls, []);
});
test("failed restart preparation restores runtime and keeps downloaded update for retry", async () => {
  let recovered = 0;
  const f = fixture({
    prepare: async () => {
      throw new Error("Draft save failed");
    },
    recover: () => recovered++,
  });
  await f.service.check();
  f.native.emit("update-downloaded", {}, "Notes", "0.1.3");
  await f.service.install();
  assert.equal(recovered, 1);
  assert.equal(f.service.state().phase, "ready");
  assert.equal(
    f.calls.some((c) => c[0] === "install"),
    false,
  );
  assert.match(f.service.state().error, /Draft/);
});
test("unsigned Mac opens only the official DMG and never simulates installation", async () => {
  const url =
    "https://github.com/kausthubh-coder/inky/releases/download/v0.1.3/Studi-macOS.dmg";
  const f = fixture({
    platform: "darwin",
    fetchRelease: async () => ({
      tag_name: "v0.1.3",
      body: "New things",
      assets: [{ name: "Studi-macOS.dmg", browser_download_url: url }],
    }),
  });
  await f.service.check();
  assert.equal(f.service.state().capability, "manual");
  f.setBlock("Work active");
  await f.service.install();
  assert.deepEqual(f.calls, [["download", url]]);
  assert.equal(f.service.state().installedVersion, "0.1.2");
  const bad = fixture({
    platform: "darwin",
    fetchRelease: async () => ({
      tag_name: "v0.1.3",
      assets: [
        {
          name: "Studi-macOS.dmg",
          browser_download_url: "https://example.com/installer",
        },
      ],
    }),
  });
  await bad.service.check();
  assert.equal(bad.service.state().phase, "error");
  await bad.service.install();
  assert.equal(
    bad.calls.some((c) => c[0] === "download"),
    false,
  );
});

test("native update timeout can retry and disposed services ignore late events", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  await f.service.check();
  t.mock.timers.tick(60_000);
  assert.equal(f.service.state().phase, "error");
  await f.service.check();
  assert.equal(f.calls.filter(c => c[0] === "check").length, 2);
  f.service.dispose();
  f.native.emit("update-downloaded", {}, "Late", "0.1.3");
  await f.service.install();
  assert.equal(f.calls.some(c => c[0] === "install"), false);
  assert.equal(f.native.listenerCount("update-downloaded"), 0);
});
