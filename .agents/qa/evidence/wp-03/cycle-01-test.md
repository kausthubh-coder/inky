# WP-03 cycle 1 independent test report

Package: WP-03 Pi runtime  
Cycle: 1  
Role: tester  
Date: 2026-09-01

## Verdict

PASS. The tested working state satisfies every named WP-03 tester risk. The real Pi session, one-tool boundary, normalized events, interruption, compaction failure, persisted replacement, provider states, fake contract, Electron 37 runtime, earlier package gates, and protected Sites gates all passed.

I changed no production code and no package dependency. I added one focused test case to `tests/agent/agent-runtime.test.mjs` and wrote this evidence file. Build commands regenerated `dist/` outputs.

## Working state

This saved project has no `.git` directory, so commit and diff identifiers are unavailable. SHA-256 hashes record the tested source state.

| File | SHA-256 |
| --- | --- |
| `package.json` | `FBB8D54E023AA3BA94F91DE0C30D642267C64B757A3DCA2BB5ED2AB6E5DEBBD7` |
| `package-lock.json` | `7783B57FDDB8CD14E3FE300480AB53F5A836974F83C0CAC8A66DE59493CBD790` |
| `shared/agent-runtime.ts` | `C1572FDC55618C4C56A7D45D2C0EB3B7EBD825711836168B42ADC6A021453EE1` |
| `shared/index.ts` | `4423D6109CD5A384AB083752BCCB4A4B7523321598F2854BF5A2E2EA103D2A32` |
| `electron/agent/runtime.ts` | `67DCC551161E5E782957293FE6718D175487A1327D9568916B1774CF898258CD` |
| `electron/main.ts` | `898E3236178365F5E23DB7DA59BCF688E1FB80AF162EF421D81B99D8F16EDB28` |
| `electron/tsconfig.json` | `598E52DC24E4CAF26A4E2068F6B5D179683B2919A89276B762D2588E722E9287` |
| `tests/agent/agent-runtime.test.mjs` | `2FB253A8E9C1EC52CD6DF4C5B23D9517DF690379B033400AA15D27B5263A3FD7` |
| `tests/electron-self-test-runner.mjs` | `B2FA90BEC1F34B56ED62928884C3937A1D3D7E8EF83ABF9E33CBD9AE289622E4` |

The focused agent test began at implementer hash `77EAE978858265C3275FB5B919604E6E8CE976F0424A18BA3CAC6EFD1745D30C`. The tester-only case changed it to the hash above. All listed production and dependency hashes match the starting state and the implementer report.

Protected source hashes remained unchanged:

| File | SHA-256 |
| --- | --- |
| `.openai/hosting.json` | `D532ABB65CF9AE20634B464D954CB4A08A0DE9F3CD3CDF7F9C3EC8948826D947` |
| `worker/index.js` | `2DD0615A445143933D88D4271F54F5D63EE951421FCD08C5A7617BB09C564389` |
| `scripts/prepare-sites-build.mjs` | `B6A6ADAA4FAB3234676116DD1C9CB6611275AB9D92DD26F5BF402393E3744BF6` |
| `tests/sites-worker.test.mjs` | `96AF7B48906C6460C793356D7B6952F7D5026DBF5A502BEC0D9297FF04201C26` |

The build left `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json` present. The copied worker and hosting outputs match their protected sources. Top-level `plans/` and `qa/` directories remain absent.

## Cases and observations

1. **Real Pi session and exact tool boundary.** The runtime calls Pi's `createAgentSession`. A deterministic Pi turn completed through `@earendil-works/pi-ai`'s faux provider. Session construction passed its post-create check that both configured and active tools equal `['studi_probe']`; the public session also reported that exact list. No file or shell tool appeared.

2. **Normalized deterministic turn without a paid call.** An in-memory credential store and registered faux provider emitted a real Pi tool call. The observed order was `tool_started`, `tool_finished`, four text deltas, then completed `terminal`. Every event passed `AgentRunEventSchema`. No external provider or paid model was called.

3. **Abort and too-small compaction.** Aborting after the first streamed text chunk emitted one `aborted` event followed by one aborted `terminal`. Pi rejected the short session with `Nothing to compact`; the wrapper emitted manual compaction start and a failed finish. It did not report a successful compaction.

4. **Persisted replacement and listener retention.** The Pi JSONL session existed on disk and contained the `studi_probe` turn. Replacing the underlying session from that path retained the original Pi session ID, kept only `studi_probe`, and delivered the later resumed text and terminal events to the listener registered before replacement.

5. **Provider states and redaction.** A real `ModelRuntime` reported `ready` for the registered faux provider, `needs_login` with OAuth for a login-capable provider, and `unavailable` for an unknown provider. A tester-added failing `checkAuth` canary contained a credential-shaped value, a Windows credential path, and upstream detail. The returned status was `unavailable`, retained only the safe provider identity and API-key login method, and used fixed Studi text. The canary, path, and upstream error text were absent. Retry normalization passed a second error-text canary check.

6. **Fake contract.** The default fake prompt matched the normalized real Pi turn byte for byte. The tester case also validated fake provider statuses and every event from compact, abort, replacement, and a prompt after replacement. The listener registered before replacement received the later prompt events, and every event passed the shared schema.

7. **Electron 37.** Electron `37.10.3`, Node `22.21.1`, and Pi SDK `0.84.4` loaded the runtime. The self-test created a real Pi session, completed `studi_probe`, persisted and resumed the same session, reported one active tool, and returned redacted unavailable-provider status. The positive run and all four existing rejection paths exited as expected. Temporary profiles were removed.

8. **Earlier packages and Sites.** Type checking passed. Contract tests passed 49 of 49, foundation tests 12 of 12, storage tests 27 of 27, and Sites tests 4 of 4. The foundation suite confirmed every protected source file stayed byte-identical.

## Commands and exit codes

- `npm run test:agent` before the tester change: exit `0`, 3 passed.
- `npm run test:agent` after the tester change: exit `0`, 4 passed.
- `npm run typecheck`: exit `0`.
- `npm run test:contracts`: exit `0`, 49 passed.
- `npm run test:foundation`: exit `0`, 12 passed.
- `npm run test:storage`: exit `0`, 27 passed.
- `npm run test:electron`: exit `0`. Its receipt named Electron `37.10.3`, Node `22.21.1`, Pi `0.84.4`, resumed session `true`, completed probe `true`, and active tools `['studi_probe']`.
- `npm run build`: exit `0`. It produced the required client, server, and hosting outputs.
- `npm run test:sites`: exit `0`, 4 passed.
- `npm ls @earendil-works/pi-coding-agent @earendil-works/pi-ai typebox electron --depth=0`: exit `0`. Installed versions were Pi coding agent `0.84.4`, Pi AI `0.84.4`, TypeBox `1.3.7`, and Electron `37.10.3`.

## Limitations

- The package forbids paid model calls, so this pass did not test a live provider login or network request. It tested provider readiness and failures through Pi's `ModelRuntime` with in-memory credentials and deterministic providers.
- The real short-session compaction failure was exercised. A completed compaction used the event normalizer directly because a successful real compaction would require a much larger transcript and another model turn.
- The Electron check exercised the installed development dependency and built app entrypoint, not a packaged installer.
- With no Git metadata, hashes are the only working-state identity available.

No production blocker remains. WP-03 is ready for its independent read-only maintainability review.
