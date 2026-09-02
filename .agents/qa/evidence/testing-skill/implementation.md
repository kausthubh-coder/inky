# Studi end-to-end testing skill implementation

Date: 2026-09-01 (America/New_York)  
Outcome: **PASS — project-local skill and deterministic helpers are ready**

## Delivered boundary

- Added `.agents/skills/test-studi/SKILL.md` as the discoverable integrated user-journey layer.
- Kept `$verify-studi` focused on fast package-boundary verification and added one routing sentence to the new skill.
- Added one focused Clerk + Electron reference describing the separate Electron-CDP and isolated-browser Playwright MCP surfaces, fresh authorize-URL handoff, dedicated development identity, Convex controls, stop conditions, and evidence hygiene.
- Added a built-app launcher that creates a unique temporary Electron profile, binds CDP to `127.0.0.1`, waits for readiness, and emits one JSON receipt.
- Added a read-only Windows browser-process poller that considers only processes created after the supplied UTC baseline, derives the allowed Clerk host from `electron/auth/config.ts`, validates `/oauth/authorize`, S256 PKCE, and a literal `127.0.0.1` callback, and emits only ephemeral URL metadata.

No `.agents/TESTING.md` was added because it would duplicate the skill and its focused reference. No production abstraction, programmatic coverage test, dependency, or protected Sites handoff file changed.

## Validation evidence

| Check | Result | Observation |
| --- | --- | --- |
| Skill Creator `quick_validate.py` | PASS | Ran through an isolated `uv --with pyyaml` environment; reported `Skill is valid!`. The user and project Python environments were not modified. |
| PowerShell parser | PASS | Both helper scripts parsed with zero syntax errors. |
| Launcher dry run | PASS | Port `19322` produced a schema-versioned JSON receipt with a unique temp profile and loopback CDP endpoint. No directory or process was created. |
| Synthetic positive URL | PASS | The configured Clerk host, `/oauth/authorize`, S256 PKCE, and `127.0.0.1:54321/callback` were accepted. |
| Unconfigured host | PASS | `example.com` was rejected. |
| Non-literal callback host | PASS | `localhost` was rejected; only literal `127.0.0.1` is accepted. |
| Fresh-process boundary | PASS | A one-second read-only poll beginning at the current UTC instant returned no stale URL from pre-existing browser processes. |

## Safety disposition

- No Computer Use was run.
- No real authorize URL, state, nonce, code challenge, authorization code, token, cookie, or browser command line was retained.
- No Electron app, system browser, personal Clerk session/device, cloud identity, Convex row, LMS, or schoolwork was changed during helper validation.
- The existing dedicated development email and Clerk development test code appear only in the journey reference, not in production code or helper scripts. No fixed Clerk subject or device ID was added anywhere.
- The full Clerk + Convex journey was not rerun for this implementation task; the skill encodes the already-proven manager flow and the helpers were exercised only through safe dry-run, synthetic validation, rejection, and read-only polling modes.
