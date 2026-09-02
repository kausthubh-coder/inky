# WP-13 implementer report

## Changed behavior

- Electron Forge owns the Windows package, with one Squirrel maker configured for a future native setup build. Version `0.1.0`, product metadata, app/tray icons, packaged renderer paths, Pi/provider data, native modules, and third-party notices are explicit.
- Mutable app state remains under Electron `userData`. Before any pending storage migration, Studi now creates one current-schema, validated, normally restorable backup whose manifest records app version and source/target schema versions.
- Settings displays the app version and exposes one main-process diagnostics export. The JSON export contains only runtime versions, storage health/schema, telemetry switches, and allowlisted/redacted recent diagnostic events. It never recursively copies `userData`.
- Package ignores exclude `.env*`, transient Vite cache, source/test/manager files, and protected Sites sources. Renderer-only build dependencies moved to `devDependencies`; all main-process, Pi, auth, storage, and telemetry runtime dependencies remain production dependencies.
- The current retry-fixed private-beta release candidate is the runnable unpacked Forge directory plus `out/Studi-0.1.0-win32-x64-release.zip` (209,729,805 bytes; SHA-256 `AD2B851713857DA5426C69B09E9CD69E4BF8AD138BCA914C709AF07B06BDFE02`). It remains a candidate until the pending signed-in Moodle continuation completes.

## Files changed

Production/package files:

- `package.json`, `package-lock.json`, `forge.config.mjs`, `THIRD_PARTY_NOTICES.md`
- `assets/studi.png`, `assets/studi.ico`
- `shared/diagnostics.ts`, `shared/index.ts`, `shared/ipc.ts`
- `electron/diagnostics.ts`, `electron/main.ts`, `electron/tsconfig.json`
- `electron/storage/backup.ts`, `electron/storage/store.ts`, `electron/storage/index.ts`
- `src/app/StudiApp.tsx`, `src/app/WorkspaceScreens.tsx`

Focused tests/evidence:

- `tests/contracts/ipc.test.mjs`
- `tests/packaging/diagnostics.test.mjs`
- `tests/storage/migration-backup.test.mjs`
- `.agents/qa/evidence/wp-13/packaged-*.log`

The workspace has no Git metadata, so traceability uses this explicit inventory, protected-source hashes, artifact hash, and retained command logs.

## Commands and exit codes

- Baseline: `npm run typecheck` 0; `npm run test:storage` 0 (41 tests); `npm run test:telemetry` 0 (4 tests); `npm run build` 0; `npm run test:sites` 0.
- Focused implementation checks: `npm run test:contracts` 0; `npm run test:packaging` 0; `npm run test:storage` 0 (42 tests, including migration backup/restore).
- Repaired unpacked build: `npm run package:win` 0. Output contained 27,083 files / 569,794,368 bytes and no `.env*` or `node_modules/.vite` entries.
- Repaired package self-test from an external temp working directory: exit 0. It observed app `0.1.0`, contract v9, SQLite schema 4 with reopen/backup, real Pi `AgentSession` persistence/resume/probe, bundled provider catalog, embedded browser isolation, and tray lifecycle. See `packaged-repaired.stdout.log`.
- Portable archive: existing Forge dependency `7z.exe a -tzip -mx=1 ...` exit 0. Final archive listing found 0 forbidden environment/cache entries and all 4 required executable/icon/notices/Pi-provider entries.
- After the scan-grounding, exact-selected-task, and partial-first-scan retry repairs, `npm run package:win` again exited 0. The current package contains 27,083 files / 569,816,226 bytes. Its release ZIP contains 29,894 entries, including 13,811 Pi package entries; required executable/icon/notices entries are present and forbidden environment/cache count is 0. The latest source Electron self-test passed after the active live-test process released the single-instance lock. A final packaged self-test will be run after the signed-in Moodle test stops that same process.
- Final gates: `npm test` 0 (50 contract tests, 1 packaging test, 12 foundation/protected tests); `npm run test:storage` 0 (42); `npm run test:auth` 0 (6); `npm run test:telemetry` 0 (4); `npm run test:agent` 0 (15); `npm run test:sites` 0 (4).
- Final protected hashes remained unchanged:
  - `.openai/hosting.json`: `D532ABB65CF9AE20634B464D954CB4A08A0DE9F3CD3CDF7F9C3EC8948826D947`
  - `worker/index.js`: `2DD0615A445143933D88D4271F54F5D63EE951421FCD08C5A7617BB09C564389`
  - `scripts/prepare-sites-build.mjs`: `B6A6ADAA4FAB3234676116DD1C9CB6611275AB9D92DD26F5BF402393E3744BF6`
  - `tests/sites-worker.test.mjs`: `96AF7B48906C6460C793356D7B6952F7D5026DBF5A502BEC0D9297FF04201C26`

## Failures and resolution

- Two ASAR package attempts remained CPU-active for roughly 10–11 minutes without producing `out/`; both were interrupted. Forge remains the package owner, but `asar: false` keeps Pi/native/provider resources as ordinary packaged files and completed in about 76 seconds.
- The first generic packaged self-test exited 1 only because its onboarding-field snapshot caught the signed-out timing state. Its same observation showed packaged renderer, SQLite, Pi, browser, and lifecycle boundaries working. The repository's deterministic `onboarding-ready` scenario then exited 0, including from an external working directory.
- A pre-repair Squirrel maker remained in archive compression for roughly half an hour and was stopped when the manager declared that source obsolete. No installer artifact was retained.
- The first ZIP listing exposed `.env.local` in `resources/app`; that exact partial archive was stopped and removed. Forge ignores were tightened, the repaired package was rebuilt, and both the package tree and final ZIP listing reported zero environment/cache entries.

## Subtraction

- Moved renderer-only React/Vite/font/PostHog browser packages out of the production dependency graph; retained every runtime-owned dependency.
- Used one diagnostics policy module because it owns the security allowlist and is directly tested; no collector/provider abstraction was added.
- Reused the existing backup manifest, validation, and restore path. The pre-migration copy is migrated and validated off to the side, so recovery does not need a second format or compatibility restore path.
- Removed the unused vector icon source and retained only the consumed PNG/ICO assets.
- Kept ASAR disabled after it proved operationally disproportionate on this checkout; no custom dependency pruner or release framework was added.

## Deliberate omissions / limits

- No auto-update service, delta updater, code-signing pipeline, crash upload, installer analytics, macOS/Linux package, or recursive diagnostic/log collector.
- A native Squirrel installer was not produced in this implementer cycle. The proportional private-beta artifact is the unpacked directory plus ZIP; the executable is unsigned and may trigger Windows reputation warnings.
- The implementer did not claim installed update-over-install, Start-menu launch, uninstall/reinstall, browser-session preservation, or a live Clerk-approved account path. Those remain user-like tester boundaries. The implemented persistence design continues to use the same Electron `userData` root and `persist:studi-school` partition across versions.
- This is an implementation report only; it does not mark WP-13 verified and does not edit the master plan or package conclusion.
