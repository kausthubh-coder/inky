import assert from "node:assert/strict";

// Controlled provider responses; exercises the real renderer, not live OAuth.
export async function verifyConnectedAppsPreview(page, base = "http://127.0.0.1:4185") {
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on("pageerror", onError);
  const row = toolkit => page.locator(`[data-connected-app="${toolkit}"]`);
  const expectText = async (toolkit, text) => {
    await row(toolkit).getByRole("status").filter({ hasText: text }).waitFor();
  };
  const settle = (toolkit, status) => page.evaluate(({ toolkit, status }) => {
    const request = window.connectionTest.pending[toolkit];
    delete window.connectionTest.pending[toolkit];
    if (status === "ERROR") request.reject(new Error("Controlled provider outage"));
    else request.resolve(status === null ? null : { toolkit, sessionId: "fixture", connectedAccountId: status === "ACTIVE" ? "fixture" : null, status, redirectUrl: null });
  }, { toolkit, status });
  try {
    for (const route of ["settings-apps"]) {
      await page.setViewportSize({ width: 1280, height: 850 });
      await page.goto(`${base}/?preview=${route}`);
      await expectText("gmail", "Connected");
      await page.evaluate(() => {
        window.connectionTest = { pending: {}, calls: [] };
        const request = operation => ({ toolkit }) => {
          window.connectionTest.calls.push({ toolkit, operation });
          return new Promise((resolve, reject) => { window.connectionTest.pending[toolkit] = { resolve, reject }; });
        };
        window.studi.refreshConnectedApp = request("check");
        window.studi.connectApp = request("connect");
      });
      await row("gmail").getByRole("button", { name: "Check", exact: true }).click();
      await expectText("gmail", "Checking connection…");
      assert.equal(await row("gmail").getByRole("button").isEnabled(), false);
      assert.equal(await row("googledrive").getByRole("button").isEnabled(), true);
      await row("googledrive").getByRole("button").click();
      await settle("googledrive", "ERROR");
      await expectText("googledrive", "Couldn't check. Try again.");
      await settle("gmail", "ACTIVE");
      await expectText("gmail", "All good · connected");
      await row("googledrive").getByRole("button", { name: "Try again" }).click();
      await settle("googledrive", "ACTIVE");
      await expectText("googledrive", "All good · connected");
      await row("gmail").getByRole("button").click();
      await settle("gmail", "EXPIRED");
      await expectText("gmail", "Connection expired or unavailable. Sign in again.");
      await row("gmail").getByRole("button", { name: "Reconnect" }).click();
      await expectText("gmail", "Opening sign-in…");
      await settle("gmail", "ERROR");
      await expectText("gmail", "Couldn't open sign-in. Try again.");
      await row("gmail").getByRole("button", { name: "Try again" }).click();
      await settle("gmail", "INITIATED");
      await expectText("gmail", "Finish signing in in your browser.");
      await row("gmail").getByRole("button", { name: "I finished" }).click();
      await settle("gmail", "INITIATED");
      await expectText("gmail", "Still waiting — finish signing in.");
      await row("gmail").getByRole("button", { name: "I finished" }).click();
      await settle("gmail", "ACTIVE");
      await expectText("gmail", "All good · connected");
      if (route === "settings-apps") {
        await page.getByRole("button", { name: "Homework folder", exact: true }).click();
        await page.getByRole("button", { name: "Connected apps", exact: true }).click();
        await expectText("gmail", "All good · connected");
      }
      for (const status of ["DISCONNECTED", null, "FAILED", "INACTIVE"]) {
        await row("gmail").getByRole("button").click();
        await settle("gmail", status);
        await expectText("gmail", status === null || status === "DISCONNECTED" ? "No connection found. Connect again." : "Connection expired or unavailable. Sign in again.");
      }
      await page.setViewportSize({ width: 720, height: 520 });
      await row("gmail").scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, route);
      const button = row("gmail").getByRole("button");
      await button.focus();
      await page.keyboard.press("Enter");
      await expectText("gmail", "Opening sign-in…");
      await settle("gmail", "ACTIVE");
      await expectText("gmail", "All good · connected");
      assert.equal(await row("gmail").getByRole("status").getAttribute("aria-live"), "polite");
      const calls = await page.evaluate(() => window.connectionTest.calls);
      assert.equal(calls.length, 13, "one request per click");
      assert.deepEqual(calls.slice(4, 6).map(call => call.operation), ["connect", "connect"], "connect failures retry sign-in");
    }
    assert.deepEqual(errors, []);
    return { passed: ["settings: pending, success, failure and retry", "concurrent apps and isolated loading", "expired, failed, inactive, disconnected and missing connections", "browser sign-in, unfinished sign-in, and reconnect", "settings navigation retains result", "720px layout, keyboard, live status"], pageErrors: errors };
  } finally {
    page.off("pageerror", onError);
  }
}

