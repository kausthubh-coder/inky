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

test("browser snapshot is bounded, preserves refs across observations, and resets on navigation", async () => {
  const target = fakeTarget([
    ...Array.from({ length: 84 }, (_, index) => axNode(index + 1, "button", `Action ${index + 1}`)),
    axNode(900, "StaticText", "Page summary"),
  ]);
  const controller = new BrowserController(target);
  const first = BrowserSnapshotSchema.parse(await controller.snapshot());
  assert.equal(first.elements.length, 80);
  assert.equal(first.truncated, true);
  assert.equal(first.elements[0].ref, `r${first.revision}:1`);
  assert.equal(first.nextOffset, 80);
  const continuation = await controller.snapshot({offset:first.nextOffset});
  assert.match(continuation.text, /Page summary/);
  assert.equal(continuation.truncated, false);
  assert.equal(continuation.revision, first.revision);
  const repeated = await controller.snapshot();
  assert.equal(repeated.elements[0].ref, first.elements[0].ref);

  controller.pageChanged();
  await assert.rejects(controller.click(first.elements[0].ref), /Stale or unknown browser ref/);
  const second = BrowserSnapshotSchema.parse(await controller.snapshot());
  assert.ok(second.revision > first.revision);
  assert.equal(second.elements[0].ref, `r${second.revision}:1`);
});

test("browser snapshots expose observed HTTP link destinations for assignment identity", async () => {
  const href = "https://school.example.edu/mod/assign/view.php?id=1360376";
  const target = fakeTarget([
    { ...axNode(1, "link", "Homework 1"), properties: [{ name: "url", value: { value: href } }] },
    { ...axNode(2, "link", "Run script"), properties: [{ name: "url", value: { value: "javascript:void(0)" } }] },
  ]);
  const snapshot = BrowserSnapshotSchema.parse(await new BrowserController(target).snapshot());
  assert.equal(snapshot.elements[0].href, href);
  assert.equal(snapshot.elements[1].href, undefined);
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
  assert.equal(afterSubmit.revision, snapshot.revision);
  assert.equal(target.clicks, 1);
});

test("read-only school navigation accepts observed links but rejects guessed LMS routes", async () => {
  const href = "https://school.example.edu/classroom/programming";
  const target = fakeTarget([
    { ...axNode(1, "link", "Programming in C"), properties: [{ name: "url", value: { value: href } }] },
  ]);
  const controller = new BrowserController(target);
  const navigate = createBrowserTools(controller, { readOnly: true }).find(tool => tool.name === "browser_navigate");
  await controller.snapshot();
  await assert.rejects(navigate.execute("guessed", { url: "https://school.example.edu/courses/programming" }), /not observed/);
  await navigate.execute("observed", { url: href });
  assert.equal(controller.state.url, href);
});

test("a Submit Lab 3 navigation link opens without submission permission", async () => {
  const target = fakeTarget([axNode(1, "link", "Submit Lab 3")], {
    inspection: { connected: true, disabled: false, submission: false, label: "Submit Lab 3" },
  });
  const controller = new BrowserController(target);
  const snapshot = await controller.snapshot();
  await controller.click(snapshot.elements[0].ref, false, true);
  assert.equal(target.clicks, 1);
});

test("recording reuses a full observation without a new AX request or filtered search", async () => {
  const target = fakeTarget([axNode(1, "link", "Lab 3")]);
  const controller = new BrowserController(target);
  await controller.snapshot({ search: "Lab" });
  await assert.rejects(controller.evidenceSnapshot(), /unfiltered/);
  const full = await controller.snapshot();
  const calls = target.axCalls;
  const evidence = await controller.evidenceSnapshot([full.elements[0].ref]);
  assert.equal(evidence.elements[0].ref, full.elements[0].ref);
  assert.equal(target.axCalls, calls);
});

test("diff snapshots show only new page content and still require full evidence", async () => {
  const nodes = [axNode(1, "link", "Week 1")];
  const controller = new BrowserController(fakeTarget(nodes));
  await controller.snapshot({ mode: "full" });
  nodes.push(axNode(2, "StaticText", "Week 2 revealed"));
  const diff = await controller.snapshot({ mode: "diff" });
  assert.match(diff.text, /Week 2 revealed/);
  assert.doesNotMatch(diff.text, /Week 1/);
  await assert.rejects(controller.evidenceSnapshot(), /full browser_snapshot/);
});

