# WP-11 evidence ledger

## Workspace fingerprint

- The workspace has no `.git` metadata, so the source fingerprint is the SHA-256 manifest in `source-manifest.txt`.
- Ignored local configuration contains `STUDI_POSTHOG_PROJECT_TOKEN` and `STUDI_POSTHOG_HOST`; their values are not recorded here.
- A scan excluding `.env*`, `node_modules`, and `dist` found zero project-token-shaped `phc_` values in committed-source candidates.
- Installed SDKs: `posthog-node@5.51.6`, `posthog-js@1.424.0`.

## Commands and results

| Command or check | Exit | Result |
| --- | ---: | --- |
| `npm run test:telemetry` | 0 | 4 passed |
| `npm test` | 0 | typecheck, build, 48 contracts, 12 foundation/protected checks passed |
| `npm run test:auth` | 0 | 6 passed |
| `npm run test:storage` | 0 | 40 passed |
| `npm run test:agent` | 0 | 11 passed |
| `npm run test:electron` | 0 | live Electron receipt passed, including `telemetryIsolated: true` |
| `npm run test:sites` | 0 | 4 passed |
| real `TelemetryService` capture | 0 | `/batch/` returned HTTP 200 |
| PostHog trend query, project 138887 | n/a | `studi_app_started` aggregated value 1 over 24 hours |

## Primary integration references

- [Electron analytics tutorial](https://posthog.com/tutorials/electron-analytics)
- [Session replay privacy controls](https://posthog.com/docs/session-replay/privacy)
- [JavaScript SDK configuration](https://posthog.com/docs/libraries/js/config)
- [Node SDK](https://posthog.com/docs/libraries/node)

## Limitations retained for the tester

- The WP-10 OAuth gate has not produced a real Clerk subject in this task. Signed identity linkage and signed-out reset across a live renderer replay remain a human test, not implementer proof.
- PostHog's event-property taxonomy had not populated for the new event when queried, even though the trend query counted the event. No claim about taxonomy visibility is made.
- The renderer SDK chunk is about 663 kB minified and 204 kB gzipped. It is lazy-loaded only after desktop telemetry configuration arrives. No extra split or wrapper was added because it would not change the approved behavior.

