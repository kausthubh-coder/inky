# WP-02 cycle 4 independent test report

Package: WP-02 local data  
Cycle: 4  
Role: independent tester  
Task: `01a05a09-f802-79b3-bfcc-16bab681f2ce`  
Date: 2026-08-31  
Verdict: **PASS**

Cycle 4 passes its independent test gate. The three cycle-3 review blockers have direct passing evidence. All 22 retained storage tests still run unchanged, and the three new independent tests bring the complete storage gate to 25 passed and 0 failed.

I did not change production code, retained tests, package configuration, shared contracts, protected files, the dossier, ledger, or other manager artifacts. I added only `tests/storage/wp02-cycle-04-independent.test.mjs` and this requested evidence report. Build commands refreshed generated files under `dist/`.

## Retained state

The cycle-04 production files match the implementer report:

```text
electron/storage/artifacts.ts=80EF5DE37374AD8D90E213301888EC26BAE41AC531BA19D3CAF7252B5B5D33E4
electron/storage/backup.ts=6F5310EDA108B5922607F1286B9ADC66B9D848F70502C75A53993C6B6239D145
electron/storage/database.ts=E8CBFA67F26ED550A6650263BA28D7C072DD11A75F6828E684881BCCD2B9BE28
electron/storage/records.ts=0A3BA438C7A3220F0725FD0E5D2F122022317707DE3A5EA6E90BABD5BBACFCCE
```

The six retained storage test files also match their recorded hashes. No assertion changed:

```text
tests/storage/storage.test.mjs=5065DCC526F8C54F49480E1EDEB0BD22BFCE7853F39137DBE1159C5F57008918
tests/storage/wp02-independent.test.mjs=3DB9C3BE4BF330CE030C04593F79B74A1C9C95EA553AF2FEE8B3AB4D9464166C
tests/storage/wp02-cycle-02-independent.test.mjs=373B8EA0A72FCC5AF4E480354551B782C43A070FA00AE422A6077C2ADAF86405
tests/storage/wp02-cycle-03-implement.test.mjs=D58A22BC6716322598E9B44422D5FF3F5B08E5AD1C812F6F1A0FB4EFDCDFCB75
tests/storage/wp02-cycle-03-independent.test.mjs=037EFACD7A7B43D5A07CB87ECA7017E19C329EBBE2AC362C144B99A44C976D5D
tests/storage/wp02-cycle-04-implement.test.mjs=E00399A86EA5117E492BD7466CD78BB568534F25526A54F0C4C4F2D7C4F433F0
```

The new independent test file has SHA-256 `C9B15205AE8CDB40A5CE2951F1C9B2FFB5960BBF35517935924ACA8E645F307C`.

## Independent blocker verification

### Durable journal before active-root movement

One compact child-process test exits at each required boundary:

- immediately after atomic journal publication and before staging;
- after staged database and artifacts validate, before the active root moves.

After each exit, the test reads and parses the published journal and checks its exact target, next, and previous paths. No temporary journal remains. `openLocalStore` starts successfully, keeps the original active assignment, removes every restore sibling and journal, and leaves no path that blocks a second operation. A later public restore succeeds and installs the backed-up assignment.

This proves that neither tested crash window strands staging state, blocks startup, loses the active root, exposes a malformed published journal, or prevents a later restore.

### Semantic task-history validation

One test creates a valid two-event task stream and projection, then checks two damaged backup copies:

- The transition remains valid under `TaskEventSchema`, while its `from` and `to` values make it impossible to replay from the origin state.
- The projection and its duplicated database columns remain valid under `TaskSchema`, but state and revision disagree with replay.

Public validation and restore reject both copies with `backup_invalid`. The protected target record remains readable and no restore state appears. The explicit schema parses prove the rejection comes from stream replay or projection comparison, not from individual row parsing.

### Artifact link ownership

One test places Windows directory junctions at the artifact root, expected kind directory, and Markdown-child level. For each boundary:

- backup copying rejects the source with `backup_invalid` and removes its staging destination;
- public backup validation rejects it;
- restore rejects it before target movement;
- no restore sibling or journal remains;
- the linked external payload remains byte-identical.

After all rejections, the active target writes and reads its own preference artifact. The three external payloads remain unchanged, so no linked path enables an out-of-root write.

## Static architecture inspection

`validatePersistedRecords` groups validated task events and calls the exported `replayTaskEvents` function. Repository replay and rebuild call that same function. The only task transition table in storage remains the imported `TASK_TRANSITIONS`; cycle 4 did not add another replay state machine.

Restore paths are the exact siblings `next`, `previous`, final journal, and temporary journal. `assertExactSibling` checks every resolved name. `removeRestoreSibling` accepts only `next` or `previous`. Journal cleanup names the one exact temporary file. There is no prefix scan, wildcard cleanup, generic filesystem transaction layer, or caller-selected cleanup path.

Artifact validation and copy both call `assertPlainArtifactTree`. It uses `lstat` at the artifact root, root entries, kind directories, and children. The copy filter also rejects symbolic links.

I found no duplicate state machine or broad abstraction added for these fixes.

## Commands and exit codes

Baseline before adding the independent test:

```text
npm run test:storage
exit 0
22 passed, 0 failed
```

Focused independent check:

```text
npm run build:electron
exit 0

node --test tests/storage/wp02-cycle-04-independent.test.mjs
exit 0
3 passed, 0 failed, 0 skipped
```

Type and complete storage gates:

```text
npm run typecheck
exit 0

npm run test:storage
exit 0
25 passed, 0 failed
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

The production-hash, retained-test-hash, protected-hash, source-reuse, and repository-shape script exited 0.

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

- The abrupt exits occur after explicit restore hooks. The tests do not simulate power loss during the kernel write, sync, or rename that publishes the journal.
- This Windows host permits directory junctions but rejects file-symlink creation with `EPERM`. The test covers junctions at all three requested levels. Static inspection confirms the same `lstat` symbolic-link rejection applies to a file symlink.
- The tests do not race a concurrent filesystem mutation between `lstat` and copy, and they do not enumerate every Windows filesystem error code.
- The earlier non-blocking note remains. A failed SQLite `ROLLBACK` does not explicitly poison or close the database handle.
- Restore remains a closed-store API with no renderer or product-facing command in WP-02.
- Electron still reports Node's experimental warning for `node:sqlite`.

This PASS applies only to the cycle-04 tester gate. It does not mark WP-02 verified. The manager still needs the required fresh read-only review.
