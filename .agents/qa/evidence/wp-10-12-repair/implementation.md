# WP-10–12 C2 repair implementation evidence

Date: 2026-09-02  
Role: implementer  
Status: complete

## Implemented repair

- Renderer-facing approved/offline auth now remains `checking` until the existing protected app kernel is available. This derives readiness from the current composition root; no second readiness state machine was added.
- Dashboard routing now accepts either retained scan-workflow revision or current completed partial/success coverage. A later failed scan therefore keeps the dashboard and its existing failure banner reachable, while a failed first scan remains in onboarding.
- Submission review now records the existing review deadline and a durable hard `handoffDeadline`. `handoffMinutes` owns the hard deadline; expiry writes and links the Markdown answer fallback before releasing the browser lease so the queue can continue. Older records without the new optional field continue to use their existing review deadline.
- `memoryVisibility` is enforced at the existing boundaries: `none` hides memory summaries, rejects direct memory reads, and supplies none to the manager; `selected` supplies only requested artifact IDs; `all` supplies all local memory artifacts. No memory selection store or framework was introduced.
- Removed the unused in-memory `TokenSet.accessToken` field. The validated OAuth response still requires `access_token`, but Studi retains only the refresh token and verified ID token it actually consumes.
- Updated the Electron self-test runner's stale contract assertion from version 8 to the repository's existing version 9 after the app receipt proved the mismatch.

## Focused proof

- `npm run typecheck` — exit 0.
- `node --test tests/contracts/product-projection.test.mjs` — 2/2 pass: protected-runtime auth gate and retained-workflow failed-scan routing.
- `node --test tests/auth/*.test.mjs` — 6/6 pass.
- `node --test tests/storage/manager-coordinator.test.mjs` — 2/2 pass, including selected/none/all memory supply behavior.
- `node --test tests/storage/lifecycle-execution.test.mjs` — 9/9 pass. The focused review case proves the review reminder does not release the lease, the configured handoff deadline does, the fallback exists first, and the next queue entry remains available.
- `node --test tests/storage/*.test.mjs` — 42/42 pass, including reopen/recovery and scan persistence.
- `npm run test:agent` — 15/15 pass.
- `npm run test:electron` initially reached a successful Electron receipt but exposed the stale version-8 runner assertion. After the one-line assertion correction, `node tests/electron-self-test-runner.mjs` exited 0 with renderer, storage reopen, Pi session, browser isolation, tray lifecycle, and negative-boundary receipts.

## Integration and protected boundaries

- `npm run build` — exit 0; produced `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`. The existing 663 kB Pi runtime chunk advisory remains non-blocking.
- Foundation/protected checks — 12/12 pass; all four protected Sites source files remained byte-identical.
- `npm run test:sites` — 4/4 pass.
- Packaging diagnostics — 1/1 pass.
- Forge package/make and `out/` mutation were deliberately not run because WP-13 currently owns that output; the manager will rebuild packaging after this repair.

## Subtraction result

The final shape adds two small pure projection policies and one optional domain deadline with direct consumers in persistence, scheduling, recovery, and UI copy. No generic readiness service, client state store, timer framework, memory registry, credential bridge, or conclusion artifact was added.
