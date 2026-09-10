import "@fontsource/nunito-sans/400.css";
import "@fontsource/nunito-sans/700.css";
import "@fontsource/shantell-sans/600.css";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./app/app.css";
import "./app/chat.css";
import "./app/workspace.css";

export function mountRenderer(content: ReactNode): void {
  if (navigator.userAgent.includes("Electron/")) {
    document.documentElement.dataset.desktop = navigator.userAgent.includes("Macintosh") ? "darwin" : "win32";
  }
  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Studi renderer root is missing");
  createRoot(rootElement).render(<StrictMode>{content}</StrictMode>);
}
