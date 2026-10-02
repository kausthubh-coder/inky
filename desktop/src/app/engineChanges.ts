import type { EngineTopic } from "../../shared/index.js";
import { studiApi } from "./studiApi.js";

/** Re-read when the engine says one of these topics changed, plus a slow safety poll. Returns the cleanup. */
export function onEngineChange(topics: readonly EngineTopic[], read: () => void, fallbackMs = 10_000): () => void {
  const stop = studiApi()?.onEngineChanged?.((changed) => {
    if (changed.some((topic) => topics.includes(topic))) read();
  });
  const timer = window.setInterval(read, fallbackMs);
  return () => {
    stop?.();
    window.clearInterval(timer);
  };
}
