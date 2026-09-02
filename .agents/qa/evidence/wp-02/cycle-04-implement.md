# WP-02 cycle 4 implementer report

Package: WP-02 local data  
Cycle: 4  
Role: implementer  
Task: `01a059ff-1ddc-77d3-981d-7b975df7b893`  
Date: 2026-08-31  
Disposition: implementation complete, not verified

This cycle fixes the three blocking findings in `cycle-03-review.md`. The manager still needs a fresh tester and a read-only reviewer before it can verify WP-02.

## Baseline and retained evidence

Before production edits, `npm run test:storage` exited 0 with 19 passed and 0 failed.

The five retained storage files stayed byte-identical:

```text
tests/storage/storage.test.mjs=5065DCC526F8C54F49480E1EDEB0BD22BFCE7853F39137DBE1159C5F57008918
tests/storage/wp02-independent.test.mjs=3DB9C3BE4BF330CE030C04593F79B74A1C9C95EA553AF2FEE8B3AB4D9464166C
tests/storage/wp02-cycle-02-independent.test.mjs=373B8EA0A72FCC5AF4E480354551B782C43A070FA00AE422A6077C2ADAF86405
tests/storage/wp02-cycle-03-implement.test.mjs=D58A22BC6716322598E9B44422D5FF3F5B08E5AD1C812F6F1A0FB4EFDCDFCB75
tests/storage/wp02-cycle-03-independent.test.mjs=037EFACD7A7B43D5A07CB87ECA7017E19C329EBBE2AC362C144B99A44C976D5D
```

After the production edit and before adding cycle-4 tests, those 19 tests ran directly and passed.

## Behavior implemented

### Durable restore intent before staging

`restoreLocalStoreBackup` now builds and parses the restore journal value, writes it to the exact fixed temporary sibling with exclusive creation, syncs the file, and renames it to the final journal path. Only then does restore create `next`.

Startup removes an incomplete exact temporary journal when no published journal exists. Cleanup names the exact temporary path, not a prefix or wildcard. A similarly named neighbor remains untouched.

Three child-process failure points exit after journal publication, after the database enters staging but before artifact population, and after the staged root validates but before the active root moves. In every state, startup keeps the valid active root, removes staging state, succeeds again on a second open, and permits a later restore. The test also writes a partial temporary journal, confirms startup removes it, and confirms an unowned neighbor remains.

### Semantic task-history validation

`validatePersistedRecords` still parses every task event and projection through the existing schemas and checks duplicated columns. It now groups the validated events by task and calls the existing `replayTaskEvents` function for each stream. It does not contain another transition table or replay implementation.

If a projection exists, the audit compares it with the replayed task. A projection without an event stream also fails. Event-only streams remain valid because projections are rebuildable. Backup validation now rejects a changed origin sequence, a missing origin, an invalid transition, and projection disagreement before restore creates any staging state.

### Plain owned artifact trees

`assertPlainArtifactTree` uses `lstat` on the artifact root, every root child, every expected kind directory, and each Markdown child. The root and kind entries must be plain directories. Artifact children must be plain `.md` files. Unknown root entries and links fail with `backup_invalid`.

Both artifact validation and artifact copying call that ownership check. The copy operation also lstat-checks every source path through its copy filter and refuses a symbolic link instead of preserving or traversing it. The focused test created a real Windows directory junction at `artifacts/preferences`; validation and backup copy both rejected it.

## Files changed

Production:

- `electron/storage/backup.ts`
- `electron/storage/artifacts.ts`
- `electron/storage/records.ts`
- `electron/storage/database.ts`

Tests:

- Added `tests/storage/wp02-cycle-04-implement.test.mjs`

Evidence:

- Added `.agents/qa/evidence/wp-02/cycle-04-implement.md`

No retained test, package file, shared contract, Electron entrypoint, UI file, manager plan, dossier, ledger, conclusion, `AGENTS.md`, or protected Sites file changed. Build commands refreshed generated files under `dist/`; I did not hand-edit generated output.

## Commands and exit codes

Focused cycle-4 cases:

