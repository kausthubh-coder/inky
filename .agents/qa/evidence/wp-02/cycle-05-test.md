# WP-02 cycle 5 independent test report

Package: WP-02 local data  
Cycle: 5  
Role: independent tester  
Task: `01a05a1a-cbc1-7c12-81f3-bb9392f66bad`  
Date: 2026-08-31  
Verdict: **PASS**

Cycle 5 passes its independent test gate. All 26 retained storage tests pass byte-identical, and one new independent test raises the complete storage gate to 27 passed and 0 failed. The new test covers an ownership boundary that the cycle-5 implementer test did not: fresh-target recovery removes only the four exact restore paths while similarly named neighboring files remain byte-identical.

I did not change production code, retained tests, package configuration, shared contracts, protected files, the dossier, ledger, or other manager artifacts. I added only `tests/storage/wp02-cycle-05-independent.test.mjs` and this requested evidence report. Build commands refreshed generated files under `dist/`.

## Retained state

Before adding the independent test, the full storage gate passed with 26 tests. The cycle-5 production file and all eight retained storage test files match the implementer evidence:

```text
electron/storage/backup.ts=CA1185872FBFBA5D95FD7AEDE13ADB0231A46C7E6A484BB7BC2A1121C7206A2D
tests/storage/storage.test.mjs=5065DCC526F8C54F49480E1EDEB0BD22BFCE7853F39137DBE1159C5F57008918
tests/storage/wp02-independent.test.mjs=3DB9C3BE4BF330CE030C04593F79B74A1C9C95EA553AF2FEE8B3AB4D9464166C
tests/storage/wp02-cycle-02-independent.test.mjs=373B8EA0A72FCC5AF4E480354551B782C43A070FA00AE422A6077C2ADAF86405
tests/storage/wp02-cycle-03-implement.test.mjs=D58A22BC6716322598E9B44422D5FF3F5B08E5AD1C812F6F1A0FB4EFDCDFCB75
tests/storage/wp02-cycle-03-independent.test.mjs=037EFACD7A7B43D5A07CB87ECA7017E19C329EBBE2AC362C144B99A44C976D5D
tests/storage/wp02-cycle-04-implement.test.mjs=E00399A86EA5117E492BD7466CD78BB568534F25526A54F0C4C4F2D7C4F433F0
tests/storage/wp02-cycle-04-independent.test.mjs=C9B15205AE8CDB40A5CE2951F1C9B2FFB5960BBF35517935924ACA8E645F307C
tests/storage/wp02-cycle-05-implement.test.mjs=831B7A5918A633F3ACE3BA5AFDD02733A42EF8D485B43A98306A7BBDA86C5357
```

The new independent test file has SHA-256 `BF6C90F2F22D7302ACAD2778F2D0E1ADFE800D7A504E73822CE9A6314F93E4BE`.

## Fresh-target crash recovery

The independent test exits child processes at both required failure points:

- `restore_after_journal_publish`, exit 111;
- `restore_during_staging_population`, exit 112.

For both exits, the target is absent and the published journal contains `targetExistedAtStart: false`. No temporary journal or previous root exists. The second exit leaves only the staged SQLite database and no artifact directory, which is the incomplete state that cycle 4 could wrongly install.

Before recovery, the test creates similarly named neighbors beside `next`, `previous`, the final journal, and the temporary journal. Startup removes the exact staged root and exact journal state. Every neighbor remains byte-identical. The first and second startup both open a valid empty store, with neither the backed-up assignment nor the Markdown preference artifact present. A later public restore installs the complete assignment and preference artifact, clears exact restore state, and still leaves every neighbor unchanged.

This reproduces the two fresh-target failures independently and proves that recovery does not install partial data, does not broaden cleanup authority, remains idempotent, and permits a complete retry.

## Existing-target recovery and marker isolation

The retained cycle-4 crash matrix passed separately. It covers existing targets after journal publication, during partial staging, and after complete staging. A second retained test covers both pre-move journal windows. Existing target data remains authoritative until the later explicit restore.

Static inspection shows that the absence marker is one optional literal-false journal field. The writer omits it when the target exists. Recovery checks and validates an existing target before it can reach the marker branch. The `targetExistedAtStart === false` branch runs only after the target-absent path is established. No existing-target rename, rollback, roll-forward, validation, or cleanup branch reads the field.

The marker therefore cannot alter existing-target recovery in the current control flow. The focused retained crash tests confirm that conclusion through the real file-backed boundary.

## Commands and exit codes

Retained baseline before adding the independent test:

```text
npm run test:storage
exit 0
26 passed, 0 failed
```

Focused independent check:

```text
npm run build:electron
exit 0

node --test tests/storage/wp02-cycle-05-independent.test.mjs
exit 0
1 passed, 0 failed
```

Focused existing-target crash recovery:

```text
node --test --test-name-pattern="pre-install restore crashes|published restore journals" tests/storage/wp02-cycle-04-implement.test.mjs tests/storage/wp02-cycle-04-independent.test.mjs
exit 0
2 passed, 0 failed
```

Type and complete storage gates:

```text
npm run typecheck
exit 0

npm run test:storage
exit 0
27 passed, 0 failed
```

Broad regression gates:

```text
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

The retained-test, production, protected-file, build-output, and repository-shape script exited 0.

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

The workspace has no `.git` directory, so Git status and diff evidence are unavailable. Hashes provide the retained-state check.

## Blockers

None.

## Residual uncertainty

- Child processes exit immediately after explicit restore hooks. The tests do not simulate power loss during the filesystem write, sync, or rename operation itself.
- A journal created by pre-cycle-5 code for an absent target has no absence marker and retains the older recovery interpretation.
- The new branch now has exact-path ownership evidence, but the test does not inject a Windows deletion failure during fresh-target cleanup.
- The earlier non-blocking note remains. A failed SQLite `ROLLBACK` does not explicitly poison or close the database handle.
- Restore remains a closed-store API with no renderer or product-facing command in WP-02.
- Electron still reports Node's experimental warning for `node:sqlite`.

This PASS applies only to the cycle-5 tester gate. It does not mark WP-02 verified. The manager still needs the required fresh read-only review.
