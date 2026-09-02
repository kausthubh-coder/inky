# WP-02 cycle 3 independent test report

Package: WP-02 local data  
Cycle: 3  
Role: independent tester  
Date: 2026-08-31  
Verdict: **PASS**

WP-02 cycle 3 passes its independent test gate. The three cycle-2 review blockers now have direct passing evidence. All retained storage, WP-01, foundation, Sites, protected-file, repository-shape, and Electron gates also pass.

I did not change production code or manager artifacts. I added one test file, `tests/storage/wp02-cycle-03-independent.test.mjs`, SHA-256 `037EFACD7A7B43D5A07CB87ECA7017E19C329EBBE2AC362C144B99A44C976D5D`.

The cycle-3 production files still match the implementer report:

```text
electron/storage/records.ts=27DABD2EAC920C00F374C0679F8CFD8120E0628F03ACF2BDD8086A3D3E72463F
electron/storage/backup.ts=1E543F764427D2BF061F478D401F0A5F7EB6114EA66E049E2DEC060C816B4906
electron/storage/database.ts=A7094B21A4EF6B073FD4D8868F5C5CBC4451C5FF5B2E954DB43B5DF51109ACB7
electron/storage/store.ts=61BA0A1B5E39BE82CDEC66E265B807D15364163A4E1B5F0F5C494809235F239C
```

The four retained test files also match their recorded hashes. No assertion in them changed:

```text
tests/storage/storage.test.mjs=5065DCC526F8C54F49480E1EDEB0BD22BFCE7853F39137DBE1159C5F57008918
tests/storage/wp02-independent.test.mjs=3DB9C3BE4BF330CE030C04593F79B74A1C9C95EA553AF2FEE8B3AB4D9464166C
tests/storage/wp02-cycle-02-independent.test.mjs=373B8EA0A72FCC5AF4E480354551B782C43A070FA00AE422A6077C2ADAF86405
tests/storage/wp02-cycle-03-implement.test.mjs=D58A22BC6716322598E9B44422D5FF3F5B08E5AD1C812F6F1A0FB4EFDCDFCB75
```

## Review blocker verification

### Record validation before movement

The independent audit test starts with a complete backup containing an assignment, pattern permission rule, run, task-created event, and task projection. For each table, it copies the backup and adds an unknown field to `record_json` with SQLite `json_set`. The result remains valid JSON but fails the table's existing WP-01 Zod schema. Both public validation and restore reject all five copies with `backup_invalid`. The protected target record remains readable and no restore sibling or journal appears.

The same test then mutates each duplicated database column while leaving canonical JSON unchanged. It checks all 25 columns separately:

- assignments: identity, course, due time, and discovery time;
- permission rules: identity, scope, nullable course, assignment and pattern fields, and update time;
- runs: identity, task, state, revision, and update time;
- task events: identity, task, run, sequence, type, and occurrence time;
- task projections: identity, state, revision, and update time.

All 25 backups fail validation and restore before target movement. This catches a missing comparison for any one copied column, rather than sampling one column per table.

Static inspection agrees with the behavior. `validateDataRoot` opens the database read-only, checks health and schema shape, calls `validatePersistedRecords`, validates every artifact, and closes the handle. `validatePersistedRecords` imports and uses `AssignmentSchema`, `PermissionRuleSchema`, `RunSchema`, `TaskEventSchema`, and `TaskSchema`. It compares the columns listed above with the parsed record. Task-event `task_id` must match both the envelope aggregate ID and payload task ID. Repository getters and lists parse `record_json` before returning records, so raw stored JSON does not leave the storage package.

### Cleanup after a committed replacement

The independent roll-forward test creates an interrupted state with a valid staged replacement, a valid previous root, and a journal. Recovery installs and validates the replacement. An injected failure immediately before previous-root deletion does not block `openLocalStore`.

The active target returns the replacement, excludes the prior record, and accepts a new assignment write. The previous sibling and journal remain as retry state. A second open keeps both replacement records, removes the previous sibling and journal, and never swaps the prior root back into place.

### Invalid-target rollback and quarantine

The independent rollback test creates an invalid active target, a valid previous root, and a journal. Recovery quarantines the invalid target, restores and validates the previous root, then hits an injected failure immediately before quarantine deletion.

Startup still succeeds and the restored root accepts a new write. The quarantine and journal remain, while the previous sibling is gone. A second open preserves the restored records and removes the quarantine and journal. The test then performs a new public backup restore into the same target. It succeeds and clears all restore state, proving that no orphan path blocks later restore work.

## Commands and exit codes

Retained hash check, Electron build, and cycle-3 implementer regressions:

```text
npm run build:electron
exit 0

node --test tests/storage/wp02-cycle-03-implement.test.mjs
exit 0
4 passed, 0 failed
```

Independent cycle-3 regressions:

```text
npm run build:electron
exit 0

node --test tests/storage/wp02-cycle-03-independent.test.mjs
exit 0
3 passed, 0 failed
```

Type and complete storage gates:

```text
npm run typecheck
exit 0

npm run test:storage
exit 0
19 passed, 0 failed
```

The 19 storage tests rechecked fresh and idempotent migration, migration rollback, corrupt and future databases, schema shape, validated repository reads and queries, event and projection transaction coupling, sequence and revision conflicts, deletion and replay, invalid-stream rejection, artifact traversal and atomic replacement, malformed frontmatter, validation-first restore, live rollback, abrupt child-process recovery, record audit, cleanup retry, and later restore.

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

## Protected files and repository shape

The protected hash and repository-shape check exited 0:

```text
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

The workspace has no `.git` directory, so no Git status or diff is available. Hashes provide the retained-state check.

## Blockers

None.

## Residual uncertainty

- Cleanup failures use the storage failure injector at the call site that previously produced the Windows `EBUSY` failure. The tests do not depend on an unstable file-lock or ACL setup.
- The suite does not simulate power loss between filesystem sync and rename or enumerate every Windows filesystem error code.
- The known non-blocking review note remains. A failed SQLite `ROLLBACK` does not explicitly poison or close the database handle.
- Restore remains a closed-store API with no renderer or product-facing command in WP-02.
- Electron still reports Node's experimental warning for `node:sqlite`.

This PASS applies to the cycle-3 tester gate only. It does not mark WP-02 verified. The manager still needs the required fresh read-only review.
