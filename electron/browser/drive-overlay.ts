import { WebContentsView, type BrowserWindow } from "electron";

import { inkySvg, type BrowserDriver } from "../../shared/index.js";

const FADE_MS = 400;

export class DriveOverlay {
  readonly #view: WebContentsView;
  #driver: BrowserDriver = "none";
  #ready = false;
  #hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(window: BrowserWindow) {
    this.#view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.#view.setBackgroundColor("#00000000");
    this.#view.setVisible(false);
    window.contentView.addChildView(this.#view);
    this.#view.webContents.on("did-finish-load", () => {
      this.#ready = true;
      this.#push();
    });
    void this.#view.webContents.loadURL(overlayDataUrl());
  }

  layout(bounds: Electron.Rectangle | null): void {
    if (!bounds) {
      this.#clearHide();
      this.#driver = "none";
      this.#view.setVisible(false);
      this.#push();
      return;
    }
    this.#view.setBounds(bounds);
  }

  setDriver(driver: BrowserDriver): void {
    if (this.#driver === driver) return;
    this.#driver = driver;
    this.#push();
    if (driver === "inky") {
      this.#clearHide();
      this.#view.setVisible(true);
      return;
    }
    this.#clearHide();
    this.#hideTimer = setTimeout(() => {
      if (this.#driver !== "inky") this.#view.setVisible(false);
    }, FADE_MS);
  }

  #push(): void {
    if (!this.#ready || this.#view.webContents.isDestroyed()) return;
    void this.#view.webContents.executeJavaScript(
      `document.documentElement.dataset.driver = ${JSON.stringify(this.#driver)}`,
    );
  }

  #clearHide(): void {
    if (!this.#hideTimer) return;
    clearTimeout(this.#hideTimer);
    this.#hideTimer = null;
  }
}

function overlayDataUrl(): string {
  const html = `<!DOCTYPE html>
<html lang="en" data-driver="none">
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  body { font-family: "Nunito Sans", Nunito, system-ui, sans-serif; }
  .fade, .corners, .inky {
    opacity: 0;
    pointer-events: none;
    transition: opacity 400ms cubic-bezier(0.23, 1, 0.32, 1);
  }
  html[data-driver="inky"] .fade,
  html[data-driver="inky"] .corners,
  html[data-driver="inky"] .inky { opacity: 1; }
  .fade { position: absolute; inset: 0; }
  .fade::before, .fade::after { content: ""; position: absolute; inset: 0; }
  .fade::before {
    background:
      linear-gradient(to right, rgba(138,184,232,0.72), rgba(138,184,232,0.18) 18%, transparent 32%, transparent 68%, rgba(138,184,232,0.18) 82%, rgba(138,184,232,0.72)),
      linear-gradient(to bottom, rgba(59,52,44,0.18), transparent 22%, transparent 78%, rgba(59,52,44,0.16));
    animation: veil 1.25s ease-in-out infinite;
  }
  .fade::after {
    inset: 7px;
    border: 4px solid rgba(138,184,232,0.95);
    animation: stroke 1.25s ease-in-out infinite;
  }
  .corners { position: absolute; inset: 10px; }
  .corners b {
    position: absolute; width: 28px; height: 28px;
    border: 4px solid #8ab8e8;
    animation: corner 1.25s ease-in-out infinite;
  }
  .corners b:nth-child(1) { top: 0; left: 0; border-right: 0; border-bottom: 0; }
  .corners b:nth-child(2) { top: 0; right: 0; border-left: 0; border-bottom: 0; }
  .corners b:nth-child(3) { bottom: 0; left: 0; border-right: 0; border-top: 0; }
  .corners b:nth-child(4) { bottom: 0; right: 0; border-left: 0; border-top: 0; }
  .inky {
    position: absolute; right: 12px; bottom: 12px;
    display: flex; align-items: flex-end; gap: 8px;
  }
  .inky span.mascot { display: block; width: 88px; height: 88px; line-height: 0; }
  .inky span.mascot svg { display: block; width: 100%; height: 100%; overflow: visible; }
  .inky .body, .inky .eyes, .inky .extra, .inky .mouth { transform-box: fill-box; transform-origin: center; }
  .inky .eyes.blink { animation: blink 4.2s infinite; }
  .inky .body { animation: lean 2.2s ease-in-out infinite; }
  .inky .extra.pointer { transform-box: view-box; transform-origin: 96px 78px; animation: click 0.85s ease-in-out infinite; }
  .cap {
    background: #8ab8e8; border: 2px solid #3b342c; color: #3b342c;
    border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;
    padding: 5px 11px; margin-bottom: 10px;
    font-size: 12px; font-weight: 800;
    box-shadow: 2px 2px 0 #3b342c;
    animation: cap 1.25s ease-in-out infinite;
  }
  @keyframes veil { 0%, 100% { opacity: 0.42; } 50% { opacity: 1; } }
  @keyframes stroke {
    0%, 100% { opacity: 0.55; box-shadow: inset 0 0 0 2px rgba(59,52,44,0.28), 0 0 0 4px rgba(138,184,232,0.12); }
    50% { opacity: 1; box-shadow: inset 0 0 0 3px rgba(59,52,44,0.7), 0 0 0 14px rgba(138,184,232,0.45); }
  }
  @keyframes corner { 0%, 100% { opacity: 0.35; transform: scale(0.86); } 50% { opacity: 1; transform: scale(1.08); } }
  @keyframes blink { 0%, 91%, 100% { transform: scaleY(1); } 94% { transform: scaleY(0.08); } }
  @keyframes lean { 0%, 100% { transform: rotate(-2deg); } 50% { transform: rotate(3deg) translateX(2px); } }
  @keyframes click { 0%, 100% { transform: rotate(-8deg); } 45% { transform: rotate(6deg) translate(3px, 4px); } 60% { transform: rotate(-2deg); } }
  @keyframes cap { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
  @media (prefers-reduced-motion: reduce) {
    .fade::before, .fade::after, .corners b, .inky .body, .inky .extra, .inky .eyes, .cap { animation: none !important; }
    html[data-driver="inky"] .fade, html[data-driver="inky"] .corners { opacity: 0.85; }
  }
</style>
</head>
<body>
  <div class="fade"></div>
  <div class="corners"><b></b><b></b><b></b><b></b></div>
  <div class="inky">
    <span class="mascot">${inkySvg("steering")}</span>
    <span class="cap">Inky's clicking</span>
  </div>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
