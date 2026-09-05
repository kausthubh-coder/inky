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
2. Run `bun install --frozen-lockfile`, `bun run test`, and `bun run test:auth`. Do not run concurrent builds against the same `dist` or `out` directory.
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
gh run download <run-id> --repo kausthubh-coder/inky --name studi-windows --dir release/windows
gh run download <run-id> --repo kausthubh-coder/inky --name studi-macos --dir release/macos
sha256sum release/windows/Studi-Setup.exe release/macos/Studi-macOS.dmg
```

Download into an empty task-owned directory. GitHub's artifact transport may be zipped; the Mac installer inside must be a `.dmg`.

For direct Linux Windows builds, verify `wine --version`, `mono --version`, `node --version`, and `bun --version`, then use the preparation checks and `bun run make:win`. Follow the host distribution's installation instructions if prerequisites are missing. Do not silently change the host or substitute electron-builder for Forge.

## Verify artifacts and release

- Windows: expect nonempty `out/make/squirrel.windows/x64/Studi-Setup.exe`; CI stages it as `Studi-Setup.exe`.
- Mac: inspect the generated DMG under `out/make`; CI stages it as `Studi-macOS.dmg`. On macOS mount it read-only, check the contained app and both architectures, then unmount. Verify signing/notarization only if configured; never describe an unsigned build as signed.
- Smoke-test the actual packaged app on each available native OS with a separate test profile: visible first launch, no File/Edit menu, browser sign-in returning to the app, and clear access/error state. Preserve everyday user data. Source-mode Electron tests are supporting evidence, not packaged-app proof.
- For a requested release, choose an unused version, update `package.json` and its lockfile consistently, commit, and push a matching `v<version>` tag. Check existing tags first. The tag workflow publishes both installers and `SHA256SUMS.txt` as the latest GitHub release. A request to commit/push code or create a test build alone does not request publishing a release.
- After publication verify the release assets and the website's latest-download links. Never overwrite an existing version to deliver changed binaries.

If packaging makes no visible progress, inspect the process, disk space, file growth, and Forge logs before calling it stalled. Reproduce once in a clean local-filesystem checkout or a native CI runner; do not repeatedly rebuild the same synced directory or claim an installer exists before locating it.

Report the commit/ref, build host, workflow run when applicable, exact artifact paths, checksums, and checks actually completed. Distinguish source pushed, artifacts built, and release published.

Authoritative maker requirements: [Squirrel.Windows](https://www.electronforge.io/config/makers/squirrel.windows), [DMG](https://www.electronforge.io/config/makers/dmg).
