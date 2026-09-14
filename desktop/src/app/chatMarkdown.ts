const allowed = new Set(["http:", "https:", "mailto:"]);

export function safeChatHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    return allowed.has(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
