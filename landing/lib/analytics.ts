"use client";

import posthog from "posthog-js";
import { analyticsEnabled, cleanAnalyticsUrl, isMarketingPath } from "./analytics-policy";

export type AnalyticsEvent =
  | "dashboard_viewed"
  | "demo_started"
  | "demo_step_viewed"
  | "demo_completed"
  | "demo_viewed"
  | "demo_replayed"
  | "demo_step_left"
  | "demo_display_toggled"
  | "landing_section_viewed"
  | "landing_scroll_depth"
  | "faq_opened"
  | "waitlist_submitted"
  | "waitlist_already_joined"
  | "waitlist_failed"
  | "feedback_sent"
  | "sign_in_started"
  | "waitlist_cta_clicked"
  | "waitlist_form_started"
  | "waitlist_joined";

type AnalyticsProperties = Record<string, boolean | number | string>;
const accountEvents = new Set(["dashboard_viewed", "feedback_sent"]);

export function initializeAnalytics() {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!analyticsEnabled || !key || typeof window === "undefined" || posthog.__loaded) return;
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    ui_host: "https://us.posthog.com",
    defaults: "2026-05-30",
    // Automated browser QA is tagged and excluded from reports; production still filters bots.
    opt_out_useragent_filter: process.env.NEXT_PUBLIC_ANALYTICS_DEBUG === "true",
    persistence: "localStorage+cookie",
    person_profiles: "identified_only",
    loaded(client) {
      client.onSessionId((sessionId) => {
        if (client.get_property("landing_session_id") !== sessionId) {
          client.register({ landing_session_id: sessionId, demo_engaged: false, demo_finished: false });
        }
      });
    },
    capture_pageview: "history_change",
    capture_pageleave: true,
    autocapture: {
      url_allowlist: [/^https?:\/\/[^/]+\/(?:mission)?(?:[?#]|$)/],
      capture_copied_text: false,
      css_selector_ignorelist: ["[data-analytics-private]", "[class*='cl-']"],
    },
    capture_heatmaps: true,
    capture_dead_clicks: true,
    capture_exceptions: true,
    capture_performance: { web_vitals: true },
    disable_session_recording: !isMarketingPath(window.location.pathname),
    enable_recording_console_log: false,
    session_recording: {
      maskAllInputs: true,
      blockSelector: "[data-analytics-private], [class*='cl-']",
      recordCrossOriginIframes: false,
      recordHeaders: false,
      recordBody: false,
      maskCapturedNetworkRequestFn: (request) => ({ ...request, name: cleanAnalyticsUrl(request.name) }),
    },
    before_send(event) {
      if (!event || (!isMarketingPath(window.location.pathname) && !accountEvents.has(event.event))) return null;
      for (const property of ["$current_url", "$referrer", "$initial_current_url", "$initial_referrer"]) {
        const value = event.properties[property];
        if (typeof value === "string") event.properties[property] = cleanAnalyticsUrl(value);
      }
      event.properties.app = "studi-landing";
      event.properties.analytics_version = 2;
      event.properties.demo_engaged ??= false;
      event.properties.demo_finished ??= false;
      if (process.env.NEXT_PUBLIC_ANALYTICS_DEBUG === "true") event.properties.release_verification = true;
      return event;
    },
  });
}

export function track(event: AnalyticsEvent, properties?: AnalyticsProperties) {
  initializeAnalytics();
  if (!analyticsEnabled || !posthog.__loaded || (!isMarketingPath(window.location.pathname) && !accountEvents.has(event))) return;
  if (event === "demo_started") posthog.register({ demo_engaged: true });
  if (event === "demo_completed") posthog.register({ demo_engaged: true, demo_finished: true });
  posthog.capture(event, properties);
}
