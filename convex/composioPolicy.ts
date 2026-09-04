export interface ComposioToolkitPolicy {
  readonly version: string;
  readonly tools: readonly string[];
}

export type ComposioPolicy = Readonly<Record<string, ComposioToolkitPolicy>>;

const slug = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const version = /^[0-9]{8}_[0-9]{2}$/;
const tool = /^[A-Z0-9][A-Z0-9_]{0,255}$/;

export function readComposioPolicy(raw = process.env.STUDI_COMPOSIO_TOOL_POLICY_JSON): ComposioPolicy {
  if (!raw?.trim()) return Object.freeze({});
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("STUDI_COMPOSIO_TOOL_POLICY_JSON must be an object");
  }
  const policy: Record<string, ComposioToolkitPolicy> = {};
  for (const [toolkit, input] of Object.entries(parsed)) {
    if (!slug.test(toolkit)) throw new Error(`Invalid Composio toolkit slug: ${toolkit}`);
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error(`Composio policy for ${toolkit} must be an object`);
    }
    const record = input as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== "version" && key !== "tools")) {
      throw new Error(`Composio policy for ${toolkit} has an unknown field`);
    }
    if (typeof record.version !== "string" || !version.test(record.version)) {
      throw new Error(`Composio toolkit ${toolkit} requires a pinned YYYYMMDD_NN version`);
    }
    if (!Array.isArray(record.tools) || record.tools.length === 0 || record.tools.length > 100) {
      throw new Error(`Composio toolkit ${toolkit} requires 1 to 100 allowed tools`);
    }
    const tools = record.tools.map((name) => {
      if (typeof name !== "string" || !tool.test(name)) {
        throw new Error(`Invalid Composio tool slug for ${toolkit}`);
      }
      return name;
    });
    if (new Set(tools).size !== tools.length) throw new Error(`Composio toolkit ${toolkit} repeats a tool`);
    policy[toolkit] = Object.freeze({ version: record.version, tools: Object.freeze(tools) });
  }
  return Object.freeze(policy);
}

export function requireAllowedComposioTool(
  policy: ComposioPolicy,
  toolkit: string,
  toolSlug?: string,
): ComposioToolkitPolicy {
  const toolkitPolicy = policy[toolkit];
  if (!toolkitPolicy) throw new Error(`Composio toolkit ${toolkit} is not enabled for Studi`);
  if (toolSlug && !toolkitPolicy.tools.includes(toolSlug)) {
    throw new Error(`Composio tool ${toolSlug} is not enabled for Studi`);
  }
  return toolkitPolicy;
}

const secretKey = /^(?:authorization|password|cookie|set-cookie|token|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|oauth[_-]?code|device[_-]?code)$/i;

export function sanitizeComposioValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeComposioValue);
  if (!value || typeof value !== "object") return typeof value === "string" ? stripCredentialText(value) : value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      secretKey.test(key) ? "[secret]" : sanitizeComposioValue(item),
    ]),
  );
}

export function boundedComposioContent(value: unknown, limit = 750_000) {
  const json = JSON.stringify(value);
  const originalBytes = Buffer.byteLength(json);
  const truncated = originalBytes > limit;
  let retained = truncated ? Buffer.from(json, "utf8").subarray(0, limit).toString("utf8") : json;
  while (Buffer.byteLength(retained) > limit) retained = retained.slice(0, -1);
  return {
    value: truncated ? { preview: retained } : value,
    originalBytes,
    retainedBytes: Buffer.byteLength(retained),
    truncated,
  };
}

function stripCredentialText(value: string): string {
  return value
    .replace(/\bAuthorization\s*:\s*(?:Bearer|Basic)\s+\S+/gi, "Authorization: [secret]")
    .replace(/\b(?:password|cookie|token|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|oauth[_-]?code|device[_-]?code)\s*[:=]\s*\S+/gi, "[secret]")
    .replace(/\b(?:sk|ak|pk)_[A-Za-z0-9_-]{8,}\b/g, "[secret]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[secret]");
}
