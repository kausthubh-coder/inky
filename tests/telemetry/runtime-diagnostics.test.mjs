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
  assert.equal(generation.payload.$ai_cache_reporting_exclusive, true);
  assert.equal(generation.payload.$ai_cache_read_input_tokens, 3);
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

test("each tool call becomes one flat step naming the session's purpose, page and error", () => {
  const events = [];
  const diagnostics = new RuntimeDiagnostics("homework-session", event => events.push(event), { purpose: "assignment", assignmentId: "hw-12" });
  diagnostics.accept({ type: "tool_execution_start", toolCallId: "a", toolName: "browser_snapshot", args: {} });
  diagnostics.accept({ type: "tool_execution_end", toolCallId: "a", toolName: "browser_snapshot", isError: false, result: { details: { url: "https://webassign.net/hw12", title: "HW 12" } } });
  diagnostics.accept({ type: "tool_execution_start", toolCallId: "b", toolName: "browser_click", args: {} });
  diagnostics.accept({ type: "tool_execution_end", toolCallId: "b", toolName: "browser_click", isError: true, result: { content: [{ type: "text", text: "Element is disabled" }] } });
  const steps = events.filter(event => event.kind === "step").map(event => event.payload);
  assert.equal(steps.length, 2);
  assert.deepEqual({ ...steps[0], duration_ms: 0 }, { purpose: "assignment", session_id: "homework-session", assignment_id: "hw-12", tool: "browser_snapshot", outcome: "succeeded", duration_ms: 0, url: "https://webassign.net/hw12", page_title: "HW 12" });
  assert.equal(steps[1].outcome, "failed");
  assert.equal(steps[1].error, "Element is disabled");
});
