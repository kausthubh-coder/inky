export function externalLinkUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (["https:", "http:", "mailto:"].includes(url.protocol)) return url.href;
  } catch {
    // Relative paths and incomplete links have no external destination.
  }
  return undefined;
}
