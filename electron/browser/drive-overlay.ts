import { WebContentsView, type BrowserWindow } from "electron";

import { driveOverlayActive, inkySvg, type BrowserDriver } from "../../shared/index.js";

export const SCHOOL_PANE_RADIUS = 22;

export class DriveOverlay {
  readonly #view: WebContentsView;
  #bounds: Electron.Rectangle | null = null;
  #driver: BrowserDriver = "none";
  #studentHover = false;
  #ready = false;

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
    this.#view.setBorderRadius(SCHOOL_PANE_RADIUS);
    this.#view.setVisible(false);
    window.contentView.addChildView(this.#view);
    this.#view.webContents.on("did-finish-load", () => {
      this.#ready = true;
      this.#push();
    });
    void this.#view.webContents.loadURL(overlayDataUrl());
  }

  layout(bounds: Electron.Rectangle | null): void {
    this.#bounds = bounds;
    if (!bounds) {
      this.#driver = "none";
      this.#studentHover = false;
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

  setStudentHover(hovering: boolean): void {
    if (this.#studentHover === hovering) return;
    this.#studentHover = hovering;
    this.#sync();
  }

  #sync(): void {
    const show = this.#bounds !== null && driveOverlayActive({
      driver: this.#driver,
      studentHover: this.#studentHover,
    });
    this.#view.setVisible(show);
    this.#push();
  }

  #push(): void {
    if (!this.#ready || this.#view.webContents.isDestroyed()) return;
    const driver = driveOverlayActive({ driver: this.#driver, studentHover: this.#studentHover })
      ? this.#driver
      : "none";
    void this.#view.webContents.executeJavaScript(
      `document.documentElement.dataset.driver = ${JSON.stringify(driver)}`,
    );
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
  .round {
    position: absolute; inset: 0; pointer-events: none;
    border-radius: 22px 20px 24px 18px;
    box-shadow: 0 0 0 80px #fbf7ee;
  }
  .fade, .inky {
    opacity: 0;
    pointer-events: none;
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
  }
  .inky-mascot { display: block; width: 88px; height: 88px; line-height: 0; overflow: visible; }
  .inky-mascot svg { display: block; width: 100%; height: 100%; overflow: visible; }
  .inky-mascot .body { transform-box: view-box; transform-origin: 50% 88.333%; animation: inky-lean 2.4s ease-in-out infinite; }
  .inky-mascot .eyes.blink { transform-box: fill-box; transform-origin: center; animation: inky-blink 4.2s infinite; }
  .inky-mascot .extra.pointer { transform-box: view-box; transform-origin: 80% 65%; animation: inky-click .84s ease-in-out infinite; }
  .cap {
    background: #8ab8e8; border: 2px solid #3b342c; color: #3b342c;
    border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;
    padding: 5px 11px; margin-bottom: 14px;
    font-size: 12px; font-weight: 800;
    box-shadow: 2px 2px 0 #3b342c;
    white-space: nowrap;
  }
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
  <div class="fade"></div>
  <div class="inky">
    <span class="cap">Inky's clicking</span>
    <span class="inky-mascot" data-state="steering">${inkySvg("steering")}</span>
  </div>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