test("a plain re-read of the same page returns only its changes but keeps the full page as evidence", async () => {
  const nodes = [axNode(1, "link", "Week 1")];
  const controller = new BrowserController(fakeTarget(nodes));
  await controller.snapshot({ mode: "auto" });
  const unchanged = await controller.snapshot({ mode: "auto" });
  assert.equal(unchanged.text, "No change since your last read of this page.");
  assert.match((await controller.snapshot()).text, /Week 1/, "Studi's own reads always get the whole page");
  nodes.push(axNode(2, "StaticText", "Week 2 revealed"));
  const changed = await controller.snapshot({ mode: "auto" });
  assert.match(changed.text, /Week 2 revealed/);
  assert.doesNotMatch(changed.text, /Week 1/);
  assert.match((await controller.evidenceSnapshot()).text, /Week 1/, "recording still sees the whole page");
  assert.match((await controller.snapshot({ mode: "full" })).text, /Week 1/);
});

test("browser_rows reads 130 activity rows in three pages and iframe text appears in snapshot", async () => {
  const rows = Array.from({ length: 130 }, (_, index) => ({ cells: [`Activity ${index + 1}`, "Oct 7"], href: `https://school.example.edu/mod/assign/view.php?id=${index + 1}` }));
  const target = fakeTarget([axNode(1, "button", "Show more")], {
    rows, frame: { id: "quiz-frame", nodes: [axNode(2, "StaticText", "Quiz instructions inside frame")] },
  });
  const controller = new BrowserController(target);
  let offset = 0;
  const actual = [];
  do {
    const page = await controller.rows("tr.activity", offset);
    actual.push(...page.rows);
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(actual.length, 130);
  assert.ok(actual.every(row => row.ref && row.href));
  assert.equal(target.rowCalls, 3);
  assert.match((await controller.snapshot()).text, /Quiz instructions inside frame/);
});

test("a destructive action can uniquely re-identify its control in a fresh evidence snapshot", async () => {
  const target = fakeTarget([axNode(1, "button", "Submit assignment")], {
    inspection: { connected: true, disabled: false, submission: true, label: "Submit assignment" },
  });
  const controller = new BrowserController(target);
  const first = await controller.snapshot();
  const refreshed = await controller.refreshRef(first.elements[0].ref);
  assert.equal(refreshed.snapshot.revision, first.revision);
  assert.equal(refreshed.ref, first.elements[0].ref);
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
    "browser_wait", "browser_scroll", "browser_rows", "browser_link", "read_document", "browser_screenshot",
    "browser_submit",
  ]);
  await assert.rejects(controller.navigate("javascript:alert(1)"), /HTTP or HTTPS/);
  await assert.rejects(controller.navigate("https://student:secret@school.example"), /cannot contain credentials/);
  const snapshot = await controller.navigate("school.example.edu/course");
  assert.equal(snapshot.url, "https://school.example.edu/course");
});

