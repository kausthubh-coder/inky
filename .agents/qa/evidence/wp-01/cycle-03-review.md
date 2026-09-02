# WP-01 post-cycle-3 read-only review

Reviewer task: `01a055e2-ce9c-7433-bab6-798a6e0010ed` (`WP-01 final review`, `gpt-5.6-sol`, high)

Verdict: **changes_required**. The reviewer changed no files and did not rerun the full green matrix.

Review fingerprint: `D74DD613E05A909A406CEC8F46923A3EC8ED3985236F507AAA2F729FDF1BC769` across 39 current source, configuration, contract-test, Electron-runner, and protected files.

## Blocking finding

Request-bearing IPC methods cannot work through the preload bridge. `shared/ipc.ts` types a non-void method as accepting its inferred request, but `electron/preload.cts` builds a zero-argument function and always parses `undefined`. The cast to `StudiApi` hides the mismatch. Both current methods use `z.undefined()`, so the green suite cannot expose it.

Required repair: keep the current two-method public boundary, make the shared bridge factory forward and validate request arguments from its registry definition, and test the factory with a synthetic non-void request contract.

## Non-blocking findings

- Course-bound pattern authorization is sound. WP-02 must own pattern records and match results; WP-06 must not trust pattern IDs asserted by an agent.
- The contract manifest is manually duplicated from the registry. Derive it from the registry to reduce drift.
- Safe evidence URLs meet this package's boundary, but later capture/export code must redact summaries and opaque references before constructing evidence.
- `transitionTask` should use `STUDI_SCHEMA_VERSION` rather than a literal `1`.
- The bundled preload size and production source-map policy belong to WP-13.

All other reviewed contracts, package boundaries, retained failure repairs, protected hashes, and artifact-location rules passed review.
