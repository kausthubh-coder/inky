---
name: build-studi
description: Build, verify, and prepare Studi Windows installers and macOS disk images, locally or through GitHub Actions from a Linux build host. Use for desktop packaging and releases, not Vercel or Convex deployment.
---

# Build Studi

Work from this repository's root. Read `package.json`, `forge.config.mjs`, and `.github/workflows/release-desktop.yml` before choosing commands; they define the current versions, makers, and artifact paths. Use Bun and bunx. Install Node 24 as well: Forge and the test scripts use Node.

## Choose the build host

| Host | Windows x64 EXE | macOS universal DMG |
| --- | --- | --- |
| Windows | `bun run make:win` | Use the macOS CI job |
| Linux x64 | `bun run make:win` with Wine and Mono installed | Use the macOS CI job |
| macOS | Use the Windows CI job | Generate the icon as in the workflow, then `bun run make:mac` |

A Linux box can coordinate both builds through GitHub Actions. It cannot run this project's macOS DMG maker locally; that maker needs macOS tools. Prefer the existing native Windows/macOS CI jobs for repeatable distribution builds. Linux Windows cross-building is an alternative, not a validated native Windows smoke test. For ARM Linux, prefer CI instead of assuming Wine supports the x64 target.

The checked-in Forge makers produce a Squirrel Windows installer and a universal macOS DMG. Do not replace the Mac download with a ZIP merely to make cross-building easier. If automatic updates are added later, assess their separate update artifact requirements.

## Prepare and check

1. Inspect `git status` and identify the source commit. On a remote machine, use a fresh clone of the intended ref on a local filesystem. Avoid synced directories and do not copy Windows `node_modules` to Linux or macOS.
2. Run `bun install --frozen-lockfile` and `bun run test:release` when the coordinator grants the heavy slot. Follow test-studi's single heavy build/test/app slot on this PC; lightweight release tooling tests do not require an app build. Do not run concurrent builds against the same `dist` or `out` directory.
3. Run the applicable journey from `../test-studi/SKILL.md` when verifying desktop behavior. A unit test or generated installer alone does not prove real Clerk login, app focus, or first launch. Report unavailable native runners or QA identities honestly.
4. Keep `.env`, credentials, browser profiles, and `.agents/studi-qa` out of builds and commits. Use the public cloud configuration already wired into the app; packaging does not require backend admin secrets.

## Build from a Linux box through CI

The workflow supports manual builds without publishing a release. With GitHub CLI authenticated to this repository, resolve the requested ref and trigger:

```sh
gh workflow run release-desktop.yml --repo kausthubh-coder/inky --ref main
gh run list --repo kausthubh-coder/inky --workflow release-desktop.yml --event workflow_dispatch --limit 5
```

Use the user's requested ref instead of `main` when supplied. Identify the newly dispatched run by ref, commit, and timestamp; do not assume the newest unrelated run belongs to this task. Inspect it using `gh run view <run-id>` and `gh run view <run-id> --log-failed` on failure. When successful:

```sh
gh run download <run-id> --repo kausthubh-coder/inky --name studi-windows --dir <EMPTY-TASK-DIRECTORY>
gh run download <run-id> --repo kausthubh-coder/inky --name studi-macos --dir <SAME-TASK-DIRECTORY>
```

Start with one empty task-owned directory and download both named artifacts into it. Hash every installer/update asset, including RELEASES and full .nupkg files, and retain the originals. GitHub's artifact transport may be zipped; the Mac installer inside must be a `.dmg`. The separate `studi-macos-native-proof` artifact contains supporting startup evidence, not publishable assets.

For direct Linux Windows builds, verify `wine --version`, `mono --version`, `node --version`, and `bun --version`, then use the preparation checks and `bun run make:win`. Follow the host distribution's installation instructions if prerequisites are missing. Do not silently change the host or substitute electron-builder for Forge.

## Verify artifacts and release

- Windows: expect nonempty `out/make/squirrel.windows/x64/Studi-Setup.exe`; CI stages it as `Studi-Setup.exe`.
- Mac: CI stages exactly one DMG as `Studi-macOS.dmg`, mounts it read-only, verifies both architecture slices and matching packaged bytes, and launches that mounted app using an isolated profile. Review the native receipt and screenshot. This is basic native startup and preload IPC, not browser login, a full journey, or proof that both architectures executed. Verify signing/notarization only if configured; never describe an unsigned build as signed.
- Smoke-test the exact packaged candidate with a separate test profile: visible first launch, no File/Edit menu, browser sign-in returning to the app, and clear access/error state. Preserve everyday user data. Source-mode Electron tests are unpackaged supporting evidence. A local extracted packaged candidate with `--user-data-dir` proves isolated runtime, not an installed upgrade.
- Perform Windows old-version installation and candidate Setup-over-old persistence checks only on a disposable GitHub-hosted Windows runner. Squirrel `--install` takes a package source, not an arbitrary safe destination. Never run it against the local user's install/profile; never spoof environment folders as isolation. Follow [the native verification plan](../../../docs/releases/README.md#windows-safe-installer-and-upgrade-proof). Current 0.1.10 over old v0.1.10 is a reinstall, not upgrade proof.
- For a requested release, use **source commit → manual source build → native/live proof → evidence-only commit → tag promotion of the exact tested files**. Select an unused version and finish all source/packaging/skill/workflow edits before the source commit. Do not tag to create installers. Dispatch the manual workflow, retain its successful run ID and head SHA, then verify the artifacts and full applicable journeys.
- Record the reviewed receipts and `evidence.json` under `docs/releases/v<version>/` using [the evidence contract](../../../docs/releases/README.md#evidence-contract). Only this version evidence directory may differ from the built source revision. Docs are excluded from the packaged archive. A source/configuration/version change requires a new manual build and affected proof; never relabel a rebuilt artifact as the tested one.
- Before a publication authorized by the user, run Node 24 `scripts/verify-release-evidence.mjs --tag v<version> --artifacts <directory> --verify-run` with GitHub repository/token environment. Tag the evidence-only commit. The tag job installs no app dependencies: it checks the prior successful manual run and source identity, downloads only `studi-windows` and `studi-macos` from that run, validates inventory and all asset hashes, generates SHA256SUMS.txt and publishes. Missing proof or expired artifacts blocks promotion. A request to commit/push code or create a test build alone does not request publication.
- After publication verify the release assets and the website's latest-download links. Never overwrite an existing version to deliver changed binaries.

If packaging makes no visible progress, inspect the process, disk space, file growth, and Forge logs before calling it stalled. Reproduce once in a clean local-filesystem checkout or a native CI runner; do not repeatedly rebuild the same synced directory or claim an installer exists before locating it.

Report the commit/ref, build host, workflow run when applicable, exact artifact paths, checksums, and checks actually completed. Distinguish source pushed, artifacts built, and release published.

Authoritative maker requirements: [Squirrel.Windows](https://www.electronforge.io/config/makers/squirrel.windows), [DMG](https://www.electronforge.io/config/makers/dmg).
