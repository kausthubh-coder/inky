import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { InMemoryCredentialStore, fauxProvider } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import { PiAgentRuntime } from "../../dist/electron/agent/runtime.js";
import { BrowserController } from "../../dist/electron/browser/controller.js";
import { createBrowserTools } from "../../dist/electron/browser/tools.js";
import { BrowserSnapshotSchema } from "../../dist/shared/index.js";

test("browser snapshot is bounded and page revisions invalidate old refs", async () => {
  const target = fakeTarget([
    ...Array.from({ length: 84 }, (_, index) => axNode(index + 1, "button", `Action ${index + 1}`)),
    axNode(900, "StaticText", "Page summary"),
  ]);
  const controller = new BrowserController(target);
  const first = BrowserSnapshotSchema.parse(await controller.snapshot());
  assert.equal(first.elements.length, 80);
  assert.equal(first.truncated, true);
  assert.equal(first.elements[0].ref, `r${first.revision}:1`);
  assert.match(first.text, /Page summary/);

  controller.pageChanged();
  await assert.rejects(controller.click(first.elements[0].ref), /Stale or unknown browser ref/);
  const second = BrowserSnapshotSchema.parse(await controller.snapshot());
  assert.ok(second.revision > first.revision);
  assert.equal(second.elements[0].ref, `r${second.revision}:1`);
});

test("ordinary click refuses submission while explicit submit can activate it", async () => {
  const target = fakeTarget([axNode(1, "button", "Submit assignment")], {
    inspection: { connected: true, disabled: false, submission: true, label: "Submit assignment" },
  });
  const controller = new BrowserController(target);
  const snapshot = await controller.snapshot();
  const ref = snapshot.elements[0].ref;

  await assert.rejects(controller.click(ref), /Ordinary click cannot activate a submission control/);
  const afterSubmit = await controller.click(ref, true);
  assert.ok(afterSubmit.revision > snapshot.revision);
  assert.equal(target.clicks, 1);
});

test("a destructive action can uniquely re-identify its control in a fresh evidence snapshot", async () => {
  const target = fakeTarget([axNode(1, "button", "Submit assignment")], {
    inspection: { connected: true, disabled: false, submission: true, label: "Submit assignment" },
  });
  const controller = new BrowserController(target);
  const first = await controller.snapshot();
  const refreshed = await controller.refreshRef(first.elements[0].ref);
  assert.ok(refreshed.snapshot.revision > first.revision);
  assert.notEqual(refreshed.ref, first.elements[0].ref);
  await assert.rejects(controller.click(first.elements[0].ref, true), /Stale or unknown browser ref/);
  await controller.click(refreshed.ref, true);
  assert.equal(target.clicks, 1);
});

test("Enter cannot bypass the separate submission action", async () => {
  const target = fakeTarget([axNode(1, "textbox", "Answer")], { enterSubmission: true });
  const controller = new BrowserController(target);
  await assert.rejects(controller.press("Enter"), /Enter could submit the current form/);
  assert.equal(target.keyEvents, 0);
});

test("browser tools expose only named safe operations and URL validation rejects credentials", async () => {
  const target = fakeTarget([axNode(1, "link", "Course")]);
  const controller = new BrowserController(target);
  assert.deepEqual(createBrowserTools(controller).map((tool) => tool.name), [
    "browser_snapshot",
    "browser_navigate",
    "browser_click",
    "browser_type",
    "browser_select",
    "browser_press",
    "browser_wait",
    "browser_submit",
  ]);
  await assert.rejects(controller.navigate("javascript:alert(1)"), /HTTP or HTTPS/);
  await assert.rejects(controller.navigate("https://student:secret@school.example"), /cannot contain credentials/);
  const snapshot = await controller.navigate("school.example.edu/course");
  assert.equal(snapshot.url, "https://school.example.edu/course");
});

test("real Pi session registers the Studi browser tools and no built-in coding tools", async () => {
  const root = resolve(await mkdtemp(join(tmpdir(), "studi-wp04-agent-tools-")));
  try {
    const models = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
    });
    const faux = fauxProvider({ provider: "studi-browser-faux", api: "studi-browser-faux" });
    models.registerNativeProvider(faux.provider);
    const controller = new BrowserController(fakeTarget([axNode(1, "link", "Course")]));
    const runtime = await PiAgentRuntime.create({
      cwd: root,
      agentDir: join(root, "pi"),
      modelRuntime: models,
      model: faux.getModel(),
      browserController: controller,
    });
    const session = await runtime.createSession();
    try {
      assert.deepEqual(session.toolNames, [
        "browser_snapshot",
        "browser_navigate",
        "browser_click",
        "browser_type",
        "browser_select",
        "browser_press",
        "browser_wait",
        "browser_submit",
      ]);
    } finally {
      session.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    assert.equal(existsSync(root), false);
  }
});

function axNode(backendDOMNodeId, role, name) {
  return {
    backendDOMNodeId,
    role: { value: role },
    name: { value: name },
  };
}

function fakeTarget(nodes, options = {}) {
  let attached = false;
  let url = "https://school.example.edu/";
  const target = {
    clicks: 0,
    keyEvents: 0,
    debugger: {
      isAttached: () => attached,
      attach: () => { attached = true; },
      on: () => {},
      sendCommand: async (method, params = {}) => {
        if (method === "Accessibility.getFullAXTree") return { nodes };
        if (method === "DOM.resolveNode") return { object: { objectId: "element-1" } };
        if (method === "Runtime.evaluate") return { result: { value: options.enterSubmission === true } };
        if (method === "Input.dispatchKeyEvent") {
          target.keyEvents += 1;
          return {};
        }
        if (method === "Runtime.callFunctionOn") {
          if (String(params.functionDeclaration).includes("submission:")) {
            return { result: { value: options.inspection ?? { connected: true, disabled: false, submission: false, label: "" } } };
          }
          if (String(params.functionDeclaration).includes("this.click()")) target.clicks += 1;
          return { result: { value: true } };
        }
        return {};
      },
    },
    getURL: () => url,
    getTitle: () => "School",
    loadURL: async (nextUrl) => { url = nextUrl; },
  };
  return target;
}
