import type { BrowserWindowConstructorOptions } from "electron";

// Native buttons preserve snapping, accessibility, and OS window behavior.
// https://www.electronjs.org/docs/latest/tutorial/custom-title-bar
export const windowChromeOptions = {
  titleBarStyle: "hidden",
  titleBarOverlay: { color: "#fffdf6", symbolColor: "#3b342c", height: 54 },
  ...(process.platform === "darwin" ? { trafficLightPosition: { x: 16, y: 19 } } : {}),
} satisfies BrowserWindowConstructorOptions;
