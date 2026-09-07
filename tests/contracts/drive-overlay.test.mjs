import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { registerHooks } from "node:module";
import test from "node:test";
import { createContext, runInContext } from "node:vm";

test("takeover confirmation survives layout updates until a decision or browser ownership change", async () => {
  let view;
  let takeovers = 0;
  class OverlayView {
    webContents = new EventEmitter();
    visible = false;
    constructor() {
      view = this;
      this.webContents.isDestroyed = () => false;
      this.webContents.loadURL = async (url) => {
        const html = decodeURIComponent(url.slice(url.indexOf(",") + 1));
        this.dataset = { driver: "none", prompt: "" };
        this.context = createContext({
          document: {
            documentElement: { dataset: this.dataset },
            addEventListener: (name, callback) => { if (name === "click") this.clickHandler = callback; },
          },
          console: { info: (message) => this.webContents.emit("console-message", { message }) },
        });
        runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], this.context);
        this.webContents.emit("did-finish-load");
      };
      this.webContents.executeJavaScript = async (script) => runInContext(script, this.context);
    }
    setBackgroundColor() {}
    setBorderRadius() {}
    setBounds(bounds) { this.bounds = bounds; }
    setVisible(visible) { this.visible = visible; }
    click(action) { this.clickHandler({ target: { closest: () => ({ dataset: { action } }) } }); }
  }
  globalThis.studiOverlayTestView = OverlayView;
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "electron") return {
        url: "data:text/javascript,export const WebContentsView = globalThis.studiOverlayTestView;",
        shortCircuit: true,
      };
      return next(specifier, context);
    },
  });
  try {
    const { DriveOverlay } = await import("../../dist/electron/browser/drive-overlay.js");
    const overlay = new DriveOverlay({ contentView: { addChildView() {} } }, () => takeovers++);
    overlay.layout({ x: 0, y: 0, width: 600, height: 500 });
    overlay.setDriver("inky");
    view.click("ask");
    for (let i = 0; i < 50; i++) {
      overlay.layout({ x: i, y: 0, width: 600 + i, height: 500 });
      overlay.setDriver("inky");
      assert.equal(view.dataset.prompt, "ask");
      assert.equal(view.visible, true);
    }
    view.click("keep");
    assert.equal(view.dataset.prompt, "");
    assert.equal(takeovers, 0);
    view.click("ask");
    view.click("takeover");
    assert.equal(view.dataset.prompt, "");
    assert.equal(takeovers, 1);
    view.click("ask");
    overlay.setDriver("student");
    assert.equal(view.dataset.prompt, "");
    assert.equal(view.visible, false);
    overlay.setDriver("inky");
    assert.equal(view.dataset.prompt, "");
    view.click("ask");
    overlay.layout(null);
    assert.equal(view.dataset.prompt, "");
    assert.equal(view.visible, false);
  } finally {
    hooks.deregister();
    delete globalThis.studiOverlayTestView;
  }
});
