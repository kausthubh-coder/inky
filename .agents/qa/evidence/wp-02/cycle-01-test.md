# WP-02 cycle 1 independent test report

Package: WP-02 local data  
Cycle: 1  
Role: independent tester  
Date: 2026-08-31  
Verdict: **FAIL**

Two restore-boundary failures block WP-02. The focused implementation tests pass, as do all regression gates, but the backup validator accepts a structurally incomplete schema and a caught restore failure can discard post-backup data while reporting that the restore failed.

I did not change production code. I added one independent test file, `tests/storage/wp02-independent.test.mjs`, with SHA-256 `3DB9C3BE4BF330CE030C04593F79B74A1C9C95EA553AF2FEE8B3AB4D9464166`.

All 19 files in the implementer's source fingerprint still match the hashes recorded in `cycle-01-implement.md`. Test execution refreshed generated files under `dist/`.

## Blocking findings

### 1. Backup validation accepts a version-1 database with a required table removed

Severity: blocking  
Reproduction: `tests/storage/wp02-independent.test.mjs:190`

The test creates a valid backup, drops the `assignments` table while leaving `schema_migrations` at version 1, then asks the public validator and restore operation to process it. SQLite `quick_check` still reports `ok` because the file is internally consistent. The current validator accepts the backup, restore accepts it, and a healthy target-only assignment becomes unreadable after replacement.

Observed result:

```text
actual   { validationAccepted: true, restoreAccepted: true, targetRecordSurvived: false }
expected { validationAccepted: false, restoreAccepted: false, targetRecordSurvived: true }
```

The path is concrete. `validateLocalStoreBackup` calls `validateDataRoot` at `electron/storage/backup.ts:107`. `validateDataRoot` opens the database read-only and calls `health` at `electron/storage/backup.ts:270`. `health` checks `PRAGMA quick_check` and the maximum migration version, but it does not verify the required tables, indexes, columns, or migration shape. A schema-version row can therefore vouch for an incomplete database.

This violates validation-first restore. A logically damaged backup can replace good active data.

### 2. A caught restore failure rolls forward while the API reports failure

Severity: blocking  
Reproduction: `tests/storage/wp02-independent.test.mjs:243`

The test creates a backup, writes a second assignment to the active store, then injects an error at `restore_after_previous_move`. The restore promise rejects with `restore_failed`, but the recovery call in the catch path installs the backup and removes the prior root. The assignment written after the backup is gone.

Observed result:

```text
restore result: rejected with restore_failed
post-backup assignment after reopen: null
```

At `electron/storage/backup.ts:167`, the active root has already moved to the previous sibling. The injected error enters the catch at line 176. That catch calls `recoverInterruptedRestore`. Because the target is absent and the staged next root is valid, recovery renames next into the target and later removes previous. The original error is then rethrown.

This is especially risky on Windows, where directory replacement can fail around the second rename. Callers receive a failure and may retry or assume the old state survived, while the first restore has already changed the data. The emitted error text also says the prior root was not discarded, which is false in this reproduction.

## What passed

The original five storage tests passed before the independent additions. They also remained green inside the ten-test run.

The independent passing cases proved:

- A fresh schema reaches version 1. Reopen does not rerun migration 1, does not call the migration failure hook, and leaves the exact migration row unchanged.
- Corrupt bytes and a future schema version fail without replacing the database. The implementation suite compares the file bytes before and after each rejected open.
- Injected task-creation and task-transition failures leave neither an event nor a projection change. Sequence gaps return `event_sequence_invalid`. A stale expected revision returns `optimistic_revision_conflict` without appending an event.
- Projection deletion and rebuild reproduce the task. A corrupted transition stream is rejected, and rebuild does not create a projection from it.
- Assignment, permission-rule, and run records round-trip. After direct SQL damage to each canonical JSON record, every repository rejects its read with `record_validation_failed`.
- Artifact IDs cannot traverse outside the owned directory. Malformed YAML frontmatter returns `malformed_frontmatter`. An injected pre-rename failure leaves the old Markdown file readable and removes the temporary file. The successful replacement path ran on this Windows host.
- A valid backup restores both a database assignment and a Markdown artifact into a fresh root.
- A hard process exit after moving the previous root recovers on the next `openLocalStore` call. It installs the staged backup and removes the next, previous, and journal siblings.
- The real Electron 37.10.3 runtime used Node 22.21.1 and `node:sqlite`. It wrote and reopened a file-backed database, round-tripped an artifact, validated a backup, rejected invalid self-test paths, and removed only the owned self-test directory.

The hard-exit recovery pass does not cancel the second blocking finding. Hard-exit recovery may roll forward by design because no caller received a failure result. The blocking case is a caught error returned to a live caller after recovery silently rolls forward.

## Commands and exit codes

### Focused storage baseline

```text
npm run test:storage
exit 0
5 passed, 0 failed
```

This was run before adding the independent test file. It proved the implementer's focused cases execute successfully on this Windows host.

### Focused storage with independent tests

```text
npm run test:storage
exit 1
10 tests: 8 passed, 2 failed
```

The two failures are the blocking reproductions above. The other eight tests passed in the same process.

### Type and regression gates

```text
npm run typecheck
exit 0

npm test
exit 0
49 contract tests passed
12 foundation tests passed

npm run test:sites
exit 0
4 tests passed

npm run test:electron
exit 0
```

The Electron observation was:

```json
{"driver":"node:sqlite","node":"22.21.1","schemaVersion":1,"fileBacked":true,"reopened":true,"artifactRoundTrip":true,"backupValidated":true,"backupArtifactCount":1}
```

The same run passed invalid-profile, renderer-load, malformed-manifest, malformed-runtime, and owned-directory cleanup checks.

## Protected files and repository shape

The protected hashes remain unchanged:

```text
.openai/hosting.json              D532ABB65CF9AE20634B464D954CB4A08A0DE9F3CD3CDF7F9C3EC8948826D947
worker/index.js                   2DD0615A445143933D88D4271F54F5D63EE951421FCD08C5A7617BB09C564389
scripts/prepare-sites-build.mjs   B6A6ADAA4FAB3234676116DD1C9CB6611275AB9D92DD26F5BF402393E3744BF6
tests/sites-worker.test.mjs       96AF7B48906C6460C793356D7B6952F7D5026DBF5A502BEC0D9297FF04201C26
```

`dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json` are present. Top-level `plans/` and `qa/` directories are absent.

## Residual uncertainty

- I did not simulate power loss between file sync and rename. The injected artifact failure and the real Windows replacement path both ran.
- I did not enumerate every Windows filesystem error code. The second blocker exercises the exact boundary after the first directory move and before the replacement move.
- I did not test a user-facing restore command because WP-02 has none. These tests call the storage API directly with the store closed, which matches the package boundary.

WP-02 should return to a fresh implementer cycle. The next tester should retain both failing assertions and rerun the full gate after production changes.
