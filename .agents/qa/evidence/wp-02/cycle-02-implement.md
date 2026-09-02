# WP-02 cycle 2 implementer report

Package: WP-02 local data  
Cycle: 2  
Role: implementer  
Date: 2026-08-31  
Disposition: implementation complete, not verified

This cycle fixes the two blockers from the cycle-1 independent test report. The manager still needs a fresh tester and a read-only reviewer before it can verify WP-02.

## Baseline

I retained `tests/storage/wp02-independent.test.mjs` unchanged. Its SHA-256 remains `3DB9C3BE4BF330CE030C04593F79B74A1C9C95EA553AF2FEE8B3AB4D9464166C`.

Before production edits:

```text
npm run test:storage
exit 1
10 tests: 8 passed, 2 failed
```

The failures matched cycle 1:

- Backup validation accepted a schema-version-1 database after `assignments` was dropped. Restore then replaced the healthy target.
- An injected `restore_after_previous_move` error rejected the live call but installed the backup, losing the assignment written after that backup.

## Production behavior changed

### Version-1 schema shape

`electron/storage/database.ts` now checks the actual schema after migration, on a version-1 reopen, for a read-only backup open, and during health checks.

The check is deliberately tied to migration 1. It requires the exact ordered column name, SQLite type, nullability flag, and primary-key position for these six tables:

- `schema_migrations`
- `assignments`
- `permission_rules`
- `runs`
- `task_events`
- `task_projections`

It also requires the named query indexes on assignments, permission rules, runs, and task projections, plus the unique `task_events(task_id, sequence)` constraint index. Index identity, uniqueness, origin, partial status, and ordered columns must match. Extra unrelated SQLite objects do not cause rejection.

A missing or changed required object raises `database_open_failed` for an active store. `validateLocalStoreBackup` converts that diagnostic to `backup_invalid`, so restore rejects the source before it moves the active root. The retained dropped-table assertion passes. A file-free mutation probe also proved that dropping `assignments_course_due` and renaming `assignments.course_id` are rejected.

### Live restore rollback

`electron/storage/backup.ts` no longer invokes hard-exit recovery from the live restore catch path. It tracks whether the active root moved to the `previous` sibling.

If an error occurs after that move and before the replacement validates:

1. If the replacement already occupies the target, restore renames it to the now-absent `next` sibling.
2. Restore renames `previous` back to the now-absent target.
3. Restore validates the prior root before it rejects the original operation.
4. It removes the staged root and journal when possible. If cleanup fails after the prior root is live, the journal remains so the next open can retry cleanup.

This sequence works with Windows directory rename behavior because it never asks `rename` to replace an existing directory. The last known-good root stays at `previous` until it can move back to the target. If rollback itself cannot finish, the error reports `rollbackIncomplete: true` with the target and previous paths. It does not delete the prior root.

A validated replacement is the commit point. Cleanup trouble after that point no longer makes the API report that restore failed. The journal remains if cleanup needs another attempt.

### Hard-exit recovery

The hard-exit policy remains deterministic and separate from live rollback:

- A valid target wins. Recovery removes owned staging siblings and the journal.
- If the target is absent and `next` validates, recovery installs `next` and then removes `previous`.
- If `next` is absent or invalid, recovery restores `previous`.
- Recovery now separates active-root validation from sibling cleanup. Failure to delete a sibling cannot make it swap out a valid active root.

The existing child-process fixture still exits with code 73 immediately after the active root moves. The next open rolls forward to the staged backup and clears all three restore siblings.

## Files changed

- `electron/storage/database.ts`
- `electron/storage/backup.ts`
- `.agents/qa/evidence/wp-02/cycle-02-implement.md`

No test, package, shared-contract, Electron entrypoint, UI, manager plan, dossier, ledger, conclusion, `AGENTS.md`, or protected Sites file changed. Build commands refreshed generated files below `dist/`; I did not hand-edit them.

## Commands and exit codes

Final focused order on the source fingerprint below:

```text
npm run build:electron
exit 0

node --test tests/storage/wp02-independent.test.mjs
exit 0
5 passed, 0 failed

npm run typecheck
exit 0

npm run test:storage
exit 0
10 passed, 0 failed
```

Additional schema mutation probe:

