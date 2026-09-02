import type { StudiApi } from "../../shared/index.js";

declare global {
  interface Window {
    readonly studi?: StudiApi;
  }
}

export {};
