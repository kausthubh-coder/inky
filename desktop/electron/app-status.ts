import { app, nativeImage, type BrowserWindow } from "electron";

import { iconBadge, iconTooltip, type DotState, type IconBadge } from "../shared/characters/states.js";

const INK = "#2b2621";
const FILL: Record<Exclude<IconBadge["kind"], "none">, string> = {
  needs: "#e8735a",
  ready: "#3f9a5b",
  working: "#f7c948",
  scanning: "#f7c948",
};

/**
 * Shows what Dot is doing on the app icon: a Windows taskbar badge and progress bar,
 * the Mac Dock badge and the tray tooltip. Work to check stops counting once the student looks.
 */
export class AppStatusIcon {
  readonly #window: BrowserWindow;
  readonly #setTooltip: (text: string) => void;
  #state: DotState = "idle";
  #ready = 0;
  #seenReady = 0;
  #shown = "";

  constructor(window: BrowserWindow, setTooltip: (text: string) => void) {
    this.#window = window;
    this.#setTooltip = setTooltip;
    window.on("focus", this.#onFocus);
  }

  update(state: DotState, ready: number): void {
    if (this.#window.isDestroyed()) return;
    if (state === "needs" && this.#state !== "needs" && !this.#window.isFocused()) this.#window.flashFrame(true);
    this.#state = state;
    this.#ready = ready;
    this.#seenReady = this.#window.isFocused() ? ready : Math.min(this.#seenReady, ready);
    this.#window.setProgressBar(state === "working" || state === "steering" || state === "scanning" ? 2 : -1);
    const badge = iconBadge(state, ready > this.#seenReady ? ready : 0);
    const key = JSON.stringify(badge);
    if (key === this.#shown) return;
    this.#shown = key;
    this.#setTooltip(iconTooltip(badge));
    if (process.platform === "darwin") app.dock?.setBadge(badge.kind === "needs" ? "!" : badge.kind === "ready" ? String(badge.count) : "");
    if (process.platform === "win32") void this.#drawOverlay(badge, key);
  }

  dispose(): void {
    this.#window.removeListener("focus", this.#onFocus);
  }

  #onFocus = (): void => {
    this.#window.flashFrame(false);
    if (this.#ready > this.#seenReady) this.update(this.#state, this.#ready);
  };

  async #drawOverlay(badge: IconBadge, key: string): Promise<void> {
    if (badge.kind === "none") {
      this.#window.setOverlayIcon(null, "");
      return;
    }
    const png = await drawBadge(badge);
    if (key !== this.#shown || this.#window.isDestroyed()) return;
    this.#window.setOverlayIcon(nativeImage.createFromBuffer(png), iconTooltip(badge));
  }
}

async function drawBadge(badge: Exclude<IconBadge, { kind: "none" }>): Promise<Buffer> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(32, 32);
  const context = canvas.getContext("2d");
  context.beginPath();
  context.arc(16, 16, 14, 0, Math.PI * 2);
  context.fillStyle = FILL[badge.kind];
  context.fill();
  context.lineWidth = 2.5;
  context.strokeStyle = INK;
  context.stroke();
  const glyph = badge.kind === "needs" || badge.kind === "ready" ? "#ffffff" : INK;
  context.fillStyle = glyph;
  context.strokeStyle = glyph;
  context.lineCap = "round";
  if (badge.kind === "needs" || badge.kind === "ready") {
    const text = badge.kind === "needs" ? "!" : badge.count > 9 ? "9+" : String(badge.count);
    context.font = `bold ${text.length > 1 ? 15 : 19}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 16, 17);
  } else if (badge.kind === "working") {
    // A pencil leaning right: the body, then its point.
    context.save();
    context.translate(16, 16);
    context.rotate(Math.PI / 4);
    context.fillRect(-3, -9, 6, 12);
    context.beginPath();
    context.moveTo(-3, 4);
    context.lineTo(3, 4);
    context.lineTo(0, 9);
    context.closePath();
    context.fill();
    context.restore();
  } else {
    // A magnifier.
    context.lineWidth = 3;
    context.beginPath();
    context.arc(14, 14, 5.5, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(18.5, 18.5);
    context.lineTo(23, 23);
    context.stroke();
  }
  return canvas.toBuffer("image/png");
}
