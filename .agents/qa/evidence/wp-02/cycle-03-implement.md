# WP-02 cycle 3 implementer report

Package: WP-02 local data  
Cycle: 3  
Role: implementer  
Task: `01a059e4-c367-7252-90b1-f9c7b52d1676`  
Date: 2026-08-31  
Disposition: implementation complete, not verified

This cycle fixes the three blocking findings in `cycle-02-review.md`. The manager still needs a fresh tester and a read-only reviewer before it can verify WP-02.

## Baseline

Before edits:

```text
npm run test:storage
exit 0
12 passed, 0 failed
```

The retained test files were not changed:

```text
tests/storage/storage.test.mjs=5065DCC526F8C54F49480E1EDEB0BD22BFCE7853F39137DBE1159C5F57008918
tests/storage/wp02-independent.test.mjs=3DB9C3BE4BF330CE030C04593F79B74A1C9C95EA553AF2FEE8B3AB4D9464166C
tests/storage/wp02-cycle-02-independent.test.mjs=373B8EA0A72FCC5AF4E480354551B782C43A070FA00AE422A6077C2ADAF86405
```

## Production behavior changed

### Backup record audit

`validateDataRoot` now calls one narrow record audit in `electron/storage/records.ts` after database health and schema-shape validation. It does not expose SQL, accept a caller-selected table, or add a query abstraction.

The audit reads every row from these tables and parses each `record_json` through its existing WP-01 schema:

- `assignments` through `AssignmentSchema`
- `permission_rules` through `PermissionRuleSchema`
- `runs` through `RunSchema`
- `task_events` through `TaskEventSchema`
- `task_projections` through `TaskSchema`

For each parsed record, the audit compares all persisted identity and query columns with the corresponding JSON fields. This includes nullable permission scope columns and the task event payload task ID. A schema failure or column mismatch raises `record_validation_failed`. Public backup validation converts it to `backup_invalid`, so restore cannot move active data.

The new tests damage each table separately. One matrix replaces valid JSON with schema-invalid JSON. A second matrix leaves the canonical JSON untouched and changes a persisted query column. Validation and restore reject all ten backups, and the target-only assignment remains intact.

### Installed-target cleanup

Recovery now treats a validated active target as the commit point. The target-present path, the roll-forward path, and the invalid-target rollback path all use the same best-effort sibling cleanup routine.

When recovery validates `next`, it completes the rename and validates the installed target before it enters cleanup. Cleanup errors no longer enter the installation catch path, so recovery never tries to rename `previous` onto an existing valid target. It keeps the journal and the undeleted sibling, returns a usable store, and retries cleanup on the next open.

Two storage-only failure points make this Windows behavior testable without file locks or ACL changes:

- `restore_before_previous_cleanup`
- `restore_before_next_cleanup`

`openLocalStore` passes its existing storage failure injector into interrupted-restore recovery. The focused roll-forward test injects the previous-root cleanup failure. Startup succeeds with the replacement record, the previous sibling and journal remain, and the next open removes both without swapping the target.

### Invalid-target quarantine

If the active target is invalid and `previous` is valid, recovery still moves the invalid target to `next` and restores `previous`. It now validates the restored target, removes the quarantined `next` sibling, and only then removes the journal. If cleanup fails, the valid target stays active and the journal remains for a later retry.

The focused regression builds that exact state, damages the active assignment JSON, reopens the store, and confirms that the prior root is active and all three restore paths are gone.

## Files changed

- `electron/storage/records.ts`
- `electron/storage/backup.ts`
- `electron/storage/database.ts`
- `electron/storage/store.ts`
- `tests/storage/wp02-cycle-03-implement.test.mjs`
- `.agents/qa/evidence/wp-02/cycle-03-implement.md`

No package file, shared contract, Electron entrypoint, UI file, manager plan, dossier, ledger, conclusion, `AGENTS.md`, or protected Sites file changed. Build commands refreshed generated files under `dist/`; I did not hand-edit them.

I left the reviewer's non-blocking rollback-handle note unchanged. Closing or poisoning the handle after a failed SQLite rollback is separate from the three restore blockers and would broaden this correction.

## Commands and exit codes

Focused new regressions:

```text
npm run build:electron
exit 0

node --test tests/storage/wp02-cycle-03-implement.test.mjs
exit 0
4 passed, 0 failed
```

Full storage gate with every retained assertion:

```text
npm run test:storage
exit 0
16 passed, 0 failed
```

The 16 tests comprise the retained 12 tests and four cycle-3 regressions. No retained assertion was edited or weakened.

Type and broad regression gates:

```text
npm run typecheck
exit 0

npm test
exit 0
49 contract tests passed
12 foundation tests passed

npm run test:sites
exit 0
4 passed, 0 failed

npm run test:electron
exit 0
```

Electron 37.10.3 used Node 22.21.1 and bundled `node:sqlite`. Its storage observation was:

```json
{"driver":"node:sqlite","node":"22.21.1","schemaVersion":1,"fileBacked":true,"reopened":true,"artifactRoundTrip":true,"backupValidated":true,"backupArtifactCount":1}
```

The same Electron run passed invalid-profile rejection, renderer-load rejection, malformed-manifest rejection, malformed-runtime rejection, and owned-directory cleanup.

