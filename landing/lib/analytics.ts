"use client";

import posthog from "posthog-js";

export type AnalyticsEvent =
  | "dashboard_viewed"
  | "demo_started"
  | "feedback_sent"
  | "sign_in_started"
  | "waitlist_cta_clicked"
  | "waitlist_form_started"
  | "waitlist_joined";

type AnalyticsProperties = Record<string, boolean | number | string>;

export function track(event: AnalyticsEvent, properties?: AnalyticsProperties) {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY || typeof window === "undefined") return;
  posthog.capture(event, properties);
}
