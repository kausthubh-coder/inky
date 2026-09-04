import type { TelemetryState } from "../../shared/index.js";
import type { BeforeSendFn } from "posthog-js";

type PostHogModule = typeof import("posthog-js/dist/module.full.no-external.js");
type FullPostHog = PostHogModule["default"];

export const filterRendererTelemetryEvent: BeforeSendFn = (event) => {
  if (!event) return null;
  if (event.event === "$snapshot") return event;
  const properties = event.properties ?? {};
  if (event.event === "$identify") {
    if (
      typeof properties.token !== "string"
      || typeof properties.distinct_id !== "string"
      || typeof properties.$anon_distinct_id !== "string"
      || typeof properties.$process_person_profile !== "boolean"
    ) return null;
    return {
      uuid: event.uuid,
      event: "$identify",
      properties: {
        token: properties.token,
        distinct_id: properties.distinct_id,
        $anon_distinct_id: properties.$anon_distinct_id,
        $process_person_profile: properties.$process_person_profile,
        ...(typeof properties.$device_id === "string" ? { $device_id: properties.$device_id } : {}),
        ...(typeof properties.$session_id === "string" ? { $session_id: properties.$session_id } : {}),
        ...(typeof properties.$window_id === "string" ? { $window_id: properties.$window_id } : {}),
        ...(typeof properties.email === "string" ? { email: properties.email } : {}),
        ...(typeof properties.name === "string" ? { name: properties.name } : {}),
      },
      ...(event.timestamp ? { timestamp: event.timestamp } : {}),
    };
  }
  if (event.event !== "$autocapture") return null;
  const eventType = typeof properties.$event_type === "string" && ["click", "change", "submit"].includes(properties.$event_type)
    ? properties.$event_type
    : "click";
  return {
    ...event,
    properties: {
      $event_type: eventType,
      ...(typeof properties.$session_id === "string" ? { $session_id: properties.$session_id } : {}),
      ...(typeof properties.$window_id === "string" ? { $window_id: properties.$window_id } : {}),
      ...(typeof properties.$el_text === "string" ? { $el_text: properties.$el_text } : {}),
    },
  };
};

class RendererTelemetry {
  #client: FullPostHog | null = null;
  #loading: Promise<FullPostHog> | null = null;
  #distinctId: string | null = null;

  async sync(state: TelemetryState): Promise<void> {
    if (!state.rendererConfig) return;
    const client = await this.#load(state);
    if (!state.enabled) {
      client.stopSessionRecording();
      client.opt_out_capturing();
      return;
    }
    if (client.has_opted_out_capturing()) client.opt_in_capturing();
    if (this.#distinctId !== state.distinctId) {
      if (state.identity === "clerk") client.identify(state.distinctId);
      else if (client.get_distinct_id() !== state.distinctId) {
        client.reset({
          resetDeviceID: true,
          bootstrap: { distinctID: state.distinctId, isIdentifiedID: false },
        });
        client.opt_in_capturing();
      }
      this.#distinctId = state.distinctId;
    }
    if (state.replayEnabled) client.startSessionRecording();
    else client.stopSessionRecording();
  }

  reset(): void {
    this.#client?.stopSessionRecording();
    this.#client?.reset();
    this.#distinctId = null;
  }

  disable(): void {
    this.#client?.stopSessionRecording();
    this.#client?.opt_out_capturing();
  }

  async #load(state: TelemetryState): Promise<FullPostHog> {
    if (this.#client) return this.#client;
    this.#loading ??= import("posthog-js/dist/module.full.no-external.js").then((module: PostHogModule) => {
      const client = module.default;
      client.init(state.rendererConfig!.projectToken, {
        api_host: state.rendererConfig!.host,
        ui_host: state.rendererConfig!.host.replace(".i.posthog.com", ".posthog.com"),
        persistence: "localStorage",
        bootstrap: { distinctID: state.distinctId, isIdentifiedID: state.identity === "clerk" },
        opt_out_capturing_by_default: !state.enabled,
        capture_pageview: false,
        capture_pageleave: false,
        capture_dead_clicks: false,
        capture_heatmaps: false,
        capture_performance: true,
        enable_recording_console_log: false,
        disable_surveys: true,
        disable_web_experiments: true,
        disable_external_dependency_loading: true,
        advanced_disable_feature_flags: true,
        advanced_disable_feature_flags_on_first_load: true,
        autocapture: {
          dom_event_allowlist: ["click", "change", "submit"],
          element_allowlist: ["button", "input", "select", "textarea", "a", "form"],
          element_attribute_ignorelist: ["aria-label", "title", "value", "placeholder"],
        },
        mask_all_text: false,
        mask_all_element_attributes: true,
        disable_session_recording: !state.replayEnabled,
        session_recording: {
          maskTextSelector: "input[type='password'], [data-secret]",
          maskAllInputs: true,
          recordHeaders: false,
          recordBody: false,
          recordCrossOriginIframes: false,
          captureJsonLd: false,
          captureCanvas: { recordCanvas: false },
        },
        before_send: filterRendererTelemetryEvent,
      });
      this.#client = client;
      return client;
    });
    return this.#loading;
  }
}

export const rendererTelemetry = new RendererTelemetry();
