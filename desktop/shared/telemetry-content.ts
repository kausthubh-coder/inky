// Keep beta debugging content intact, excluding credentials that grant account access.
export function stripSecrets(value: string): string {
  return value
    .replace(/\bAuthorization\s*:\s*(?:Bearer|Basic)\s+\S+/gi, "Authorization: [secret]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[secret]")
    .replace(/\b(?:password|cookie|token|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|oauth[_-]?code|device[_-]?code)\s*[:=]\s*\S+/gi, "[secret]")
    .replace(/([?&#](?:code|ticket|__clerk_ticket|__clerk_db_jwt|session|state)=)[^&#\s]+/gi, "$1[secret]")
    .replace(/\b(?:sk|ak|pk)_[A-Za-z0-9_-]{8,}\b/g, "[secret]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[secret]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[secret]");
}

const secretPropertyName = /^(?:authorization|password|cookie|set-cookie|token|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|oauth[_-]?code|device[_-]?code|clerk[_-]?token|provider[_-]?credential|verificationUriComplete)$/i;

export function sanitizeTelemetryValue(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (typeof value === "string") return stripSecrets(value);
  if (typeof value === "bigint") return String(value);
  if (value === undefined) return null;
  if (!value || typeof value !== "object") return value;
  if (depth > 40) return "[depth limit]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  const result = Array.isArray(value)
    ? value.map(item => sanitizeTelemetryValue(item, seen, depth + 1))
    : Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [
        key, secretPropertyName.test(key) ? "[secret]" : sanitizeTelemetryValue(item, seen, depth + 1),
      ]));
  seen.delete(value);
  return result;
}
