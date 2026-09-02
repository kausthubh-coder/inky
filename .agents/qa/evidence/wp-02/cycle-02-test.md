# WP-02 cycle 2 independent test report

Package: WP-02 local data  
Cycle: 2  
Role: independent tester  
Date: 2026-08-31  
Verdict: **PASS**

WP-02 cycle 2 passes its independent test gate. Both cycle-1 blockers pass unchanged. The added variants found no new blocker in schema validation, validation-first restore, live rollback, hard-exit recovery, transaction coupling, replay, artifacts, corruption handling, or the Electron runtime boundary.

I did not change production code or manager artifacts. I added `tests/storage/wp02-cycle-02-independent.test.mjs`, SHA-256 `373B8EA0A72FCC5AF4E480354551B782C43A070FA00AE422A6077C2ADAF86405`.

The two cycle-2 production files still match the implementer report:

```text
electron/storage/database.ts=76D71012159051C460D7D047C0524D71A18FF72D485F3738C5DF34C2F395BE69
electron/storage/backup.ts=CB304377EE72102B2C990315CAC8CB8F52194522A9C14B27AB097F339E9B4EF2
```

## Retained cycle-1 blockers

Before adding a test, I verified that `tests/storage/wp02-independent.test.mjs` still had its recorded SHA-256 `3DB9C3BE4BF330CE030C04593F79B74A1C9C95EA553AF2FEE8B3AB4D9464166C`. I rebuilt Electron output and ran only the two original blocker assertions.

```text
npm run build:electron
exit 0

node --test --test-name-pattern='backup validation rejects|a restore error after moving' tests/storage/wp02-independent.test.mjs
exit 0
2 passed, 0 failed
```

The assertions were not edited or weakened. A version-1 backup missing `assignments` now fails validation before it can replace active data. A caught failure immediately after the active root moves now restores the prior root and preserves the assignment written after the backup.

## Independent variants

I added two compact tests rather than a permutation per schema object.

The schema-shape matrix kept `schema_migrations` at version 1 while applying one of these mutations to each backup:

- removed the required `permission_rules` table;
- renamed the required `runs.state` column;
- removed the named `task_projections_state` query index;
- rebuilt `task_events` without `UNIQUE(task_id, sequence)`.

For every mutation, both validation and restore rejected with `backup_invalid`. The target-only assignment remained readable, and no next root, previous root, or restore journal appeared.

The live rollback variant injected failure at `restore_after_previous_move`. The call rejected with `restore_failed` and an accurate message that the prior data root was not discarded. Both the backed-up assignment and the post-backup assignment survived. The next root, previous root, and journal were absent after rollback.

```text
npm run build:electron
exit 0

node --test tests/storage/wp02-cycle-02-independent.test.mjs
exit 0
2 passed, 0 failed
```

## Recovery and storage gate

I ran the existing abrupt-process case by itself. The child exited at the retained failure point with code 73. Reopen deterministically installed the staged backup, removed the post-backup assignment, restored the backed-up artifact, and cleared all restore siblings and the journal.

```text
node --test --test-name-pattern='hard interruption recovers' tests/storage/storage.test.mjs
exit 0
1 passed, 0 failed

npm run test:storage
exit 0
12 passed, 0 failed
```

The full storage run rechecked:

- migration rollback, idempotent reopen, corruption, and future-version failure without replacement;
- assignment, permission, and run validation on write and read;
- event and projection transaction rollback, sequence and revision checks, deletion, replay, and invalid-stream rejection;
- artifact traversal rejection, typed malformed-frontmatter diagnostics, failed-write atomicity, and temporary-file cleanup;
- valid backup restore, invalid backup rejection, live rollback, and abrupt-process recovery.

## Cleanup-authority inspection

I did not add a cleanup-failure test. The public failure injector has no cleanup point, and forcing a Windows deletion failure with process locks or ACL changes would be brittle.

The code keeps a valid active root authoritative. Recovery validates an existing target before it removes staging siblings. A sibling-removal error does not rename or delete that target. The installed-restore and live-rollback cleanup paths also run only after the active root validates, and they retain the journal when cleanup fails. This inspection found no path where cleanup failure alone swaps out a valid active root.

## Regression and runtime gates

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

The Electron 37.10.3 process used Node 22.21.1 and bundled `node:sqlite`. Its storage observation was:

```json
{"driver":"node:sqlite","node":"22.21.1","schemaVersion":1,"fileBacked":true,"reopened":true,"artifactRoundTrip":true,"backupValidated":true,"backupArtifactCount":1}
```

The same run passed invalid-profile rejection, renderer-load rejection, malformed-manifest rejection, malformed-runtime rejection, and owned self-test directory cleanup.

## Protected files and repository shape

```text
.openai/hosting.json=D532ABB65CF9AE20634B464D954CB4A08A0DE9F3CD3CDF7F9C3EC8948826D947
worker/index.js=2DD0615A445143933D88D4271F54F5D63EE951421FCD08C5A7617BB09C564389
scripts/prepare-sites-build.mjs=B6A6ADAA4FAB3234676116DD1C9CB6611275AB9D92DD26F5BF402393E3744BF6
tests/sites-worker.test.mjs=96AF7B48906C6460C793356D7B6952F7D5026DBF5A502BEC0D9297FF04201C26
```

`dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json` are present. Top-level `plans/` and `qa/` directories are absent.

## Blockers

None.

## Residual uncertainty

- I did not simulate power loss between filesystem flush and rename.
- I did not enumerate every Windows filesystem error code or force cleanup failure through OS locks. There is no stable public injection point for that branch.
- Restore remains a closed-store storage API with no renderer or user-facing route in WP-02.
- Electron still prints Node's experimental warning for `node:sqlite`.

This report passes the tester gate only. It does not mark WP-02 verified. The manager still needs the independent read-only review required by the dossier and build loop.
