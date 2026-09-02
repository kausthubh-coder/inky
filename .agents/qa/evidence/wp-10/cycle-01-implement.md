# WP-10 implementer report

## Behavior changed

- Linked the repository to the existing Clerk `studi` development instance and created one public OAuth client named `Studi desktop` with S256 PKCE, dynamic `127.0.0.1` loopback redirects, and only `openid profile email offline_access` scopes.
- Added one Electron-main auth owner for browser launch, state and nonce validation, code exchange, OIDC signature and audience checks, refresh, entitlement checks, offline approval, device release, and sign-out.
- Stored the refresh token and approved offline cache only inside an Electron `safeStorage` encrypted payload. When secure storage is unavailable, credentials stay in memory and do not survive restart.
- Added a narrow main-process Convex client. The renderer receives only the typed auth projection and can request sign-in, sign-out, entitlement retry, or explicit feedback submission.
- Gated the school browser, Pi runtime, manager, scan coordinator, assignment coordinator, scheduler, and application kernel until cloud access is approved or a valid 24-hour offline approval exists.
- Added the small sign-in, checking, system-browser handoff, waitlist/device-denied, offline, and recoverable-error views in the existing Studi visual language.
- Deployed the Convex development schema and functions for accounts, beta access, entitlements, aggregate usage, feedback, and one active device. No school model exists in the deployment.

## External resources

- Clerk application: `studi` development instance, explicitly targeted by app and instance ID.
- Clerk OAuth application: `Studi desktop`, public client `oNhxE8nbGeztDJzo`.
- Convex project: `kausthubh-nandimandalam/studi-169a0`, development deployment `combative-squirrel-169`.
- Convex environment contains the Clerk issuer, OAuth audience, and one admin subject. No Clerk secret or school value was added.

## Checks

- Baseline: `npm run typecheck`, `npm run test:contracts`, and `npm run test:electron` passed before implementation.
- `npx convex dev --once --typecheck enable`: passed and deployed the final schema/functions.
- `npm test`: passed, including 48 contract and 12 foundation tests.
- `npm run test:auth`: 6/6 passed.
- `npm run test:storage`: 40/40 passed.
- `npm run test:agent`: 11/11 passed.
- `npm run test:electron`: passed after the auth IPC integration.
- `npm run test:sites`: 4/4 passed.
- Unauthenticated `account:bootstrap` and `account:setBetaAccess` CLI calls both failed with `Unauthenticated` and exit code 1.
- The real Electron app reached the pre-onboarding sign-in gate with no school WebContentsView, then opened Clerk and remained at `Finish in your browser` while awaiting the human callback.

## Failed attempts and repairs

- The first Convex codegen run failed because denial reason literals widened to `string`. The literals were narrowed and the next typechecked push passed.
- The first live sign-in click rejected Clerk metadata because the parser treated standard extra metadata fields as errors. The parser now strips unneeded keys while retaining a five-field allowlist, and the real action reached the system-browser handoff.
- An older Studi development instance occupied ports 5173 and 9222. Its visible state showed no queued or active work. Only those exact processes were stopped, then the current build was relaunched against the same persisted local data.

## Subtraction performed

- Kept one auth coordinator and one cloud client instead of a provider framework or renderer SDK.
- Used the existing generated IPC bridge rather than adding a second event transport.
- Used explicit Convex function references in the main process so generated backend files do not become packaged runtime dependencies.
- Added active-device release to sign-out and did not add multi-device synchronization, an admin console, billing, PostHog, or cloud school records.

## Deliberately not completed here

- The human Clerk consent and real approved-account callback remain for the user-like tester. The app is left at that exact handoff. No success state was mocked.
- This implementer did not write the package conclusion or perform the independent tester/reviewer roles.
