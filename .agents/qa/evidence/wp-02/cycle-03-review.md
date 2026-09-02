# WP-02 cycle 3 independent review

Package: WP-02 local data  
Cycle: 3  
Role: read-only reviewer  
Task: `01a059f9-c7d5-7f93-82f2-0f5b809694ec`  
Verdict: **CHANGES_REQUIRED**

## Blocking findings

1. **Restore can strand an unjournaled staging root.** `backup.ts` creates and populates the fixed `next` directory before writing the journal. An abrupt exit in that interval leaves `next` behind. Startup ignores it because no journal exists, while every later restore fails on the occupied path. The journal is also written directly to its final name, so an exit during the write can leave malformed JSON that blocks startup. Publish the journal atomically before staging and retain abrupt-exit tests for both windows.

2. **Backup validation accepts logically invalid task histories.** `validateDataRoot` validates individual rows and duplicated columns, but does not replay each task event stream or compare a stored projection with replay. A task-created event whose canonical and duplicated sequence both change from 0 to 1 passes the row audit and restores, then fails during replay. Validate every stream and compare existing projections with their replayed task before movement.

3. **Artifact validation can follow a kind-directory symlink outside the owned root.** `ArtifactStore.validateAll` reads the expected kind directories without first rejecting a symlink at that directory level, while artifact copying preserves nested symlinks. A crafted `artifacts/preferences` symlink can validate and survive restore, allowing later reads and writes outside the data root. Reject symlinks at every traversed directory level before validation or copying.

## Other conclusions

The cycle-2 blockers are closed in production. Full record and duplicated-column auditing exists, validated installation is the restore commit point, and failed prior-root or quarantine cleanup retains the journal for retry. Transactions, Windows rename ordering, YAML alias and prototype behavior, main-process ownership, and absence of storage IPC are sound. The failed-rollback handle remains a non-blocking hardening item. Reviewer made no workspace edits.
