# Promote a tested desktop build

The release workflow builds installers only on `workflow_dispatch`. A `v*` tag
promotes bytes from a **previous successful manual run**, without rebuilding.
No actual release evidence is supplied by this document or the synthetic test fixtures.

## Source → build → proof → evidence-only commit → tag

1. Finish the source, packaging configuration, release scripts, documentation and
   selected unused version before the source commit. Record its full Git SHA.
   Dispatch `release-desktop.yml` at that ref. Check the run's `head_sha`, repository,
   event, workflow path and successful conclusion; do not select a run by recency alone.
2. Download `studi-windows` and `studi-macos` from that **same run** into one empty
   task-owned directory. Record SHA256 for `Studi-Setup.exe`, `RELEASES`, every full
   `.nupkg`, and `Studi-macOS.dmg`. Keep the exact files until publication. The Mac
   `studi-macos-native-proof` artifact is supporting evidence, not a release asset.
3. Run native and live verification against these files. Follow
   [test-studi](../../.agents/skills/test-studi/SKILL.md) for the complete integrated
   journey. Controlled tests and packaged PDF checks alone do not prove login,
   an installed upgrade, Learn, or real provider work. Never turn `not_run` or a
   credential failure into a pass. Retain expected and observed outcomes separately.
4. Add reviewed, sanitized receipts plus `evidence.json` under
   `docs/releases/v<version>/`. Commit **only this directory** after the source
   build. Do not change a skill, README elsewhere, workflow, lockfile, package version
   or app source at this point: changes require a new source build and affected proof.
   Forge excludes all `docs` from the packaged archive.
5. Verify with Node 24, then create/push the matching tag on the evidence commit
   only when publication is authorized. The tag job checks ancestry and that the
   final source tree differs only in this evidence directory. It validates the run
   through GitHub's API, downloads both named artifacts with `actions: read`, checks
   the complete asset inventory and SHA256s, derives `SHA256SUMS.txt`, and publishes.
   Expired/deleted artifacts require a new build/proof cycle; do not substitute a rebuild.

Before tagging, from a clean tracked checkout with the tested downloads:

```sh
node scripts/verify-release-evidence.mjs --tag v<VERSION> --artifacts <DOWNLOAD-DIRECTORY>
# Also verify the remote run (GH_TOKEN and GITHUB_REPOSITORY must be set):
node scripts/verify-release-evidence.mjs --tag v<VERSION> --artifacts <DOWNLOAD-DIRECTORY> --verify-run
```

After publication, re-download the released assets, compare hashes and verify the
website download links. No version is overwritten.

## Evidence contract

`evidence.json` has `schemaVersion: 1`, `version` matching package.json, a full
40-character lowercase `sourceRevision`, positive integer `artifactRunId`,
`assets: [{name, sha256}]`, and `checks: [{id, status, sourceRevision, evidencePath}]`.
Hashes are lowercase SHA256. `evidencePath` is relative to the version directory;
files must be tracked, regular JSON files inside it. Every required check must
appear exactly once, with status `passed`, the same source revision and its own receipt:

| Check ID | Required evidence |
| --- | --- |
| `controlled` | Integrated controlled suite, commands/logs and real outcomes |
| `design-fidelity` | Review against the accepted concept and actual screens |
| `live-chatgpt` | Real successful provider turn and relevant fixture work |
| `live-claude` | Real successful provider turn and relevant fixture work |
| `learn-journey` | Exercise Learn and its saved state/recovery behavior |
| `windows-installed-upgrade` | Old installed version → exact candidate; persisted app data and restart |
| `macos-package-smoke` | Exact DMG, read-only mount, architectures and native packaged startup |

Each receipt has `checkId`, `status`, `sourceRevision`, and nonempty
`observations: [{expected, observed, status}]`. Both outcome strings must be
nonblank; every required observation must pass. Add commands, log/screenshot
references, time, environment, version and limitations so a reviewer can assess
what actually happened. Do not include auth codes, tokens or personal profiles.

Native receipts additionally have the same `artifactRunId` and `assets` matching
every tested Windows asset or the Mac DMG respectively. The gate checks identity,
coverage, tracked provenance and hashes; it cannot establish that a human-written
observation is truthful. Review the underlying logs/screenshots before accepting it.
Authentication and full native journey limits remain distinct even when basic
startup passes. A blocked required check blocks publication.

## Windows: safe installer and upgrade proof

**Do this on fresh GitHub-hosted Windows runners, never this PC's everyday install.**
The baseline is the published v0.1.10. The candidate must have a newer unused
version before its source build; a reinstall does not prove an upgrade.

