# WP-01 cycle-5 read-only review

Reviewer task: `01a05617-217f-7431-9b74-bdae016f351d` (`WP-01 C5 final review`, `gpt-5.6-sol`, high)

Disposition: **changes_required**. The reviewer remained read-only.

## Blocking finding

Type-changing schemas fail across the composed preload-to-main IPC path. `shared/ipc.ts` parses a request before invoking Electron, then `electron/main.ts` parses that transformed output through the original input schema again. Results are likewise parsed by main and then parsed again in the preload factory. An in-memory reproduction of the real composition produced a request rejection after one transport invocation but before the handler, and a result rejection after one invocation and one handler call.

Required repair: make request and result transformation occur exactly once across the composed preload/main path, and add a type-changing test that includes both the API factory and main-handler behavior.

## Passed and carried forward

- The compile-time fixture correctly proves caller `z.input`, handler `z.output`, exact arity, and result output typing.
- No other blocker was found in the package-wide source and evidence audit.
- WP-02 and WP-06 must establish course-bound pattern provenance rather than trust agent-asserted pattern IDs.
- Later evidence capture and export must redact summaries and opaque references.
- Preload bundle size and production source-map policy remain WP-13 work.

## Read-only checks

- No-emit IPC fixture compilation: passed.
- Three focused IPC tests: 3/3 passed, but they did not compose the main wrapper.
- Existing contract suite: 46/46 passed.
- Composed in-memory transform reproduction: failed as described above.
- Source scans, protected hashes, and artifact existence checks passed.