```text
npm run build:electron
exit 0

node --test tests/storage/wp02-cycle-04-implement.test.mjs
exit 0
3 passed, 0 failed, 0 skipped
```

The three cases cover the crash-window matrix and exact temporary ownership, task replay validation, and the Windows junction boundary.

Final package gates:

```text
npm run typecheck
exit 0

npm run test:storage
exit 0
22 passed, 0 failed

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

The same Electron run passed invalid-profile rejection, renderer-load rejection, malformed-manifest rejection, malformed-runtime rejection, and owned self-test directory cleanup.

Protected hashes and repository shape check, exit 0:

```text
.openai/hosting.json=D532ABB65CF9AE20634B464D954CB4A08A0DE9F3CD3CDF7F9C3EC8948826D947
worker/index.js=2DD0615A445143933D88D4271F54F5D63EE951421FCD08C5A7617BB09C564389
scripts/prepare-sites-build.mjs=B6A6ADAA4FAB3234676116DD1C9CB6611275AB9D92DD26F5BF402393E3744BF6
tests/sites-worker.test.mjs=96AF7B48906C6460C793356D7B6952F7D5026DBF5A502BEC0D9297FF04201C26
dist/client/index.html present
dist/server/index.js present
dist/.openai/hosting.json present
.agents/plans present
.agents/qa/evidence/wp-02 present
top-level plans absent
top-level qa absent
```

No implementation or test attempt failed after the cycle-3 baseline.

## Reproducible source fingerprint

The workspace has no `.git` directory. I sorted the paths below, computed uppercase SHA-256 for each file, joined `path=SHA256` lines with LF and no trailing LF, encoded the manifest as UTF-8, and hashed it with SHA-256. The report itself and generated `dist/` files are excluded.

- Source fingerprint: `4DC339832405F54C8FF18FC0318770C6A3B1F050E0FA2FBE90004D25F5EC76E3`

```text
electron/main.ts=567951A5ED1C9EC2D3B4B8F10BEBD52C7DF01A84E4759116F30AA50D98A74065
electron/storage/artifacts.ts=80EF5DE37374AD8D90E213301888EC26BAE41AC531BA19D3CAF7252B5B5D33E4
electron/storage/backup.ts=6F5310EDA108B5922607F1286B9ADC66B9D848F70502C75A53993C6B6239D145
electron/storage/database.ts=E8CBFA67F26ED550A6650263BA28D7C072DD11A75F6828E684881BCCD2B9BE28
electron/storage/errors.ts=D3A3261024ABEDB70A55939CA9682EE5F53A66945C1BB6F59E9C37F444F7FC6F
electron/storage/index.ts=9C075314A080EAED8A2529C5CEBEAF427B8DA4B2D861F5A6E1D578046EA03EDD
electron/storage/records.ts=0A3BA438C7A3220F0725FD0E5D2F122022317707DE3A5EA6E90BABD5BBACFCCE
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
tests/storage/wp02-cycle-03-independent.test.mjs=037EFACD7A7B43D5A07CB87ECA7017E19C329EBBE2AC362C144B99A44C976D5D
tests/storage/wp02-cycle-04-implement.test.mjs=E00399A86EA5117E492BD7466CD78BB568534F25526A54F0C4C4F2D7C4F433F0
tests/storage/wp02-independent.test.mjs=3DB9C3BE4BF330CE030C04593F79B74A1C9C95EA553AF2FEE8B3AB4D9464166C
```

## Remaining uncertainty

- The child exits occur immediately after explicit filesystem boundaries. The suite does not simulate power loss during the kernel's rename operation or prove directory-entry persistence after sudden hardware loss.
- The junction test exercises the reproduced kind-directory escape on Windows. The implementation lstat-checks the root and child files too, but the suite does not race a concurrent filesystem mutation against the copy.
- The cycle-2 non-blocking note about a failed SQLite rollback handle remains unchanged.
- Restore remains a closed-store API with no renderer or product-facing route in WP-02.
- Electron still prints Node's experimental warning for `node:sqlite`.

WP-02 is not marked verified by this report.