test("browser upload accepts only a current file-input ref", async () => {
  const target = fakeTarget([axNode(7, "button", "Choose files")], {
    uploadInspection: { connected: true, disabled: false, fileInput: true },
  });
  const controller = new BrowserController(target);
  const snapshot = await controller.snapshot();
  await controller.upload(snapshot.elements[0].ref, [resolve("answer.jpg")]);
  assert.deepEqual(target.uploadedFiles, [resolve("answer.jpg")]);
  assert.equal(target.uploadBackendNodeId, 7);
  await assert.rejects(controller.upload(snapshot.elements[0].ref, []), /between 1 and 12/);
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
        "browser_wait", "browser_scroll", "browser_rows", "browser_link", "read_document", "browser_screenshot",
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

test("an unresponsive PDF observation returns a recovery error instead of hanging the worker", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const target = fakeTarget([]);
  target.debugger.sendCommand = async () => new Promise(() => {});
  const browser = new BrowserController(target);
  const pending = browser.snapshot();
  t.mock.timers.tick(10_000);
  await assert.rejects(pending, /timed out.*screenshot.*download/);
  target.loadURL = async () => new Promise(() => {});
  const navigation = browser.navigate("https://school.example.edu/file.pdf");
  t.mock.timers.tick(15_000);
  await assert.rejects(navigation, /Navigation did not finish.*browser_download/);
});

function fakeTarget(nodes, options = {}) {
  let attached = false;
  let url = "https://school.example.edu/";
  const target = {
    clicks: 0,
    axCalls: 0,
    rowCalls: 0,
    keyEvents: 0,
    uploadedFiles: [],
    uploadBackendNodeId: null,
    debugger: {
      isAttached: () => attached,
      attach: () => { attached = true; },
      on: () => {},
      sendCommand: async (method, params = {}) => {
        if (method === "Accessibility.getFullAXTree") { target.axCalls++; return { nodes: params.frameId && params.frameId === options.frame?.id ? options.frame.nodes : nodes }; }
        if (method === "Page.getFrameTree") return options.frame ? { frameTree: { frame: { id: "main" }, childFrames: [{ frame: { id: options.frame.id, url: "https://school.example.edu/quiz" } }] } } : {};
        if (method === "DOM.resolveNode") return { object: { objectId: "element-1" } };
        if (method === "Runtime.evaluate") {
          if (String(params.expression).includes("querySelectorAll")) {
            target.rowCalls++;
            const match = /\.slice\((\d+),(\d+)\)/.exec(String(params.expression));
            return { result: { value: { total: options.rows?.length ?? 0,
              rows: (options.rows ?? []).slice(Number(match?.[1] ?? 0), Number(match?.[2] ?? 50)) } } };
          }
          return { result: { value: options.enterSubmission === true } };
        }
        if (method === "DOM.getDocument") return { root: { nodeId: 1 } };
        if (method === "DOM.querySelectorAll") return { nodeIds: (options.rows ?? []).map((_, index) => index + 100) };
        if (method === "DOM.querySelector") return { nodeId: Number(params.nodeId) + 1000 };
        if (method === "DOM.describeNode") return { node: { backendNodeId: Number(params.nodeId) + 1000 } };
        if (method === "Input.dispatchKeyEvent") {
          target.keyEvents += 1;
          return {};
        }
        if (method === "DOM.setFileInputFiles") {
          target.uploadedFiles = params.files;
          target.uploadBackendNodeId = params.backendNodeId;
          return {};
        }
        if (method === "Runtime.callFunctionOn") {
          if (String(params.functionDeclaration).includes("submission:")) {
            return { result: { value: options.inspection ?? { connected: true, disabled: false, submission: false, label: "" } } };
          }
          if (String(params.functionDeclaration).includes("this.click()")) target.clicks += 1;
          if (String(params.functionDeclaration).includes("fileInput:")) {
            return { result: { value: options.uploadInspection ?? { connected: true, disabled: false, fileInput: false } } };
          }
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


test("explicit draft-save buttons can post a form while final and ambiguous submits stay gated", async () => {
  for (const label of ["Save draft", "Save as draft", "Submit assignment", "Continue", "Post reply", "Publish"]) {
    const target = fakeTarget([axNode(1, "button", label)], {
      inspection: { connected: true, disabled: false, submission: true, label },
    });
    const controller = new BrowserController(target);
    const snapshot = await controller.snapshot();
    if (label.startsWith("Save")) {
      await controller.click(snapshot.elements[0].ref);
      assert.equal(target.clicks, 1);
    } else {
      await assert.rejects(controller.click(snapshot.elements[0].ref), /submission control/);
      assert.equal(target.clicks, 0);
    }
  }
});

test("read-only scan tools omit submission and restrict answer fields and keyboard activation", async () => {
  for (const label of ["Save draft", "Save as draft", "Submit assignment", "Mark as done", "Course details"]) {
    const target = fakeTarget([axNode(1, "button", label)], { inspection: { connected: true, disabled: false, submission: label.startsWith("Save"), label } });
    const controller = new BrowserController(target);
    const tools = createBrowserTools(controller, { readOnly: true });
    assert.equal(tools.some(tool => tool.name === "browser_submit"), false);
    const snapshot = await controller.snapshot();
    const click = () => tools.find(tool => tool.name === "browser_click").execute("scan", { ref: snapshot.elements[0].ref });
    if (["Submit assignment", "Continue", "Mark as done"].includes(label)) {
      await assert.rejects(click(), error => {
        const summary = JSON.parse(error.message);
        assert.equal(summary.status, "failed");
        assert.match(summary.error, /submission control/);
        return true;
      });
      assert.equal(target.clicks, 0);
    }
    else { await click(); assert.equal(target.clicks, 1); }
    const current = await controller.snapshot();
    await assert.rejects(controller.type(current.elements[0].ref, "answer", true), /only identified search or filter/);
    await assert.rejects(controller.select(current.elements[0].ref, "answer", true), /only identified search or filter/);
    await assert.rejects(controller.press("Enter", true), /read-only/);
    assert.equal(target.keyEvents, 0);
  }
});