export async function verifyOnboardingAutoConnect(page, base = "http://127.0.0.1:4185") {
  const sourceRoute = "**/desktop/src/preview/fixtures.ts*";
  await page.route(sourceRoute, async route => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({ response, body: source.replace('connectedAccountId: "preview-account", status: "ACTIVE"', 'connectedAccountId: null, status: "DISCONNECTED"') });
  });
  const row = toolkit => page.locator(`[data-connected-app="${toolkit}"]`);
  try {
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.goto(`${base}/?preview=onboarding-connections`);
    await row("gmail").getByRole("button", { name: "Connect", exact: true }).waitFor();
    await page.evaluate(() => {
      window.connectionTest = { pending: {}, connects: 0, checks: 0 };
      window.studi.connectApp = async ({ toolkit }) => {
        window.connectionTest.connects++;
        return { toolkit, sessionId: "fixture", connectedAccountId: null, status: "INITIATED", redirectUrl: null };
      };
      window.studi.refreshConnectedApp = ({ toolkit }) => {
        window.connectionTest.checks++;
        return new Promise(resolve => { window.connectionTest.pending[toolkit] = resolve; });
      };
    });
    const settle = async (toolkit, status) => {
      await page.waitForFunction(toolkit => Boolean(window.connectionTest.pending[toolkit]), toolkit);
      await page.evaluate(({ toolkit, status }) => {
        const resolve = window.connectionTest.pending[toolkit];
        delete window.connectionTest.pending[toolkit];
        resolve({ toolkit, sessionId: "fixture", connectedAccountId: status === "ACTIVE" ? "fixture" : null, status, redirectUrl: null });
      }, { toolkit, status });
    };
    await row("gmail").getByRole("button", { name: "Connect", exact: true }).click();
    await row("gmail").getByRole("button", { name: "Connecting…", exact: true }).waitFor();
    assert.equal(await row("gmail").getByRole("button").isEnabled(), false);
    assert.equal(await row("googledrive").getByRole("button").isEnabled(), true);
    assert.equal(await page.getByRole("button", { name: "I finished", exact: true }).count(), 0);
    await settle("gmail", "INITIATED");
    await settle("gmail", "FAILED");
    await row("gmail").getByRole("status").filter({ hasText: "Connection failed." }).waitFor();
    await row("gmail").getByRole("button", { name: "Redo", exact: true }).click();
    await settle("gmail", "ACTIVE");
    await row("gmail").getByRole("status").filter({ hasText: "Connected" }).waitFor();
    assert.equal(await row("gmail").getByRole("button").count(), 0);
    assert.ok((await row("gmail").getByRole("status").getAttribute("class")).includes("--mint"));
    assert.equal(await page.getByRole("button", { name: "Check", exact: true }).count(), 0);
    assert.deepEqual(await page.evaluate(() => ({ connects: window.connectionTest.connects, checks: window.connectionTest.checks })), { connects: 2, checks: 3 });
    await page.evaluate(() => { window.studi.connectApp = async () => { throw Error("Controlled connection failure"); }; });
    await row("googledrive").getByRole("button", { name: "Connect", exact: true }).click();
    await row("googledrive").getByRole("button", { name: "Redo", exact: true }).waitFor();
    await page.setViewportSize({ width: 720, height: 520 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    return { passed: ["onboarding Connect automatically polls through pending", "failure shows Redo and repeats authorization", "success is green Connected with no Check button", "other apps stay usable", "immediate connection failure", "720px layout"] };
  } finally {
    await page.unroute(sourceRoute);
  }
}
