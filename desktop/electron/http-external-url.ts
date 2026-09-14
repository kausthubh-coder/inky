export function httpExternalUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") return null;
    return parsed.href;
  } catch {
    return null;
  }
}
