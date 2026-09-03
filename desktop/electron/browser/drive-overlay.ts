import { WebContentsView, type BrowserWindow } from "electron";

import { driveOverlayActive, inkySvg, type BrowserDriver } from "../../shared/index.js";

export const SCHOOL_PANE_RADIUS = 22;

export class DriveOverlay {
  readonly #view: WebContentsView;
  readonly #onTakeover: () => void;
  #bounds: Electron.Rectangle | null = null;
  #driver: BrowserDriver = "none";
  #ready = false;

  constructor(window: BrowserWindow, onTakeover: () => void) {
    this.#onTakeover = onTakeover;
    this.#view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.#view.setBackgroundColor("#00000000");
    this.#view.setBorderRadius(SCHOOL_PANE_RADIUS);
    this.#view.setVisible(false);
    window.contentView.addChildView(this.#view);
    this.#view.webContents.on("did-finish-load", () => {
      this.#ready = true;
      this.#push();
    });
    this.#view.webContents.on("console-message", (...args: readonly unknown[]) => {
      if (overlayConsoleMessage(args) === "studi-overlay:takeover") this.#onTakeover();
    });
    void this.#view.webContents.loadURL(overlayDataUrl());
  }

  layout(bounds: Electron.Rectangle | null): void {
    this.#bounds = bounds;
    if (!bounds) {
      this.#driver = "none";
      this.#view.setVisible(false);
      this.#push();
      return;
    }
    this.#view.setBounds(bounds);
    this.#view.setBorderRadius(SCHOOL_PANE_RADIUS);
    this.#sync();
  }

  setDriver(driver: BrowserDriver): void {
    if (this.#driver === driver) return;
    this.#driver = driver;
    this.#sync();
  }

  #sync(): void {
    const show = this.#bounds !== null && driveOverlayActive({ driver: this.#driver });
    this.#view.setVisible(show);
    this.#push();
  }

  #push(): void {
    if (!this.#ready || this.#view.webContents.isDestroyed()) return;
    const driver = driveOverlayActive({ driver: this.#driver }) ? this.#driver : "none";
    void this.#view.webContents.executeJavaScript(
      `document.documentElement.dataset.driver = ${JSON.stringify(driver)}; document.documentElement.dataset.prompt = "";`,
    );
  }
}

function overlayConsoleMessage(args: readonly unknown[]): string {
  const event = args[0];
  if (event && typeof event === "object" && "message" in event && typeof event.message === "string") {
    return event.message;
  }
  return typeof args[2] === "string" ? args[2] : "";
}

