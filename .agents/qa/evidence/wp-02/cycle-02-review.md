# WP-02 cycle 2 independent review

Package: WP-02 local data  
Cycle: 2  
Role: read-only reviewer  
Task: `01a059d9-0178-79e3-a280-08cb5201c22c`  
Verdict: **CHANGES_REQUIRED**

The 12 storage tests passed, but the reviewer reproduced three concrete backup and recovery failures.

## Blocking findings

1. **Backup validation accepts records Studi cannot read.** `validateDataRoot` checks SQLite integrity, schema shape, and artifacts, but not the canonical records through their WP-01 schemas. A backup with valid JSON that fails `AssignmentSchema` validated and replaced healthy data; the later assignment read failed with `record_validation_failed`. Validation must parse every stored record and confirm indexed columns agree with canonical JSON before replacement. Retain regressions for invalid canonical JSON and mismatched query columns.

2. **A Windows cleanup failure after roll-forward can block startup.** After recovery installs and validates `next` as the active target, failure to remove `previous` is caught as if installation failed. Recovery then attempts to move `previous` onto an existing target. The reviewer reproduced an `EBUSY` result with a valid target, retained previous root, and journal. Installation must be separated from cleanup. Once the active target validates, cleanup failure must keep the journal for later cleanup without blocking startup.

3. **Invalid-target recovery leaves an orphan staging sibling.** The branch that moves an invalid target to `next`, restores `previous`, validates it, and removes the journal does not remove `next`. The next app start ignores the orphan, while later restores fail because the staging path is occupied. Remove the quarantined root before clearing the journal, or retain the journal until cleanup succeeds.

## Non-blocking conclusions

- `records.ts` remains cohesive enough for WP-02. Splitting it now would create movement without a clearer boundary.
- Frontmatter uses YAML core schema, unique keys, disabled aliases, and strict Zod objects. File-size or nesting limits are reasonable future hardening, not a WP-02 blocker.
- The version-1 schema descriptor is readable and catches required columns, keys, and indexes without brittle DDL byte comparison.
- Migration transactions are sound. A future hardening item is to poison or close the database handle if `ROLLBACK` itself fails.
- Storage remains main-process-only with no renderer database route or generic SQL IPC.
- The 12 tests remain distinct and proportionate.

Review command: `npm run test:storage`  
Result during review: 12 passed, 0 failed.  
Workspace edits by reviewer: none.