Protected hashes and repository shape:

```text
exit 0
.openai/hosting.json=D532ABB65CF9AE20634B464D954CB4A08A0DE9F3CD3CDF7F9C3EC8948826D947
worker/index.js=2DD0615A445143933D88D4271F54F5D63EE951421FCD08C5A7617BB09C564389
scripts/prepare-sites-build.mjs=B6A6ADAA4FAB3234676116DD1C9CB6611275AB9D92DD26F5BF402393E3744BF6
tests/sites-worker.test.mjs=96AF7B48906C6460C793356D7B6952F7D5026DBF5A502BEC0D9297FF04201C26
dist/client/index.html present
dist/server/index.js present
dist/.openai/hosting.json present
top-level plans/ absent
top-level qa/ absent
.agents manager artifact shape present
```

## Reproducible source fingerprint

The workspace has no `.git` directory. I used the complete cycle-3 source, configuration, and storage-test set. The report itself and generated `dist/` files are excluded.

To reproduce, sort the paths below, compute uppercase SHA-256 for each file, join `path=SHA256` lines with LF and no trailing LF, encode the manifest as UTF-8, then hash it with SHA-256.

- Source fingerprint: `5F045BBA38B951DC4F41253D4174D8B0868335FA40472E6C845E59DC4142DD07`

```text
electron/main.ts=567951A5ED1C9EC2D3B4B8F10BEBD52C7DF01A84E4759116F30AA50D98A74065
electron/storage/artifacts.ts=D6B29CA1B1734361CA8459E07CF01323048A09E0C0C870ACDF347F17569B4F9D
electron/storage/backup.ts=1E543F764427D2BF061F478D401F0A5F7EB6114EA66E049E2DEC060C816B4906
electron/storage/database.ts=A7094B21A4EF6B073FD4D8868F5C5CBC4451C5FF5B2E954DB43B5DF51109ACB7
electron/storage/errors.ts=D3A3261024ABEDB70A55939CA9682EE5F53A66945C1BB6F59E9C37F444F7FC6F
electron/storage/index.ts=9C075314A080EAED8A2529C5CEBEAF427B8DA4B2D861F5A6E1D578046EA03EDD
electron/storage/records.ts=27DABD2EAC920C00F374C0679F8CFD8120E0628F03ACF2BDD8086A3D3E72463F
electron/storage/store.ts=61BA0A1B5E39BE82CDEC66E265B807D15364163A4E1B5F0F5C494809235F239C
electron/tsconfig.json=94F68BB5C2275AC42C4F53A6C0B7913C2EAF0E8AEA4F3EAD2C3993F211302F33
package-lock.json=4A78F58073A05AC32D8ED36D094E9CE8849EFF7FD1AB2CDDA8A825F716338628
package.json=C346E48FFC393CEE355284A27668E65618506D964E0050511B460B8AACD5C269
shared/artifact.ts=984480ACA5849835D315D6D3E2B4A7695394F70FCF5A12DB91BF49E3BE519C4E
shared/index.ts=1E3A38E64EBFD6DE4ED256705DC1066737DF1D6F7EFEEF3899AC0AB3DEA5511A
shared/task.ts=647EEDD5FD81CFB3C5501314C37AE6B8EDACDA41CF5B16C54DB4B737C4B11DDE
tests/build-shape.test.mjs=DAFC6645CD197BC37D3FA7F9BF1DC801CD4B7B7DF7BFB2C34A68F393FD1581BB
tests/contracts/fixtures.mjs=A5A920BBE6ADFDF4220EBFFBEFCE11CDA49B26204CD2DC2A5C89928BBDE9BBB9
tests/contracts/schema.test.mjs=D3AF30B5F61546A0413FB76C9AAE8CCA0A46047947A32114E7EE6DA0B0E262F0
tests/electron-self-test-runner.mjs=955075F5D9A09A17969BC787B768FF4FC43275754D5DCF1F0E68C332C1C0F8DA
tests/storage/storage.test.mjs=5065DCC526F8C54F49480E1EDEB0BD22BFCE7853F39137DBE1159C5F57008918
tests/storage/wp02-cycle-02-independent.test.mjs=373B8EA0A72FCC5AF4E480354551B782C43A070FA00AE422A6077C2ADAF86405
tests/storage/wp02-cycle-03-implement.test.mjs=D58A22BC6716322598E9B44422D5FF3F5B08E5AD1C812F6F1A0FB4EFDCDFCB75
tests/storage/wp02-independent.test.mjs=3DB9C3BE4BF330CE030C04593F79B74A1C9C95EA553AF2FEE8B3AB4D9464166C
```

## Remaining uncertainty

- The record audit checks every row and every duplicated query column in schema version 1. It does not replay every task event stream during backup validation. Projection replay still performs that semantic check when asked to rebuild a task.
- Cleanup failure tests use the storage failure injector rather than a real Windows lock. The injected point is immediately before the same recursive removal call that reported `EBUSY` in review.
- The tests do not simulate power loss between filesystem flush and rename or enumerate every Windows filesystem error code.
- Electron still prints Node's experimental warning for `node:sqlite`. The driver remains isolated in the storage package.
- Restore remains a closed-store API with no renderer route or product-facing command in WP-02.

WP-02 is not marked verified by this report.
