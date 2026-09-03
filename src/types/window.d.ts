import type { StudiRendererApi } from "../../shared/index.js";

declare global {
  interface Window {
    readonly studi?: StudiRendererApi;
  }
}

export {};