function overlayDataUrl(): string {
  const html = `<!DOCTYPE html>
<html lang="en" data-driver="none">
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  body { font-family: "Nunito Sans", Nunito, system-ui, sans-serif; color: #3b342c; }
  .round {
    position: absolute; inset: 0; pointer-events: none;
    border-radius: 22px 20px 24px 18px;
    box-shadow: 0 0 0 80px #fbf7ee;
  }
  .fade, .inky, .ask {
    opacity: 0;
    transition: opacity 400ms cubic-bezier(0.23, 1, 0.32, 1);
  }
  html[data-driver="inky"] .fade,
  html[data-driver="inky"] .inky { opacity: 1; }
  .fade {
    position: absolute;
    inset: 0;
    border-radius: 22px 20px 24px 18px;
    background:
      linear-gradient(to right, rgba(138,184,232,0.42), transparent 22%, transparent 78%, rgba(138,184,232,0.42)),
      linear-gradient(to bottom, rgba(138,184,232,0.28), transparent 18%, transparent 82%, rgba(138,184,232,0.28));
  }
  html[data-driver="inky"] .fade {
    animation: veil 2.4s ease-in-out infinite alternate;
  }
  .inky {
    position: absolute; right: 18px; bottom: 18px;
    display: flex; align-items: flex-end; gap: 8px;
    pointer-events: none;
  }
  .inky-mascot { display: block; width: 88px; height: 88px; line-height: 0; overflow: visible; pointer-events: none; }
  .inky-mascot svg { display: block; width: 100%; height: 100%; overflow: visible; }
  .inky-mascot .body { transform-box: view-box; transform-origin: 50% 88.333%; animation: inky-lean 2.4s ease-in-out infinite; }
  .inky-mascot .eyes.blink { transform-box: fill-box; transform-origin: center; animation: inky-blink 4.2s infinite; }
  .inky-mascot .extra.pointer { transform-box: view-box; transform-origin: 80% 65%; animation: inky-click .84s ease-in-out infinite; }
  .cap {
    pointer-events: auto;
    background: #8ab8e8; border: 2px solid #3b342c; color: #3b342c;
    border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;
    padding: 5px 11px; margin-bottom: 14px;
    font: inherit; font-size: 12px; font-weight: 800;
    box-shadow: 2px 2px 0 #3b342c;
    white-space: nowrap;
    cursor: pointer;
  }
  .cap:active { transform: translate(2px, 2px); box-shadow: none; }
  .ask {
    position: absolute; inset: 0;
    display: grid; place-items: center;
    pointer-events: none;
  }
  html[data-prompt="ask"] .ask { opacity: 1; pointer-events: auto; }
  .ask-card {
    width: min(280px, calc(100% - 36px));
    padding: 16px 16px 14px;
    border: 2px solid #3b342c;
    border-radius: 18px 13px 16px 14px;
    background: #fffdf6;
    box-shadow: 3px 3px 0 rgb(59 52 44 / 18%);
  }
  .ask-card strong {
    display: block;
    font-family: "Shantell Sans", "Patrick Hand", cursive;
    font-size: 1.15rem;
    letter-spacing: -.03em;
  }
  .ask-card p { margin: 6px 0 12px; font-size: 13px; font-weight: 700; color: #7d746a; }
  .ask-row { display: flex; flex-wrap: wrap; gap: 8px; }
  .ask-row button {
    min-height: 34px; padding: 6px 11px;
    border: 2px solid #3b342c; color: #3b342c;
    border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;
    font: inherit; font-size: 12px; font-weight: 800;
    box-shadow: 2px 2px 0 #3b342c;
    cursor: pointer;
  }
  .ask-row button:active { transform: translate(2px, 2px); box-shadow: none; }
  .ask-go { background: #8ab8e8; }
  .ask-keep { background: #fffdf6; }
  @keyframes veil { from { opacity: 0.55; } to { opacity: 1; } }
  @keyframes inky-blink { 0%, 91%, 100% { transform: scaleY(1); } 94% { transform: scaleY(0.08); } }
  @keyframes inky-lean { 0%, 100% { transform: rotate(-2deg) translateX(0); } 50% { transform: rotate(3deg) translateX(2px); } }
  @keyframes inky-click { 0%, 100% { transform: rotate(-8deg); } 50% { transform: rotate(6deg) translate(3px, 4px); } }
  @media (prefers-reduced-motion: reduce) {
    .fade, .inky-mascot .body, .inky-mascot .extra, .inky-mascot .eyes { animation: none !important; }
    html[data-driver="inky"] .fade { opacity: 0.85; }
  }
</style>
</head>
<body>
  <div class="round"></div>
  <div class="fade" data-action="ask"></div>
  <div class="ask">
    <div class="ask-card" role="dialog" aria-labelledby="ask-title" aria-describedby="ask-body">
      <strong id="ask-title">Want the page?</strong>
      <p id="ask-body">I'll pause so you can click.</p>
      <div class="ask-row">
        <button type="button" class="ask-go" data-action="takeover">Takeover</button>
        <button type="button" class="ask-keep" data-action="keep">Keep going</button>
      </div>
    </div>
  </div>
  <div class="inky">
    <button type="button" class="cap" data-action="ask">Takeover</button>
    <span class="inky-mascot" data-state="steering">${inkySvg("steering")}</span>
  </div>
  <script>
    document.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "takeover") {
        document.documentElement.dataset.prompt = "";
        console.info("studi-overlay:takeover");
        return;
      }
      if (action === "keep") {
        document.documentElement.dataset.prompt = "";
        return;
      }
      if (action === "ask") document.documentElement.dataset.prompt = "ask";
    });
  </script>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
