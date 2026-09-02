# WP-02 cycle 5 implementer report

Package: WP-02 local data  
Cycle: 5  
Role: implementer  
Task: `01a05a14-c573-7590-a35b-0d89e31e829e`  
Date: 2026-08-31  
Disposition: implementation complete, not verified

This cycle fixes only the fresh-target recovery gap reproduced in `cycle-04-review.md`. The manager still needs a fresh tester and a read-only reviewer before it can verify WP-02.

## Baseline and retained tests

Before edits, `npm run test:storage` exited 0 with 25 passed and 0 failed.

All seven retained storage test files stayed byte-identical through the final gate:

```text
tests/storage/storage.test.mjs=5065DCC526F8C54F49480E1EDEB0BD22BFCE7853F39137DBE1159C5F57008918
tests/storage/wp02-cycle-02-independent.test.mjs=373B8EA0A72FCC5AF4E480354551B782C43A070FA00AE422A6077C2ADAF86405
tests/storage/wp02-cycle-03-implement.test.mjs=D58A22BC6716322598E9B44422D5FF3F5B08E5AD1C812F6F1A0FB4EFDCDFCB75
tests/storage/wp02-cycle-03-independent.test.mjs=037EFACD7A7B43D5A07CB87ECA7017E19C329EBBE2AC362C144B99A44C976D5D
tests/storage/wp02-cycle-04-implement.test.mjs=E00399A86EA5117E492BD7466CD78BB568534F25526A54F0C4C4F2D7C4F433F0
tests/storage/wp02-cycle-04-independent.test.mjs=C9B15205AE8CDB40A5CE2951F1C9B2FFB5960BBF35517935924ACA8E645F307C
tests/storage/wp02-independent.test.mjs=3DB9C3BE4BF330CE030C04593F79B74A1C9C95EA553AF2FEE8B3AB4D9464166C
```

## Behavior changed

`restoreLocalStoreBackup` now checks target existence once before it publishes restore intent. A restore that starts without a target writes `targetExistedAtStart: false` into the journal. Existing-target journals omit the field, which keeps the retained journal assertions and existing-target recovery format unchanged. In this encoding, omission means the target existed when the operation began.

When recovery finds an absent target and the fresh-target marker, it refuses an unexpected previous root, removes only the exact `next` sibling when present, removes the exact temporary and final journal paths, and returns without installing staging data. `openLocalStore` then creates a new empty store through its existing constructor path.

This closes both reproduced crash windows:

- A crash after journal publication leaves no staged root. Recovery removes the journal and normal startup creates a blank store.
- A crash during staging leaves a database-only `next` root with no artifacts directory. Recovery removes that entire exact-owned root instead of accepting it as a valid empty-artifact store.

The later restore retry follows the existing-target path because startup created the blank store. It installs both the backed-up assignment and Markdown preference artifact. Existing-target roll-forward, live rollback, cleanup retry, and invalid-target recovery code did not change.

## Files changed

Production:

- `electron/storage/backup.ts`

Tests:

- Added `tests/storage/wp02-cycle-05-implement.test.mjs`

Evidence:

- Added `.agents/qa/evidence/wp-02/cycle-05-implement.md`

No retained test, package file, shared contract, Electron entrypoint, UI file, plan, dossier, ledger, conclusion, `AGENTS.md`, or protected Sites file changed. Build commands refreshed generated files below `dist/`; I did not hand-edit them.

## Regression added

The one new test runs the same fresh target through two child-process exits:

- `restore_after_journal_publish`, exit 101;
- `restore_during_staging_population`, exit 102.

For both cases it checks the published absence marker, target absence at the crash boundary, the expected exact staging shape, no previous root, and no temporary journal. It then opens the target twice, confirms that partial backup records were never installed, confirms that all four restore paths are gone after each open, retries restore, and checks that the backed-up assignment and preference artifact both survive.

## Commands and exit codes

Baseline:

```text
npm run test:storage
exit 0
25 passed, 0 failed
```

Focused cycle-5 check:

```text
npm run build:electron
exit 0

node --test tests/storage/wp02-cycle-05-implement.test.mjs
exit 0
1 passed, 0 failed
```

Complete storage gate:

```text
npm run test:storage
exit 0
26 passed, 0 failed
```

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

The retained-test, protected-file, build-output, repository-shape, and source-fingerprint script exited 0.

## Protected files and repository shape

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

## Reproducible source fingerprint

The workspace has no `.git` directory. I sorted the paths below, computed uppercase SHA-256 for each file, joined `path=SHA256` lines with LF and no trailing LF, encoded the manifest as UTF-8, and hashed it with SHA-256. This report and generated `dist/` files are excluded.

- Source fingerprint: `3A0710D6F49E616A29EAE0FC10C4488A94227DF06A64C9B2EF79A5A12E7E0C51`

```text
electron/main.ts=567951A5ED1C9EC2D3B4B8F10BEBD52C7DF01A84E4759116F30AA50D98A74065
electron/storage/artifacts.ts=80EF5DE37374AD8D90E213301888EC26BAE41AC531BA19D3CAF7252B5B5D33E4
electron/storage/backup.ts=CA1185872FBFBA5D95FD7AEDE13ADB0231A46C7E6A484BB7BC2A1121C7206A2D
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
tests/storage/wp02-cycle-04-independent.test.mjs=C9B15205AE8CDB40A5CE2951F1C9B2FFB5960BBF35517935924ACA8E645F307C
tests/storage/wp02-cycle-05-implement.test.mjs=831B7A5918A633F3ACE3BA5AFDD02733A42EF8D485B43A98306A7BBDA86C5357
tests/storage/wp02-independent.test.mjs=3DB9C3BE4BF330CE030C04593F79B74A1C9C95EA553AF2FEE8B3AB4D9464166C
```

## Residual uncertainty

- The child processes exit immediately after explicit failure hooks. The test does not simulate power loss during the filesystem write, sync, or rename itself.
- The absence marker applies to journals published by cycle-5 code. A pre-cycle-5 fresh-target journal does not contain that fact and retains the older recovery interpretation.
- Cleanup uses the exact owned sibling and journal paths, but this cycle does not inject a Windows deletion failure into the new fresh-target branch.
- The earlier non-blocking note remains. A failed SQLite `ROLLBACK` does not explicitly poison or close the database handle.
- Restore remains a closed-store API with no renderer or product-facing command in WP-02.
- Electron still reports Node's experimental warning for `node:sqlite`.

WP-02 is not marked verified by this report.
