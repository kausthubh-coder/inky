export function isMarketingPath(path: string) {
  return path === "/" || path === "/mission";
}

export function cleanAnalyticsUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}

export const analyticsEnabled =
  process.env.NEXT_PUBLIC_ANALYTICS_ENV === "production" ||
  process.env.NEXT_PUBLIC_ANALYTICS_DEBUG === "true";
