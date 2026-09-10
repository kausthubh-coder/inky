import { StudiApp } from "../app/StudiApp.js";
import { mountRenderer } from "../renderer.js";
import { installDevPreview } from "./fixtures.js";
import { PreviewGallery } from "./Gallery.js";
import { parsePreviewConfig } from "./scenarios.js";

export function startPreview(): void {
  const config = parsePreviewConfig(location.search);
  if (!config) {
    mountRenderer(<PreviewGallery />);
    return;
  }
  installDevPreview();
  mountRenderer(<StudiApp />);
}
