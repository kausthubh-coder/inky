# WP-11 independent live test

Date: 2026-09-01 (America/New_York)  
Role: read-only user-like tester  
Outcome: **FAIL — one approved pass condition is not met**

The production Electron UI, privacy controls, scrubbed inspector, opt-out persistence, school-browser isolation, controlled canary boundary, and sign-out reset all behaved correctly. The blocking failure is remote identity linkage: the current PostHog replay stayed attached to the pre-approval anonymous ID while typed desktop events used the Clerk subject.

## Runtime used

- Ran `npm run build`: exit 0. The build produced the Electron bundle and production renderer.
- Launched `electron . --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222`.
- Microsoft Playwright MCP connected to the renderer at `file:///C:/Users/kaust/OneDrive/Documents/dev/studi-2/dist/client/index.html` through the loopback-only CDP endpoint.
- The production renderer had zero console errors. It reported the expected unpackaged Electron CSP warning and one PostHog consent-reset warning after sign-out; replay could subsequently be re-enabled and uploaded successfully.
- The cached Clerk handoff completed without credential entry in this task. No MFA, consent, school login, or schoolwork submission was attempted.
- The connected PostHog target was confirmed read-only as project `138887`, `Default project`, timezone UTC.

## User-visible telemetry controls — PASS

On the signed-out gate, Playwright observed:

- `Share scrubbed product events` checked;
- `Share fully masked Studi replay` checked;
- `Enable beta debug for 30 minutes`;
- `Local scrubbed inspector (2)`.

Activating beta debug displayed the persistent status banner: `Beta debug is on until Sep 1, 2:25 PM. Only scrubbed summaries can leave Studi.` The inspector then showed only closed, typed envelopes. After the cached Clerk handoff completed, the relevant rows were:

- `studi_auth_gate`, `status=approved`, Clerk distinct ID;
- `studi_dashboard_viewed`, `section=workspace`, same Clerk distinct ID;
- the preceding signed-out rows used the prior anonymous ID.

The inspector contained no arbitrary metadata bags, raw URL, course name, assignment name, page text, prompt, answer, cookie, header, or credential value.

## Safe lifecycle action — PASS

Playwright keyboard-activated the visible `Pause schedule` and `Resume schedule` controls. The UI changed `enabled → paused → enabled`. The inspector added exactly these typed envelopes under the Clerk identity:

- `2026-09-01T17:55:49.379Z` — `studi_queue_transition`, `action=schedule_pause`, `phase=idle`;
- `2026-09-01T17:55:57.335Z` — `studi_queue_transition`, `action=schedule_resume`, `phase=idle`.

The connected PostHog query returned the same two events at `17:55:49.037Z` and `17:55:57.045Z` with the same Clerk distinct ID and fields.

## Opt-out and restart — PASS

Playwright turned replay off and then analytics off:

- local inspector: `17:56:16.383Z`, `studi_setting_changed`, `setting=replay`, `enabled=false`;
- local inspector: `17:56:42.376Z`, `studi_setting_changed`, `setting=analytics`, `enabled=false`.

The replay checkbox became disabled, the debug control became disabled, and the inspector stopped at 10 envelopes. A further safe schedule pause at approximately `17:56:57Z` changed product state but did not add an inspector envelope. After more than two minutes, this PostHog query returned zero rows:

```sql
SELECT timestamp, event, distinct_id
FROM events
WHERE timestamp > toDateTime64('2026-09-01 17:56:42.036', 3, 'UTC')
  AND event LIKE 'studi_%'
ORDER BY timestamp ASC
LIMIT 100
```

The app process was restarted at approximately `17:59:32Z`. Before any new interaction, Playwright observed analytics off, replay off and disabled, and `Local scrubbed inspector (0)`. No startup envelope was eligible while disabled. The preference therefore survived a real process restart.

A later, explicitly separated masking run temporarily re-enabled sharing to intercept replay traffic. Both controls were returned to off at the end; the final visible state is analytics off and replay off/disabled.

## Sign-out and identity reset — PASS

Immediately before sign-out, the public preload telemetry state reported:

```json
{"identity":"clerk","distinctIdKind":"clerk","enabled":false,"replayEnabled":false,"inspectorCount":0}
```

Playwright activated the visible `Sign out` button. The renderer returned to `Sign in before school setup`. The same read-only state call then reported:

```json
{"identity":"anonymous","distinctIdKind":"anonymous","enabled":false,"replayEnabled":false,"inspectorCount":0}
```

This proves both the main-process identity reset and preservation of the privacy preference. No credential or token value was read.

## Embedded school browser isolation — PASS

Playwright inspected the embedded `WebContentsView` as a separate `about:blank` target, not through the Studi renderer. Its page evaluation returned:

```json
{
  "hasPosthogGlobal": false,
  "hasStudiPreload": false,
  "hasRequire": false,
  "posthogResources": []
}
```

The target's PostHog-filtered network request list was empty. The Studi renderer, by contrast, produced successful `POST https://us.i.posthog.com/s/` requests while replay was enabled. This is direct target-level evidence that replay code and the Studi preload did not enter the school view.

## Canary and outbound privacy boundary — PASS

The controlled canary used the production `TelemetryService`'s existing injected-client test seam and a temporary owned directory. It did not touch the real profile or remote PostHog. The payload contained fake password, cookie, token, school URL, HTML, and answer markers. Result:

```json
{"inspectorCount":1,"outboundCount":1,"forbiddenAny":false,"event":"studi_error","propertyKeys":["app_version","platform","beta_debug","boundary","operation","code","debug_summary"]}
```

Thus both the final inspector envelope and the outbound client envelope contained none of the raw canary values. `npm run test:telemetry` also exited 0 with 4/4 tests passing, including undeclared-field rejection, opt-out/restart, identity rotation, inspector bounding, shutdown, renderer masking policy, and school-view exclusion.

For live replay, Playwright intercepted a successful gzip-compressed `/s/` request, decoded a full 17,659-byte `$snapshot` envelope, and searched it before upload evidence was discarded. None of the visible signed-out renderer strings or the checked sensitive workspace markers appeared in decoded form. This proves readable renderer text was not present in that captured snapshot. A live typed-input canary was **NOT RUN** because WP-11 exposes no dedicated renderer canary/debug input; input masking is covered by the existing `maskAllInputs` policy test rather than by entering fake data into a production student field.

## Connected PostHog events and replay — FAIL on identity linkage

The connected project contained the expected current typed events:

- `studi_app_started` under the launch anonymous ID;
- signed-out `studi_auth_gate` and `studi_dashboard_viewed` under that anonymous ID;
- `studi_auth_gate=approved`, `studi_dashboard_viewed=workspace`, schedule pause/resume, and opt-out settings under one Clerk subject.

The current first-run replay was also present remotely. Querying `session_replay_events` returned:

```text
session_id                            distinct_id
01a05e1b-ec31-7394-b8c3-a6d26039a7bd anonymous-abfe99f6-37ee-40b8-9a72-60bde91f107b
```

The UUIDv7 timestamp decodes to `2026-09-01T17:54:43.377Z`, matching this production run. However, the typed approved events used the Clerk subject, not that anonymous ID. The event table contained no current `$identify` event, and the replay relation contained no second current row under the Clerk subject. The later isolated signed-out masking run correctly created a separate replay under its new anonymous ID, which further confirms the relation is reporting actual renderer replay ownership.

**Smallest reproduction**

1. Start signed out with analytics and replay enabled.
2. Let the cached Clerk handoff approve the user.
3. Produce a typed lifecycle event.
4. Query recent `studi_%` events: the lifecycle event uses the Clerk subject.
5. Query `session_replay_events` for the same run: the replay uses the pre-approval anonymous ID.

This fails the approved condition that one tester appears as one Clerk identity across desktop events and masked Studi replay. The implementation should ensure renderer identification reaches PostHog, or deliberately end/restart replay on approval so the remotely stored replay is tied to the Clerk subject. No tester repair was made.

## Final disposition

- PASS: production renderer and visible telemetry surfaces.
- PASS: debug indicator and scrubbed inspector.
- PASS: safe lifecycle telemetry.
- PASS: immediate opt-out, remote no-event window, and restart persistence.
- PASS: sign-out reset and anonymous rotation.
- PASS: school `WebContentsView` isolation.
- PASS: controlled canary scrub at inspector and outbound boundaries.
- PASS: live renderer snapshot contained no checked readable UI text.
- NOT RUN: live typed-input replay canary; no dedicated debug input exists.
- **FAIL: current replay is not linked to the Clerk identity used by typed desktop events.**

No production code, test, or fixture was edited.
