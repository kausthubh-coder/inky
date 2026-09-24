const keys = [
  ["inputTokens", "$ai_input_tokens"],
  ["outputTokens", "$ai_output_tokens"],
  ["cacheReadTokens", "$ai_cache_read_input_tokens"],
  ["cacheWriteTokens", "$ai_cache_creation_input_tokens"],
];
const valid = value => Number.isSafeInteger(value) && value >= 0;

// A deadline can interrupt the last provider call before its usage callback.
// Keep billed/completed usage separate from a clearly labelled estimate.
export function recoverTimeoutUsage(events) {
  const requests = new Map();
  const completed = [];
  for (const event of events) {
    const { kind, payload } = event.diagnostic ?? {};
    if (kind === "provider_request" && payload?.span_id && payload.request) {
      requests.set(payload.span_id, JSON.stringify(payload.request).length);
    }
    if (kind === "generation" && payload?.$ai_span_id) completed.push(payload);
  }
  const usage = Object.fromEntries(keys.map(([field, key]) => [field,
    completed.every(call => valid(call[key])) ? completed.reduce((sum, call) => sum + call[key], 0) : null,
  ]));
  const measured = Object.values(usage).every(valid) && completed.length > 0;
  const observedTokens = measured ? Object.values(usage).reduce((sum, value) => sum + value, 0) : null;
  for (const call of completed) requests.delete(call.$ai_span_id);
  const pending = [...requests.values()];
  const ratios = completed.map(call => {
    const chars = events.find(event => event.diagnostic?.kind === "provider_request"
      && event.diagnostic.payload?.span_id === call.$ai_span_id)?.diagnostic?.payload?.request;
    const input = call.$ai_input_tokens + call.$ai_cache_read_input_tokens + call.$ai_cache_creation_input_tokens;
    return chars && valid(input) ? input / JSON.stringify(chars).length : null;
  }).filter(value => Number.isFinite(value) && value > 0);
  const average = values => values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
  const promptTokens = pending.length ? Math.round(pending.reduce((sum, chars) => sum + chars, 0)
    * (average(ratios) ?? 0.25)) : 0;
  const outputTokens = pending.length ? Math.round(pending.length
    * (average(completed.map(call => call.$ai_output_tokens).filter(valid)) ?? 0)) : 0;
  return {
    usage: measured ? usage : null,
    tokenEstimate: observedTokens === null ? null : {
      observedTokens,
      inFlightPromptTokens: promptTokens,
      inFlightOutputTokens: outputTokens,
      totalTokens: observedTokens + promptTokens + outputTokens,
      estimated: pending.length > 0,
      method: "Completed provider usage plus pending serialized-request/input ratio and mean completed output; pending tokens are estimated.",
    },
  };
}