```text
node --input-type=module -e "import assert from 'node:assert/strict'; import {mkdtemp,rm} from 'node:fs/promises'; import {tmpdir} from 'node:os'; import {join} from 'node:path'; import {DatabaseSync} from 'node:sqlite'; import {openLocalStore} from './dist/electron/storage/index.js'; const workspace=await mkdtemp(join(tmpdir(),'studi-wp02-shape-probe-')); try { for (const [name,sql] of [['index','DROP INDEX assignments_course_due'],['column','ALTER TABLE assignments RENAME COLUMN course_id TO changed_course_id']]) { const root=join(workspace,name); const store=await openLocalStore(root); store.close(); const raw=new DatabaseSync(join(root,'studi.sqlite3')); raw.exec(sql); raw.close(); await assert.rejects(openLocalStore(root),(error)=>error.code==='database_open_failed'); console.log(name+' mutation rejected'); } } finally { await rm(workspace,{recursive:true,force:true,maxRetries:10,retryDelay:100}); }"
exit 0
index mutation rejected
column mutation rejected
```

Final regression and runtime gates:

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

The Electron 37.10.3 observation was:

```json
{"driver":"node:sqlite","node":"22.21.1","schemaVersion":1,"fileBacked":true,"reopened":true,"artifactRoundTrip":true,"backupValidated":true,"backupArtifactCount":1}
```

The same Electron run passed invalid-profile, renderer-load, malformed-manifest, malformed-runtime, and owned-directory cleanup checks.

Protected-file and build-shape check:

```text
exit 0
.openai/hosting.json=D532ABB65CF9AE20634B464D954CB4A08A0DE9F3CD3CDF7F9C3EC8948826D947
worker/index.js=2DD0615A445143933D88D4271F54F5D63EE951421FCD08C5A7617BB09C564389
scripts/prepare-sites-build.mjs=B6A6ADAA4FAB3234676116DD1C9CB6611275AB9D92DD26F5BF402393E3744BF6
tests/sites-worker.test.mjs=96AF7B48906C6460C793356D7B6952F7D5026DBF5A502BEC0D9297FF04201C26
dist/client/index.html present
dist/server/index.js present
dist/.openai/hosting.json present
top-level plans/ absent
top-level qa/ absent
```

## Reproducible source fingerprint

The workspace has no `.git` directory. I used the cycle-1 19-file source set plus the retained independent test. The report itself and generated `dist/` files are excluded.

To reproduce, sort the paths below, compute uppercase SHA-256 for each file, join `path=SHA256` lines with LF and no trailing LF, encode that manifest as UTF-8, then hash it with SHA-256.

- Source fingerprint: `01DD56817049FE62B05D22F6BFFD00D4C3BEC6AC550933AC5F8C0177005FAA78`

```text
electron/main.ts=567951A5ED1C9EC2D3B4B8F10BEBD52C7DF01A84E4759116F30AA50D98A74065
electron/storage/artifacts.ts=D6B29CA1B1734361CA8459E07CF01323048A09E0C0C870ACDF347F17569B4F9D
electron/storage/backup.ts=CB304377EE72102B2C990315CAC8CB8F52194522A9C14B27AB097F339E9B4EF2
electron/storage/database.ts=76D71012159051C460D7D047C0524D71A18FF72D485F3738C5DF34C2F395BE69
electron/storage/errors.ts=D3A3261024ABEDB70A55939CA9682EE5F53A66945C1BB6F59E9C37F444F7FC6F
electron/storage/index.ts=9C075314A080EAED8A2529C5CEBEAF427B8DA4B2D861F5A6E1D578046EA03EDD
electron/storage/records.ts=F59894B5165F5909FC434B81D8A939F9D35F94B4C4F7E92B4660C5F9879D1A73
electron/storage/store.ts=45C22E3547AD0B55547BCEC45E0C72802402E62135C3512FCB56278E4CEF5E11
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
tests/storage/wp02-independent.test.mjs=3DB9C3BE4BF330CE030C04593F79B74A1C9C95EA553AF2FEE8B3AB4D9464166C
```

## Remaining uncertainty

- Electron still prints Node's experimental warning for `node:sqlite`. The driver remains isolated in the storage package.
- The tests cover a real Windows rename path, a caught failure after the first directory move, and a hard child-process exit at that point. They do not simulate power loss between filesystem flushes and renames or enumerate every Windows filesystem error code.
- Schema shape validation checks the operational version-1 tables, columns, primary-key positions, and indexes. It does not compare raw `sqlite_master` DDL text byte for byte.
- Restore remains a closed-store API with no renderer route or product-facing command in WP-02.

WP-02 is not marked verified by this report.
