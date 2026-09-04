"use client";

import posthog, { type CaptureResult } from "posthog-js";
import { useEffect, type ReactNode } from "react";

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

function withoutQuery(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}

function sanitize(event: CaptureResult | null): CaptureResult | null {
  if (!event?.properties) return event;
  event.properties.$current_url = withoutQuery(event.properties.$current_url);
  event.properties.$referrer = withoutQuery(event.properties.$referrer);
  return event;
}

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (!key || posthog.__loaded) return;
    posthog.init(key, {
      api_host: host,
      ui_host: "https://us.posthog.com",
      defaults: "2026-05-30",
      capture_pageview: "history_change",
      autocapture: false,
      capture_exceptions: false,
      disable_session_recording: true,
      person_profiles: "never",
      cookieless_mode: "always",
      advanced_disable_flags: true,
      before_send: sanitize,
    });
  }, []);

  return children;
}