Local inspection found electron-winstaller 5.4.4 shipping Squirrel.exe file version
2.0.1.1 and Setup.exe 1.9.1.0. Squirrel 2.0.1's
[CLI definition](https://github.com/Squirrel/Squirrel.Windows/blob/2.0.1/src/Update/StartupOption.cs)
defines `--install` as a **package source directory**, `--update` as a release feed,
and `--processStart` with `--process-start-args` for launching the installed executable.
It has no general destination-directory switch. The
[Setup bootstrapper](https://github.com/Squirrel/Squirrel.Windows/blob/2.0.1/src/Setup/UpdateRunner.cpp)
extracts Update.exe and invokes `--install .`, forwarding command-line options;
`--silent` is supported. Changing an Electron `--user-data-dir` does not redirect
installation. Squirrel's [installation implementation](https://github.com/Squirrel/Squirrel.Windows/blob/develop/src/Update/Program.cs)
can remove an existing app directory, and its
[root selection](https://github.com/Squirrel/Squirrel.Windows/blob/develop/src/Squirrel/UpdateManager.cs)
uses installation location/local application data. Treat environment-directory
overrides as unsupported isolation, not permission to experiment on a user's install.

The manual workflow's `windows-upgrade` matrix runs `verify-windows-upgrade.ps1`
on separate disposable Windows runners for Setup and the update feed. Its launch
probe saves privacy settings using production IPC, then verifies the installed
candidate and restart read them. It verifies installed executable/archive bytes
against the candidate package. This supports signed-out setting persistence;
authenticated homework and credential migration remain separate live evidence.
These checks are implemented but have not yet run successfully on a native runner.
The verification follows these constraints:

1. Require Windows, `GITHUB_ACTIONS=true`, `RUNNER_ENVIRONMENT=github-hosted`, a
   manual event, and an empty expected installation root. Abort on any preexisting
   Studi installation/process. Never use a self-hosted runner or copy user data.
2. Download the published **v0.1.10** installer from this repository into a separate
   baseline folder. Record its release/asset identity and hash; verify published
   checksum when available. Resolve the baseline's actual package ID, installed
   executable and profile path before choosing candidate paths. Do not guess a
   `%LOCALAPPDATA%` directory from the display name.
3. Install baseline Setup with `--silent`, wait for its actual completion with a
   timeout, then verify the installed version, executable and updater location.
   Launch that installed executable and seed a small app-supported persisted
   setting/workspace state in the runner's own profile. Record a supplemental
   marker hash; a surviving marker alone is not proof of application migration.
4. Stop only the launched app. Run the exact candidate `Studi-Setup.exe --silent`
   over the baseline on this disposable runner. Check exit code, actual installed
   version and candidate package contents, then relaunch from the installation.
   Assert the app can read the saved setting/workspace after migration and restart.
   Retain installer logs, before/after snapshots, PIDs and all candidate hashes.
5. In a **separate fresh runner** test the update-feed path using baseline's
   installed `Update.exe --update <candidate-release-directory>` with the candidate
   `RELEASES` and full `.nupkg`. Verify installed version, launch and persistence.
   This tests the updater; it does not replace the candidate Setup-over-old test.
6. Publish a `windows-installed-upgrade` receipt only after observed success. Keep
   absent baseline assets, version collisions, launch failures and unavailable
   authenticated state as explicit blockers. Dispose of the VM; do not run a
   local uninstall/cleanup command against the user's Studi.

An additional local journey may use the **exact packaged candidate extracted from
the downloaded package**, with a new task-owned `--user-data-dir` and loopback debug
port. Verify the executable/archive hashes against the downloaded package, use an
approved QA identity and exercise scan/chat/work/Learn/restart. Keep the local
user-installed app and profile intact. This proves isolated packaged runtime;
source-mode Electron is unpackaged, and neither is installed-upgrade proof.

## macOS CI proof and its limits

The manual Mac build stages exactly one DMG. `verify-macos-dmg.sh` verifies it,
mounts it read-only, checks universal x86_64/arm64 executable slices, compares the
archive and native canvas modules with the packaged inputs, then invokes the native
first-launch helper on **the app inside that mounted DMG**. A fresh temporary
profile and loopback debug endpoint isolate the run. The helper requires a
GitHub-hosted Mac, verifies the exact packaged renderer URL, a rendered React root
and production auth-state IPC, then captures a screenshot and a hash-bound receipt.
The mount is detached on exit; only the child launched by this check is terminated.

`studi-macos-native-proof` retains `macos-package-smoke.json` and `first-launch.png`.
Review and copy these into the version evidence directory only after a real
successful run. The startup helper is internal to the DMG script: calling it alone
does not establish the preceding mount/structure assertions. These helpers have
not yet run on macOS. Only the host architecture executes; universal slice checks
do not prove both architectures can launch. This smoke does not log in, verify
Gatekeeper/notarization, copy into Applications, or prove the full native journey.

Native auth limits: a fresh CI profile remains signed out; browser callback,
Keychain/DPAPI credential behavior and provider connectivity need separate proof.
Live auth limits: expired/rejected ChatGPT refresh credentials or a signed-out
Claude account block their live checks even if native startup passes. Repair the
authorized QA connection and rerun the affected journey; retain failed receipts.
