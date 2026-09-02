# WP-02 cycle 4 independent review

Package: WP-02 local data  
Cycle: 4  
Role: read-only reviewer  
Task: `01a05a11-3b3e-7702-b813-f1a6c5647cb8`  
Verdict: **CHANGES_REQUIRED**

One blocking recovery gap remains for restores into a fresh, absent target.

- After an abrupt exit immediately after journal publication, the journal exists while `target`, `next`, and `previous` do not. Recovery reports no recoverable data root. Both startup and later restore remain blocked.
- After an exit during staging population, only the database may be copied. Recovery currently accepts the partial `next` root because a missing artifact directory is treated as an empty valid store, then installs it. The reviewer reproduced a successful reopen with the backed-up preference artifact silently missing.

The cycle-4 tests covered these crash points only when an active target already existed. Fresh-location restore is an approved WP-02 contract. Recovery must distinguish a restore that began without a target and discard incomplete exact-owned staging state so a later restore can retry. It must not install partial staging.

All other requested checks passed. Journal publication is atomic and synced; task histories replay during validation; projections are compared; artifact links are rejected at every traversed level; removal authority is exact-owned; Windows rename ordering and the commit point are clear; no duplicate state machine, renderer storage route, generic SQL IPC, speculative abstraction, or material test bloat was found. Reviewer made no workspace edits.
