"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { usePathname } from "next/navigation";
import posthog from "posthog-js";
import { useEffect, type ReactNode } from "react";
import { initializeAnalytics } from "../lib/analytics";
import { analyticsEnabled, cleanAnalyticsUrl, isMarketingPath } from "../lib/analytics-policy";

function beforeSend<T extends { url: string }>(event: T): T | null {
  if (!isMarketingPath(new URL(event.url).pathname)) return null;
  return { ...event, url: cleanAnalyticsUrl(event.url) };
}

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const marketing = isMarketingPath(pathname);
  useEffect(() => {
    initializeAnalytics();
    if (!posthog.__loaded) return;
    if (marketing) posthog.startSessionRecording();
    else posthog.stopSessionRecording();
  }, [marketing]);

  return (
    <>
      <div data-analytics-private={marketing ? undefined : "true"} style={{ display: "contents" }}>{children}</div>
      {analyticsEnabled && marketing && <>
        <Analytics beforeSend={beforeSend} />
        <SpeedInsights beforeSend={beforeSend} />
      </>}
    </>
  );
}
