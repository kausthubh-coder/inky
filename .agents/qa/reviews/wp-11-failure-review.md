# WP-11 failure review

Status: **failed pending one focused repair**. The live test passed privacy and masking, opt-out/restart, school-view isolation, canary stripping, sign-out reset, and typed desktop identity. WP-11 is not green because PostHog never received the renderer identity link for the active replay.

## Diagnosis

The identity transition reaches both processes in the intended order:

1. `initializeTelemetry()` creates `TelemetryService` with the persisted anonymous ID.
2. The first `RendererTelemetry.sync()` bootstraps `posthog-js` with that ID and starts masked replay.
3. On Clerk approval, `observeAuthState()` calls `TelemetryService.identifyClerk()` before returning the approved auth state, so subsequent typed main-process events use the Clerk subject.
4. The `StudiApp` telemetry effect reruns for the approved auth state, reads the Clerk-backed `TelemetryState`, and `RendererTelemetry.sync()` calls `client.identify(state.distinctId)`.

The broken boundary is the `before_send` callback inside `RendererTelemetry.#load` (`src/telemetry/renderer.ts`, currently lines 85-98). It returns `null` for every event other than `$snapshot` and `$autocapture`, so it also drops the `$identify` event produced by `client.identify(...)`. PostHog changes the SDK's local ambient distinct ID before sending that event, which makes the renderer look locally identified, but the server never receives the new `distinct_id` plus prior `$anon_distinct_id` needed to merge the anonymous replay with the Clerk person. The live evidence matches this exactly: later typed events used Clerk, replay retained the anonymous ID, and no current `$identify` event existed remotely.

This is not a startup/auth timing bug. It is an outbound allowlist bug.

Current PostHog semantics support that conclusion:

- Frontend `identify()` emits the identity link that merges anonymous history into the identified person.
- The active session ID is intentionally preserved across `identify()`, so one replay may keep its original anonymous raw `distinct_id` while resolving to the merged Clerk person.
- `before_send` returning `null` drops an event; PostHog warns that dropping unsafe control events such as `$identify` can cause unexpected behavior.
- `reset()` belongs on logout and creates a new anonymous identity/session. It is not the repair for login identification.

The installed renderer SDK is `posthog-js` 1.424.0, and its behavior agrees with the current official documentation and SDK specification.

## Smallest repair

Change the renderer privacy filter, not auth orchestration.

Affected symbols:

- `RendererTelemetry.sync()` — keep the existing Clerk transition and `client.identify(state.distinctId)` call.
- `RendererTelemetry.#load()` — extend its `before_send` policy with one explicit `$identify` branch.
- `tests/telemetry/telemetry-service.test.mjs` — strengthen the renderer-policy regression so this control event cannot be silently filtered again.

For `$identify`, construct a new minimal event rather than passing the SDK event or its property bag through. Preserve only the SDK transport/identity fields required for ingestion and merging: `token`, `distinct_id`, `$anon_distinct_id`, and `$process_person_profile`; retain opaque `$device_id`, `$session_id`, or `$window_id` only when present and needed for the SDK's identity/session correlation. Preserve required top-level event framing such as `event`, `uuid`, and `timestamp`. Reject the event if `distinct_id` or `$anon_distinct_id` is missing or is not a string. Do not admit `$set`, `$set_once`, URL, referrer, browser text, DOM data, or an arbitrary property spread.

Keep the `$snapshot` masking branch and the minimal `$autocapture` branch unchanged. Keep the existing `#distinctId` synchronization guard unchanged; it is not implicated in the failure.

Do **not** add a second identity coordinator, main-process alias call, IPC field, replay queue, or retry layer. Do **not** stop/reset/restart replay on approval: PostHog's web SDK deliberately preserves the active session across `identify()`, and stop/start alone does not create the missing server-side identity merge. The existing logout `reset()` path already passed.

## Direct retest

1. Exercise the real renderer filter (not only a source regex): transition an initialized anonymous renderer client to a Clerk state. Assert exactly one upload-eligible `$identify` contains the expected Clerk `distinct_id` and prior `$anon_distinct_id`, while forbidden canaries and undeclared properties are absent. Confirm the existing snapshot and autocapture policies are unchanged.
2. Run `npm run test:telemetry`. The masking, opt-out/reset, inspector, shutdown, and school-view isolation checks must remain green.
3. Launch the production Electron app signed out with analytics and replay enabled. Record the displayed anonymous ID, complete the cached Clerk approval, and perform one safe schedule pause/resume action.
4. Intercept renderer egress and verify one `$identify` is uploaded after approval with the Clerk subject and the recorded anonymous ID, contains none of the forbidden school/UI canaries, and is followed by renderer activity using the Clerk subject.
5. Query PostHog for the run. Confirm the `$identify` event exists, then open the Clerk person's profile and verify that both IDs appear under its distinct IDs and that the replay is visible for that same person. The raw pre-approval replay row may still show its original anonymous ID; PostHog merges person identity rather than rewriting historical raw event IDs.
6. Sign out once and verify the already-passing behavior remains intact: the renderer resets to a fresh anonymous ID, the prior Clerk person receives no later activity, and a later approval emits a new `$identify` from that fresh anonymous ID.

## Official references checked

- [PostHog: Identifying users](https://posthog.com/docs/product-analytics/identify) — `identify()` merges anonymous and identified history; call `reset()` on logout.
- [PostHog JavaScript usage: `before_send`](https://posthog.com/docs/libraries/js/usage) — returning `null` suppresses the event.
- [PostHog canonical identify specification](https://github.com/PostHog/sdk-specs/blob/main/openspec/specs/identify/spec.md) — `$identify` carries `$anon_distinct_id`, and session replay preserves the active session across identification.
- [PostHog JavaScript SDK source](https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/posthog-core.ts) — current identify and `before_send` control-event behavior.
