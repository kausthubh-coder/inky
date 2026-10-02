import type { StudiRendererApi } from "../../shared/index.js";

// Screens reach the engine through here, so the tour can lay its practice class over the real API.
let override: StudiRendererApi | null = null;

export function studiApi(): StudiRendererApi | undefined {
  return override ?? window.studi;
}

export function overrideStudiApi(api: StudiRendererApi | null): void {
  override = api;
}
