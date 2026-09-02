# WP-11 identity-link repair evidence

Date: 2026-09-01  
Role: focused repair implementer  
Outcome: programmatic repair gates passed

## Repaired path

`RendererTelemetry` still calls `posthog.identify()` when the renderer changes from its persisted anonymous ID to the approved Clerk subject. Its `before_send` callback now admits `$identify` through an explicit privacy branch.

That branch constructs a new envelope. It keeps only the PostHog project token, Clerk `distinct_id`, prior `$anon_distinct_id`, `$process_person_profile`, and present device, session, and window correlation IDs. It also keeps the event UUID and timestamp. It rejects malformed identity events and drops ambient SDK properties, `$set`, `$set_once`, URLs, text, and undeclared fields.

The existing `$snapshot` passthrough and scrubbed `$autocapture` branch did not change. The Clerk synchronization guard, logout reset, opt-out flow, and replay lifecycle did not change.

## Focused regression

The renderer-policy test imports and invokes the same function configured as PostHog's `before_send` callback. It proves that:

- a valid `$identify` retains the Clerk and prior anonymous IDs plus the permitted opaque correlation fields;
- URL, password, arbitrary-property, `$set`, and `$set_once` canaries do not survive;
- an `$identify` without `$anon_distinct_id` is rejected;
- `$snapshot` still passes through unchanged;
- `$autocapture` still retains only click, session, and window fields.

The installed `posthog-js` 1.424.0 source and a local no-upload probe confirmed that its real anonymous-to-identified transition emits the fields covered by this allowlist. The probe used a loopback dead endpoint and did not send production telemetry.

## Gates

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run test:telemetry` | PASS, 4/4; rerun after subtraction pass |
| `npm run test:auth` | PASS, 6/6 |
| `npm run build` | PASS; produced `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json` |
| `npm run test:electron` | PASS; production Electron self-test and rejection receipts completed |
| `npm run test:foundation` | PASS, 12/12 including all four protected-file checks |
| `npm run test:sites` | PASS, 4/4 |

Vite repeated its existing large PostHog chunk warning. Electron repeated the existing experimental SQLite warning. Neither gate failed.

## Scope check

Production changes are limited to the renderer privacy filter. The only test change is the focused renderer-policy regression. No identity abstraction, main-process alias, IPC field, replay queue, retry, replay restart, or new analytics event was added.

The independent live tester still needs to run the approved Clerk transition against the connected PostHog project and confirm that the uploaded `$identify` merges the anonymous replay into the Clerk person's distinct IDs. This evidence does not claim that remote retest.
