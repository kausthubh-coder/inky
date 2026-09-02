# WP-10–12 integrated quality review

Date: 2026-09-02  
Role: read-only quality reviewer  
Verdict: **changes_required**  
Score: **7.5/10**

## Reader-load assessment

The principal owners are legible. Clerk/OIDC tokens and entitlement mutation live in `AuthCoordinator` plus the narrow `CloudAccountClient`; Convex owns beta, entitlement, device, usage, and feedback truth. `TelemetryService` owns typed main-process capture, consent persistence, identity, scrubbing, inspection, and shutdown, while `RendererTelemetry` owns only masked renderer replay and the required PostHog identity control event. The repaired `OpenAiCodexLoginAttemptOwner` is one transient main-process owner and Pi remains the credential owner. React mostly projects these states and sends typed commands.

Reader load rises materially at the composition boundary. `electron/main.ts` is now a 1,400-line assembly module, and `StudiApp` reconstructs the product from auth, workspace, onboarding, lifecycle, settings, library, detail, artifact, and telemetry snapshots with several independent refresh loops. This is still traceable, but two real contradictions fall out of that split today. A generic state framework or repository layer would not be justified; the fixes should be smaller than that.

## Concrete blockers

1. **Approved auth is observable before the protected runtime exists on startup.** `AuthCoordinator.start()` installs `approved`/`offline` in its public state. `getAuthState` returns that state directly through `currentAuthState()` (`electron/main.ts:179`, `electron/main.ts:470`), while startup initializes the protected browser/runtime/kernel only afterward (`electron/main.ts:1374-1376`). The renderer can therefore observe `authorized=true`, run its one-shot `refreshProduct()`, and have `getWorkspaceState()` fail before `agentRuntime` exists. That rejection leaves `onboarding` and `lifecycle` null, and there is no product-refresh retry after the kernel becomes ready. This is a current startup race with a permanent “Opening your local school desk…” result. Keep the renderer-facing auth projection at `checking` until protected initialization completes, or otherwise make the single initial product read retry from a main-owned readiness signal; do not add a second readiness state machine.

2. **A failed later scan hides retained verified work even though the dashboard contains a failure state for it.** `StudiApp` defines “onboarded” only when the latest scan is `succeeded` or `partial` and routes every other state back to onboarding (`src/app/StudiApp.tsx:34`, `src/app/StudiApp.tsx:115`). `SchoolScanCoordinator` truthfully makes the latest scan `failed` while retaining prior courses and assignments. Consequently the dashboard branch that says prior verified assignments remain (`src/app/WorkspaceScreens.tsx:76`) is unreachable after that failure. The latest scan status and whether the student has ever completed onboarding are separate facts; derive the route from durable completed coverage/workflow state and project the latest failure inside that route.

3. **Two visible work defaults have no runtime consumer.** `handoffMinutes` and `memoryVisibility` are validated, stored, returned, and rendered, but repository-wide production references stop at that persistence/UI path. Only `reviewMinutes` is applied by the assignment coordinator; manager commands always send `memoryArtifactIds: []`. The Settings copy says these controls change domain owners, so these are not harmless reserved fields: users can save choices that cannot affect behavior. Either connect each value to its existing approved owner now, or remove the controls and fields until such an owner exists. Do not create timer or memory frameworks merely to preserve the settings.

## Unnecessary code found

- `TokenSet.accessToken` is assigned and retained but never read (`electron/auth/coordinator.ts:35`, `electron/auth/coordinator.ts:333`). The Convex boundary authenticates with the verified ID token. Dropping this field shortens the lifetime of an unused credential without changing behavior.
- The handoff and memory preference plumbing is currently persistence ceremony around dead product controls, as described in blocker 3.
- No unnecessary auth-provider framework, cloud repository layer, telemetry retry queue, replay queue, or duplicate submission-policy implementation was found. The repaired `$identify` allowlist and device-code attempt owner are appropriately narrow.

## Useful non-blocking follow-ups

- Preserve the current explicit IPC schemas and main-owned mutation policy. If another UI slice needs another polling loop, consolidate the existing snapshots behind one coherent renderer projection then; do not introduce a client state framework pre-emptively.
- Normalize telemetry preferences so `enabled=false` cannot retain a presentation state that reads as replay-enabled, even though capture already stops correctly.
- Retest the repaired PostHog `$identify`/replay merge when analytics can be safely enabled for the dedicated Clerk identity. The retained evidence proves local identity synchronization, masking, opt-out, restart persistence, and school-view isolation; remote merge remains honestly unclaimed.
- Complete the human OpenAI device authorization and one real Pi turn when the external 403 boundary permits it. That external test limitation is not a code-quality blocker in this review.

## Verdict

**changes_required.** The main owners and trust boundaries are sound, and the auth, telemetry, and device-code repairs are restrained. Acceptance should wait for the startup readiness race, failed-scan route contradiction, and inert visible settings to be resolved with focused subtraction-oriented changes.

Production code, automated tests, fixtures, dossiers, evidence, and conclusions were untouched. This review added only this report.
