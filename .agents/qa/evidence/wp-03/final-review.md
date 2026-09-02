# WP-03 final quality review

Package: WP-03 Pi runtime  
Role: independent read-only quality reviewer  
Date: 2026-09-01  
Verdict: `approve_with_followups`

## Review boundary

I reviewed the approved dossier, quality oracle, implementation report, independent test report, current source, tests, package metadata, installed Pi package code relevant to disposal and model-runtime lifetime, and the current dependency tree. The saved project has no Git metadata, so this review uses SHA-256 hashes to identify the working state.

I changed no source, test, dependency, build, or protected Sites file. The only file written is this requested review artifact. I did not rerun any broad gate.

## Working state

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
| `tests/build-shape.test.mjs` | `24AFAE2E048AD420B824114C835B159723F7F7199400F4924B3D751FA8872297` |
| `tests/clean-room-boundary.test.mjs` | `30A325BA32290C552DCF1FB4FC1B1EAD1FE055746FBC9E23A2CF54EF3916C4F3` |

The four protected Sites source hashes still match the tester report. The production and dependency hashes match the independently tested state. The focused agent test contains the tester's added provider-failure and fake-operation case.

## Blocking findings

None.

## Quality judgment

### Data shape and ownership

The package has one public normalized event union and one provider-status shape in `shared/agent-runtime.ts`. Mutable runtime state has clear owners. `PiAgentRuntime` owns Pi construction and provider lookup. Each `PiBackedAgentSession` owns one underlying Pi session, one Pi unsubscribe function, its listener set, and one normalizer. The fake owns the same consumer-facing session behavior without introducing a provider framework.

Validation occurs at useful boundaries. Pi events are converted and parsed before they reach Studi listeners. Injected fake turns are parsed when they enter the fake. Provider status is parsed as it leaves `ModelRuntime`. The repeated `ProviderStatusSchema.parse` calls are explicit exits for several policy branches, not competing validators or sources of truth.

### Pi boundary and normalized events

Session construction disables resource discovery, disables every built-in tool, allowlists `studi_probe`, and checks both configured and active tool lists after Pi creates the session. That post-create assertion catches an SDK behavior change at the boundary where it matters.

`PiEventNormalizer` keeps only the state needed to produce a terminal result and suppress a duplicate abort event. It forwards text and tool identity, maps retry and compaction lifecycle, and replaces upstream error strings with fixed Studi text. Terminal fallback in `prompt()` emits only when Pi did not emit its own terminal event. I found no second event state machine or hidden mutation.

Provider reporting does not echo an unknown provider input, credential source, path, header, token, or upstream error. Registered provider identity is the only provider-controlled value that crosses the boundary, which matches the approved `ProviderStatus` contract.

### Replacement and disposal

Replacement creates the next Pi session before detaching or disposing the old one. A creation failure therefore leaves the existing wrapper usable. On success, it unsubscribes from the old Pi session, swaps the session, resets normalization state, binds the new Pi subscription, and disposes the old session. Studi listeners stay in the wrapper and survive the swap. This is one owner and one replacement sequence.

The wrapper's `dispose()` is idempotent and calls Pi's `AgentSession.dispose()`. The installed Pi implementation aborts retry, compaction, branch summary, bash, and the active agent, disconnects listeners, and calls `cleanupSessionResources(sessionId)`. `ModelRuntime` exposes no disposal method and does not create a persistent timer in its constructor.

### Reader load and the 656-line runtime

`electron/agent/runtime.ts` is long, but it does not combine unrelated product concerns. It reads in one order: contract, real runtime construction, session ownership, event normalization, deterministic fake. The normalizer is the largest unavoidable block because the package explicitly owns Pi event translation. The fake sits beside the real implementation so parity can be checked without another navigation hop.

Splitting the file now would mostly add imports and make a maintainer jump among the session wrapper, its normalizer, and its fake. The natural split point is the fake, but it is only 155 lines and is part of this package's approved consumer contract. Reconsider a split when WP-05 or WP-06 adds enough runtime behavior that this file gains a second control flow. It is not justified by line count alone.

A maintainer can answer the oracle's questions locally:

- Session targets and provider IDs enter through `createSession`, `replace`, and `getProviderStatus`.
- `PiBackedAgentSession` owns session mutation and subscriptions.
- `PiAgentRuntime.#createPiSession` owns tool and resource policy. `getProviderStatus` owns redaction policy.
- Listener events and the Electron self-test receipt prove observable success.
- Prompt start failure, provider check failure, replacement creation failure, abort, and compaction failure each have direct behavior.

### Unnecessary code and layers

