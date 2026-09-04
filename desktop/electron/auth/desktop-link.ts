export const STUDI_CONNECT_PROTOCOL = "studi";

export function findDesktopConnectUrl(argv: readonly string[]): string | null {
  for (const value of argv) {
    if (isDesktopConnectUrl(value)) return value;
  }
  return null;
}

export function isDesktopConnectUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === `${STUDI_CONNECT_PROTOCOL}:`
    && url.hostname === "connect"
    && (url.pathname === "" || url.pathname === "/")
    && !url.username
    && !url.password
    && !url.search
    && !url.hash;
}
