import { sanitizeTelemetryValue, stripSecrets } from "../../shared/telemetry-content.js";
import type { TelemetryState } from "../../shared/index.js";
import type { BeforeSendFn } from "posthog-js";

type PostHogModule = typeof import("posthog-js/dist/module.full.no-external.js");
type FullPostHog = PostHogModule["default"];

export const filterRendererTelemetryEvent: BeforeSendFn = (event) => {
  if (!event) return null;
  if (event.event === "$snapshot") return event;
  // Preserve the SDK envelope (identity, elements, URL, performance and person updates).
  // rrweb snapshots are masked at recording time, before SDK compression.
  const sanitized = sanitizeTelemetryValue({ ...event, timestamp: undefined }) as typeof event;
  sanitized.properties = {
    ...sanitized.properties,
    ...(typeof event.properties?.token === "string" ? { token: event.properties.token } : {}),
  };
  if (event.timestamp) sanitized.timestamp = event.timestamp;
  return sanitized;
};

export class RendererTelemetry {
  #client: FullPostHog | null = null;
  #loading: Promise<FullPostHog> | null = null;
  #distinctId: string | null = null;
  #contextKey: string | null = null;
  #enabled = false;
  #session: { sessionId: string; windowId: string } | null = null;
  #revision = 0;
  #replayStatusKey: string | null = null;

  constructor(readonly loadModule: () => Promise<PostHogModule> = () => import("posthog-js/dist/module.full.no-external.js")) {}

  async sync(state: TelemetryState): Promise<void> {
    if (!state.rendererConfig) { this.disable(); return; }
    const revision = ++this.#revision;
    const client = await this.#load(state);
    if (revision !== this.#revision) return;
    this.#enabled = state.enabled;
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
    if (state.replayEnabled) client.startSessionRecording({ sampling: true });
    else client.stopSessionRecording();
    const sessionId = client.get_session_id();
    const recording = state.replayEnabled && client.sessionRecordingStarted();
    const replayStatusKey = `${sessionId}:${state.replayEnabled}:${recording}`;
    if (replayStatusKey !== this.#replayStatusKey) {
      this.#replayStatusKey = replayStatusKey;
      client.capture("studi_replay_status", { requested: state.replayEnabled, recording });
    }
    if (this.#session) this.#sendContext(this.#session.sessionId, this.#session.windowId);
  }

  reset(): void {
    this.#revision++;
    this.#enabled = false;
    this.#contextKey = null;
    this.#client?.stopSessionRecording();
    this.#client?.reset();
    this.#client?.opt_out_capturing();
    this.#distinctId = null;
  }

  disable(): void {
    this.#revision++;
    this.#enabled = false;
    this.#contextKey = null;
    this.#client?.stopSessionRecording();
    this.#client?.opt_out_capturing();
  }

  page(screen: string, section: string): void {
    if (this.#enabled) this.#client?.capture("$pageview", { screen, section });
  }

  #sendContext(sessionId: string, windowId: string): void {
    if (!this.#enabled || !this.#distinctId || !window.studi) return;
    const distinctId = this.#distinctId;
    const key = `${distinctId}:${sessionId}:${windowId}`;
    if (key === this.#contextKey) return;
    this.#contextKey = key;
    void window.studi.captureUiTelemetry({ event: "replay_context", distinctId, sessionId, windowId })
      .then(accepted => { if (!accepted && this.#contextKey === key) this.#contextKey = null; })
      .catch(() => { if (this.#contextKey === key) this.#contextKey = null; });
  }

  async #load(state: TelemetryState): Promise<FullPostHog> {
    if (this.#client) return this.#client;
    this.#loading ??= this.loadModule().then((module: PostHogModule) => {
      const client = module.default;
      client.init(state.rendererConfig!.projectToken, {
        api_host: state.rendererConfig!.host,
        ui_host: state.rendererConfig!.host.replace(".i.posthog.com", ".posthog.com"),
        persistence: "localStorage",
        bootstrap: { distinctID: state.distinctId, isIdentifiedID: state.identity === "clerk" },
        opt_out_capturing_by_default: true,
        capture_pageview: false,
        capture_pageleave: true,
        capture_dead_clicks: true,
        capture_heatmaps: true,
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
          css_selector_ignorelist: ["[data-secret]", "[data-secret] *", "input[type=password]"],
        },
        mask_all_text: false,
        mask_all_element_attributes: false,
        disable_session_recording: true,
        session_recording: {
          maskTextSelector: "*",
          // Run our selective filter on every input; ordinary answers remain unchanged.
          maskAllInputs: true,
          maskInputFn: (text, element) => element?.getAttribute("type")?.toLowerCase() === "password" || element?.closest("[data-secret]") ? "[secret]" : stripSecrets(text),
          maskTextFn: text => stripSecrets(text),
          blockSelector: "[data-secret]",
          maskInputOptions: { password: true },
          recordHeaders: false,
          recordBody: false,
          recordCrossOriginIframes: false,
          captureJsonLd: false,
          captureCanvas: { recordCanvas: false },
        },
        before_send: filterRendererTelemetryEvent,
      });
      this.#client = client;
      client.onSessionId((sessionId, windowId) => {
        if (!windowId) return;
        this.#session = { sessionId, windowId };
        this.#sendContext(sessionId, windowId);
      });
      return client;
    }).catch(error => {
      this.#loading = null;
      throw error;
    });
    return this.#loading;
  }
}

export const rendererTelemetry = new RendererTelemetry();