I found no material code that should be removed before approval. The local `createPiSession` closure is not a one-caller wrapper. It carries the runtime-owned factory into the session so replacement can create another correctly configured Pi session. `PiEventNormalizer.reset()` is a small semantic alias used at replacement, not another state owner. Schema parsing is concentrated at trust boundaries rather than repeated in listener fan-out.

One inert option is worth noting but not worth a repair cycle. The default `ModelRuntime.create` call receives `AbortSignal.timeout(5_000)` while also setting `refreshOnCreate: false`; the installed Pi implementation does not consume that signal when refresh is skipped. Removing the option would save one line but would not change production behavior or reader load.

No generic provider registry, compatibility layer, retry policy, copied transcript store, second settings owner, or narrative comment block was added.

### Test quality

The four focused cases are proportionate and behavior-driven. They use a real Pi `AgentSession` with a deterministic faux provider, prove the exact one-tool boundary, compare a real normalized turn byte for byte with the fake, resume persisted state while retaining the original listener, exercise real abort ordering, exercise real too-small compaction failure, check completed compaction mapping directly, and use credential-shaped canaries for provider and retry redaction. The tester-added case adds a distinct failure boundary rather than another permutation.

The Electron self-test reaches Electron 37 and the built main entrypoint. It proves persisted session creation, resume, tool execution, terminal completion, the one-tool list, and redacted provider status. Its receipt checks are narrow enough to diagnose a boundary failure.

A successful real compaction is not exercised through Pi. That omission is appropriate here because the current deterministic transcript cannot produce it cheaply, while the real failure lifecycle and pure successful mapping are both covered. No paid call or seeded success substitutes for the Pi boundary.

## Focused tail diagnostic

I ran one focused read-only diagnostic around the existing agent test file, with a root `node:test` after hook that printed `process.getActiveResourcesInfo()`. This did not rebuild the app or rerun the broader package gates.

- All four tests passed.
- Test-runner duration was `4566.5348 ms`; command wall time was about `5.35 s`.
- The individual test bodies took about `188 ms`, `260 ms`, `2 ms`, and `5 ms`.
- At the final hook, the only reported resources were one `FSReqCallback` and two `PipeWrap` entries. There was no timeout, socket, child process, or Pi session resource.

The roughly 54-second tail reported earlier is not present in this working state. The current short tail is consistent with bounded SDK and `AbortSignal.timeout(5_000)` test overhead. Source inspection and the active-resource receipt show no undisposed production session. A repair cycle to add a disposal abstraction that Pi's `ModelRuntime` does not support would add code without fixing a current resource owner.

## Dependency and install-script judgment

`@earendil-works/pi-coding-agent` and `typebox` are correctly placed as production dependencies because `electron/agent/runtime.ts` imports them at runtime. Exact pins match the dossier. The direct `@earendil-works/pi-ai` dependency is used only by the focused tests and the `STUDI_SELF_TEST` branch in `electron/main.ts`; the production Pi runtime already receives Pi AI through the coding-agent package.

The lock currently contains two Pi AI trees because the coding-agent package retains a nested `0.84.4` copy while the project also installs a root `0.84.4` copy. This is a real install and future packaging cost, but WP-03 has no packaged-installer boundary and the root import keeps the current Electron self-test explicit. It does not block this package.

The unapproved transitive scripts do not create a current blocker:

- `@google/genai@1.52.0` declares a `preinstall` script that only prints `preinstall: no-op`.
- `protobufjs@7.6.5` and `7.6.6` declare a postinstall script that reads package manifests and may print a version-scheme warning. It does not generate runtime files.
- The package manager withheld those scripts, while the focused Node tests, Electron test, builds, and prior gates passed against the resulting installation.
- Electron and esbuild are the only approved install scripts, and both need installation work for the current toolchain.

Approving the Google or protobuf scripts would add permission without supplying a missing runtime artifact. Leave them unapproved.

## Useful follow-up

At the packaging package, decide whether `STUDI_SELF_TEST` must run from a production-only install. If it does not, move the project's direct `@earendil-works/pi-ai` entry to `devDependencies` and keep faux-provider imports in test-only code. Confirm the packaged dependency tree then contains only the coding-agent-owned Pi AI copy. This follow-up has a concrete install-size and audit benefit, but it does not affect WP-03 correctness.

## Verdict

`approve_with_followups`

WP-03 is coherent, proven through the real Pi and Electron boundaries available today, and small enough to trace. No blocking correctness or maintainability finding remains. The only useful follow-up belongs with packaging, where dependency inclusion can be judged against the actual installer.
