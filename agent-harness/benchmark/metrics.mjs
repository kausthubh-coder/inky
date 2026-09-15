const USAGE_FIELDS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"];

// Sum every attempted phase, including failures. Missing/invalid measurements are
// unknown, never zero. Durations may be fractional; counts must be safe integers.
export function aggregateMetrics(phases) {
  if (!Array.isArray(phases)) throw new TypeError("phases must be an array");
  const sum = (read, integer = true) => {
    const values = phases.map(read);
    if (
      !values.length ||
      values.some(
        (value) =>
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          value < 0 ||
          (integer && !Number.isSafeInteger(value)),
      )
    )
      return null;
    const total = values.reduce((result, value) => result + value, 0);
    return Number.isFinite(total) && (!integer || Number.isSafeInteger(total)) ? total : null;
  };
  return {
    durationMs: sum((phase) => phase?.metrics?.durationMs, false),
    toolCalls: sum((phase) => phase?.metrics?.toolCalls),
    modelCalls: sum((phase) => phase?.metrics?.modelCalls),
    usage:
      phases.length &&
      phases.every((phase) => phase?.metrics?.usage && typeof phase.metrics.usage === "object")
        ? Object.fromEntries(USAGE_FIELDS.map((field) => [field, sum((phase) => phase.metrics.usage[field])]))
        : null,
  };
}
