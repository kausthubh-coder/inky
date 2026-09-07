import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeDiagnostics } from "../../dist/electron/telemetry/runtime-diagnostics.js";

test("runtime diagnostics retain complete messages and tools, link model calls, and avoid streaming duplicates", () => {
  const events = [];
  const diagnostics = new RuntimeDiagnostics("scan-session", event => events.push(event));
  diagnostics.accept({ type: "agent_start" });
  diagnostics.providerRequest("gpt-6-astra", "openai-codex", { instructions: "Scan my school", input: [{ role: "user", content: "Find Math homework" }] });
  diagnostics.accept({ type: "message_update" });
  diagnostics.accept({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "browser_type", args: { ref: "r1", text: "Exact answer" } });
  diagnostics.accept({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "browser_type", isError: false, result: { text: "School page" } });
  diagnostics.accept({ type: "message_end", message: {
    role: "assistant", content: [{ type: "text", text: "Your Math homework is due Friday." }], stopReason: "stop",
    usage: { input: 42, output: 11, cacheRead: 3, cacheWrite: 0, cost: { total: 0.02 } },
  } });
  const generation = events.find(event => event.kind === "generation");
  assert.equal(generation.payload.$ai_input[0].content, "Scan my school");
  assert.equal(generation.payload.$ai_input[1].content, "Find Math homework");
  assert.equal(generation.payload.$ai_output_choices[0].content[0].text, "Your Math homework is due Friday.");
  assert.equal(generation.payload.$ai_trace_id, events[0].run_id);
  assert.equal(generation.payload.$ai_span_id, events.find(event => event.kind === "provider_request").payload.span_id);
  assert.equal(generation.payload.$ai_input_tokens, 42);
  assert.equal(generation.payload.$ai_total_cost_usd, 0.02);
  assert.ok(generation.payload.$ai_latency >= 0);
  assert.ok(generation.payload.$ai_time_to_first_token >= 0);
  assert.equal(events.some(event => event.kind === "message_update"), false);
  assert.equal(events.find(event => event.kind === "tool_execution_start").payload.args.text, "Exact answer");
  assert.equal(events.find(event => event.kind === "tool_execution_end").payload.result.text, "School page");
  diagnostics.accept({ type: "agent_start" });
  assert.notEqual(events.at(-1).run_id, generation.run_id);
  const broken = new RuntimeDiagnostics("broken", () => { throw new Error("offline"); });
  assert.doesNotThrow(() => broken.accept({ type: "agent_start" }));
});
