import { StudiApp } from "../app/StudiApp.js";
import { mountRenderer } from "../renderer.js";
import { installDevPreview } from "./fixtures.js";
import { PreviewGallery } from "./Gallery.js";
import { CharacterSheet } from "./CharacterSheet.js";
import { parsePreviewConfig } from "./scenarios.js";
import "./preview.css";

export function startPreview(): void {
  if (new URLSearchParams(location.search).get("preview") === "characters") {
    mountRenderer(<CharacterSheet />);
    return;
  }
  const config = parsePreviewConfig(location.search);
  if (!config) {
    mountRenderer(<PreviewGallery />);
    return;
  }
  installDevPreview();
  const desktop = new URLSearchParams(location.search).get("desktop");
  if (desktop === "win32" || desktop === "darwin") {
    document.documentElement.dataset.desktop = desktop;
    document.documentElement.dataset.previewDesktop = desktop;
  }
  mountRenderer(<StudiApp />);
  if (config.id.startsWith("updates-")) {
    const observer = new MutationObserver(() => {
      const button = document.querySelector<HTMLButtonElement>(".update-entry");
      if (!button) return;
      observer.disconnect();
      button.click();
    });
    observer.observe(document.getElementById("root")!, { childList: true, subtree: true });
  }
}
