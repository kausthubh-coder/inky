# WP-11 implementer report

## Behavior changed

- Added one Electron-main `TelemetryService`. It owns the closed event vocabulary, strict per-event parsing, error classification, anonymous or Clerk identity, persisted opt-out settings, the 30-envelope scrubbed inspector, 30-minute beta debug expiry, and bounded PostHog shutdown.
- Added `posthog-node` 5.51.6 and lazy-loaded `posthog-js` 1.424.0. The public project token and ingestion host come from ignored `.env.local` values and never enter source or build configuration.
- The renderer uses the same main-provided distinct ID. Clerk subjects become the shared ID when WP-10 returns one. Anonymous IDs bootstrap both SDKs and rotate across both on sign-out.
- Renderer replay masks every text node and input. It disables request headers, request bodies, cross-origin frames, canvas, JSON-LD, console capture, and performance or network timing. Autocapture accepts marked button clicks only, and its outbound properties are rebuilt to session IDs plus the click type.
- The embedded school `WebContentsView` still has its separate persistent session, no preload, and no renderer telemetry code. The Electron self-test now proves both `window.studi` and `window.posthog` are absent there.
- Added immediate analytics and replay controls, a scrubbed local inspector, and a persistent visible indicator while beta debug is active. Debug events can add only an error class and named boundary, never an error message, stack, prompt, model output, tool argument, or tool result.
- Added small hooks at startup, auth gate, profile and school-browser onboarding, scans, queue and assignment transitions, handoffs, review, answer fallback access, feedback, settings, and IPC failures.

## Files changed

Production changes are in `shared/telemetry.ts`, `electron/telemetry/`, `electron/main.ts`, `src/telemetry/renderer.ts`, `src/app/StudiApp.tsx`, and `src/app/app.css`, with the required IPC, TypeScript, package, and lockfile updates. Focused checks live in `tests/telemetry/telemetry-service.test.mjs`; existing contract and Electron self-test expectations moved to IPC contract version 6.

The protected Sites source files were not edited. Their byte-identity test passed.

## Programmatic proof

- `npm run test:telemetry`: exit 0, 4/4. Covers canary stripping and strict rejection, opt-out and persisted reset behavior, bounded inspector and awaited shutdown, renderer masking controls, immediate renderer reset, and school-view source isolation.
- `npm test`: exit 0. Typecheck, production build, 48 contract tests, and 12 foundation or protected-file tests passed.
- `npm run test:auth`: exit 0, 6/6.
- `npm run test:storage`: exit 0, 40/40.
- `npm run test:agent`: exit 0, 11/11.
- `npm run test:electron`: exit 0. The live receipt includes `"telemetryIsolated":true`; all existing rejection checks and temp cleanup passed.
- `npm run test:sites`: exit 0, 4/4.

## External proof

- A production `TelemetryService` instance loaded the ignored public project configuration and sent `studi_app_started` anonymously. Its only observed request was `POST https://us.i.posthog.com/batch/`, status 200.
- A connected-project trend query for project 138887 later returned `aggregated_value: 1` for `studi_app_started` over the last 24 hours. [Open the PostHog query](https://us.posthog.com/project/138887/insights/new#q=%7B%22kind%22%3A%22InsightVizNode%22%2C%22source%22%3A%7B%22dateRange%22%3A%7B%22date_from%22%3A%22-24h%22%7D%2C%22filterTestAccounts%22%3Afalse%2C%22interval%22%3A%22hour%22%2C%22kind%22%3A%22TrendsQuery%22%2C%22properties%22%3A%5B%5D%2C%22series%22%3A%5B%7B%22event%22%3A%22studi_app_started%22%2C%22kind%22%3A%22EventsNode%22%2C%22math%22%3A%22total%22%2C%22name%22%3A%22Studi%20app%20started%22%7D%5D%2C%22trendsFilter%22%3A%7B%22aggregationAxisFormat%22%3A%22numeric%22%2C%22display%22%3A%22BoldNumber%22%2C%22metricColorByDirection%22%3Afalse%2C%22metricShowChange%22%3Atrue%2C%22metricSummary%22%3A%22total%22%2C%22showAlertThresholdLines%22%3Afalse%2C%22showLabelsOnSeries%22%3Afalse%2C%22showLegend%22%3Afalse%2C%22showMultipleYAxes%22%3Afalse%2C%22showPercentStackView%22%3Afalse%2C%22showValuesOnSeries%22%3Afalse%2C%22smoothingIntervals%22%3A1%2C%22yAxisScaleType%22%3A%22linear%22%7D%7D%7D)

## Failed attempts and subtraction

- The first remote trend query returned zero immediately after capture. A later diagnostic saw the real `/batch/` response return HTTP 200, and the repeated query returned one event. This was ingestion or query lag, not a host interruption or SDK/configuration failure.
- `npm run dev:electron` could not claim port 5173 because a Node server already owned it. The existing listener returned HTTP 200, the preview was opened there, and Electron was launched against that active server without replacing it.
- The subtraction pass removed an unused state value and kept one service rather than adding an analytics adapter or retry queue. It also fixed the only material gap found: renderer and main anonymous identities now share one bootstrapped ID, including after sign-out rotation.

## Deliberately omitted

- No dashboards, flags, experiments, surveys, warehouse, generic telemetry framework, raw AI observability, school-browser replay, custom retry store, or arbitrary metadata path was added.
- WP-10 still requires a human Clerk OAuth completion. This implementation therefore proves anonymous ingestion only. A tester must complete that existing handoff before claiming a remote event and masked replay share a real Clerk subject or that sign-out resets a live signed session.

