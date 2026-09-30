import { PiAgentRuntime } from "../../dist/electron/agent/runtime.js";
import { createE2eRuntime as createScriptedRuntime } from "./scripted-runtime.mjs";

// Keep setup and focused detail checks deterministic; homework uses the
// production Pi runtime, tools, prompt, browser and student permission rules.
export async function createE2eRuntime(options) {
  const scripted = await createScriptedRuntime(options);
  const live = await PiAgentRuntime.create(options);
  live.selectModel("openai-codex", "gpt-6-sol");
  live.setReasoningEffort("high");
  return new Proxy(live, {
    get(target, property) {
      if (property === "createScanSession") return scripted.createScanSession.bind(scripted);
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
