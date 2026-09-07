import { randomUUID } from "node:crypto";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export interface RuntimeDiagnostic {
  session_id: string;
  run_id: string;
  kind: string;
  at: string;
  payload: unknown;
}

// One observer per Pi session covers chat, assignments, scanning, retries and compaction.
// Complete messages are retained; streaming deltas would duplicate them thousands of times.
export class RuntimeDiagnostics {
  #runId = randomUUID();
  #request: { startedAt: number; spanId: string; model: string; provider: string; input: unknown } | null = null;
  #firstTokenAt: number | null = null;
  constructor(readonly sessionId: string, readonly report: (event: RuntimeDiagnostic) => void) {}

  record(kind: string, payload: unknown): void {
    try {
      this.report({ session_id: this.sessionId, run_id: this.#runId, kind, at: new Date().toISOString(), payload });
    } catch { /* A broken telemetry sink must never interrupt Pi. */ }
  }

  accept(event: AgentSessionEvent): void {
    if (event.type === "agent_start") this.#runId = randomUUID();
    if (event.type === "message_update" && this.#firstTokenAt === null) this.#firstTokenAt = Date.now();
    if (event.type === "message_end" && event.message.role === "assistant" && this.#request) {
      const request = this.#request;
      const message = event.message;
      this.record("generation", {
        $ai_trace_id: this.#runId, $ai_span_id: request.spanId, $ai_session_id: this.sessionId,
        $ai_model: request.model, $ai_provider: request.provider,
        $ai_input: request.input, $ai_output_choices: [{ role: "assistant", content: message.content }],
        $ai_input_tokens: message.usage.input, $ai_output_tokens: message.usage.output,
        $ai_cache_read_input_tokens: message.usage.cacheRead,
        $ai_cache_creation_input_tokens: message.usage.cacheWrite,
        $ai_total_cost_usd: message.usage.cost.total,
        $ai_latency: Math.max(0, Date.now() - request.startedAt) / 1_000,
        ...(this.#firstTokenAt === null ? {} : { $ai_time_to_first_token: Math.max(0, this.#firstTokenAt - request.startedAt) / 1_000 }),
        $ai_is_error: message.stopReason === "error", stop_reason: message.stopReason,
        ...(message.errorMessage ? { $ai_error: message.errorMessage } : {}),
      });
      this.#request = null;
    }
    if (["message_update", "message_start", "tool_execution_update"].includes(event.type)) return;
    // agent_end/turn_end repeat complete conversation history already emitted as message_end.
    if (event.type === "agent_end" || event.type === "turn_end") {
      this.record(event.type, {});
    } else {
      this.record(event.type, event);
    }
  }

  providerRequest(model: string, provider: string, payload: unknown): void {
    const request = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    this.#request = {
      startedAt: Date.now(), spanId: randomUUID(), model, provider,
      input: [
        ...(request.instructions ? [{ role: "system", content: request.instructions }] : []),
        ...(Array.isArray(request.input) ? request.input : Array.isArray(request.messages) ? request.messages : []),
      ],
    };
    this.#firstTokenAt = null;
    this.record("provider_request", { model, provider, span_id: this.#request.spanId, request: payload });
  }
}
