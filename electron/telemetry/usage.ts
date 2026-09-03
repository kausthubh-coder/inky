export interface AgentUsageSnapshot {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: number;
  readonly toolCalls: number;
}

export function emptyUsage(): AgentUsageSnapshot {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    toolCalls: 0,
  };
}

export function addUsage(left: AgentUsageSnapshot, right: AgentUsageSnapshot): AgentUsageSnapshot {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    costUsd: left.costUsd + right.costUsd,
    toolCalls: left.toolCalls + right.toolCalls,
  };
}

export function readMessageUsage(message: unknown): AgentUsageSnapshot {
  if (!message || typeof message !== "object") return emptyUsage();
  const record = message as Record<string, unknown>;
  return readUsageRecord(record.usage);
}

export function readUsageRecord(value: unknown): AgentUsageSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyUsage();
  const usage = value as Record<string, unknown>;
  const cost = usage.cost;
  const costUsd = typeof cost === "number"
    ? cost
    : cost && typeof cost === "object"
      ? finiteNumber((cost as Record<string, unknown>).total)
        ?? sumDefined([
          (cost as Record<string, unknown>).input,
          (cost as Record<string, unknown>).output,
          (cost as Record<string, unknown>).cacheRead,
          (cost as Record<string, unknown>).cacheWrite,
        ])
      : 0;
  return {
    inputTokens: integerNumber(usage.input) || integerNumber(usage.inputTokens) || integerNumber(usage.prompt_tokens),
    outputTokens: integerNumber(usage.output) || integerNumber(usage.outputTokens) || integerNumber(usage.completion_tokens),
    cacheReadTokens: integerNumber(usage.cacheRead) || integerNumber(usage.cache_read_input_tokens),
    cacheWriteTokens: integerNumber(usage.cacheWrite) || integerNumber(usage.cache_creation_input_tokens),
    costUsd: Math.max(0, costUsd),
    toolCalls: 0,
  };
}

export function usageProperties(usage: AgentUsageSnapshot): Record<string, number> {
  const properties: Record<string, number> = {};
  if (usage.inputTokens > 0) properties.input_tokens = usage.inputTokens;
  if (usage.outputTokens > 0) properties.output_tokens = usage.outputTokens;
  if (usage.cacheReadTokens > 0) properties.cache_read_tokens = usage.cacheReadTokens;
  if (usage.cacheWriteTokens > 0) properties.cache_write_tokens = usage.cacheWriteTokens;
  if (usage.costUsd > 0) properties.cost_usd = Number(usage.costUsd.toFixed(6));
  if (usage.toolCalls > 0) properties.tool_calls = usage.toolCalls;
  return properties;
}

function integerNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sumDefined(values: readonly unknown[]): number {
  return values.reduce<number>((total, value) => total + (finiteNumber(value) ?? 0), 0);
}
