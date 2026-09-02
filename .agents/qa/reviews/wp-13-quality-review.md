# WP-13 quality review

Date: 2026-09-02  
Role: single read-only reviewer  
Verdict: **good**  
Quality score: **8.5/10**

## Disposition

Accept the implementation **without another implementation pass**. I found no concrete correctness, privacy, packaging-path, migration, or maintainability defect that warrants repair for the current private beta.

The remaining OpenAI device authorization is a real human handoff and therefore a verification stop, not an implementation failure. WP-13 should not be described as fully live-verified beyond that point until the tester resumes the same profile and completes the remaining provider, school, diagnostics, tray/restart, and retention journey. That continuation needs no code repair based on the present evidence.

## Quality and reader load

The important owners and decisions are quick to trace:

- Forge owns the packaged application. Packaged entrypoints resolve from `dist`, the icon resolves from `process.resourcesPath`, development URLs are ignored in packaged execution, and mutable state continues to resolve from Electron `userData`.
- `openLocalStore` is the single migration entry. It recovers an interrupted restore, creates the versioned migration backup when an older supported schema is present, and only then opens the live database. The new path reuses the existing backup manifest, validation, artifact-copy, and restore machinery rather than introducing another persistence format.
- `electron/diagnostics.ts` owns one export policy. The main process supplies runtime, storage health, telemetry switches, and the typed inspector; the module drops non-allowlisted properties and redacts allowed strings before writing one JSON document. The renderer receives only a filename/timestamp receipt.
- Runtime version has one source: `app.getVersion()`. The same value appears in the IPC projection, diagnostics, migration manifest naming, telemetry metadata, and Settings rather than being copied into renderer state or a second release registry.

The resulting control flow is direct. I found no duplicate diagnostics collector, packaging adapter, migration framework, version registry, or second mutable-state owner.

## Secret exclusion

The diagnostics boundary is appropriately defensive for the data it can actually receive. Telemetry event properties are schema-bound before entering the inspector; `distinctId`, `task_id`, storage paths, and other identifiers are then omitted by the diagnostics allowlist. Debug summaries produced by the current telemetry service contain an error class and boundary, not raw exception text, and the export applies a second string-redaction pass.

The focused canary test passed, and my read-only inspection of the final ZIP found **0** `.env*` or `node_modules/.vite` entries across 29,894 archive entries. The final archive hash matches the implementer report: `470756C49F5BE864113E0428016A5176C4D9AC6CAC23C63E3533515AAEBB15B7`. The required executable, renderer, main entry, Pi package, icon, and third-party notice entries are present. The four protected Sites source hashes also match the retained evidence.

## Migration and recovery shape

The migration backup is created off to the side from the old live database, migrated to the current schema, validated through the normal record/artifact validators, manifested with app/from/to versions, and published by rename. This is a proportionate recovery shape for the current additive schema migrations: restore stays on the one current backup format and the live pre-migration root is not mutated until the validated copy exists.

The focused migration test proves one backup is created, existing assignment data survives, the live store reaches schema 4, the manifest records the transition, and the backup restores through the normal recovery path. The staged migration does not preserve a raw historic-schema database, but the current migrations are additive and the live source remains untouched when staged migration or validation fails. A second legacy restore format would add more current cost than safety.

## Portable ZIP judgment

The portable ZIP is a proportionate temporary transport for this small, unsigned private beta. The repaired unpacked Forge application launches with an external working directory, restores the approved Clerk/Convex identity and product settings, loads only packaged renderer/runtime paths, and starts a real OpenAI device-code flow. The final ZIP is the exact self-contained package tree, is 200.9 MiB compressed / 543.4 MiB uncompressed, and contains no rejected environment/cache entries. Keeping ASAR disabled avoids a custom Pi/native dependency pruner after two operationally disproportionate ASAR attempts.

This tradeoff does **not** prove the dossier's literal native-installer, Start-menu, update-over-install, or uninstall/reinstall statements. Those must remain explicit private-beta limitations in the conclusion. If a native installer is still a non-negotiable product pass condition, that is a manager scope decision rather than evidence of a defect in the reviewed ZIP implementation. For the current prompt's accepted private-beta release shape, it is non-blocking.

## WP-10–12 packaged-release impact

The focused repairs remain restrained in the packaged build:

- Approved/offline auth readiness is derived from the existing kernel composition root; no second readiness state was added. The packaged user test reaching the approved account and populated local settings is direct evidence that this repaired startup boundary works.
- Dashboard eligibility is one pure projection over profile, retained workflow revision, and completed partial/success coverage. A later failed scan no longer erases a previously valid dashboard route.
- The handoff deadline is one optional durable field owned by the existing assignment execution record. The same deadline drives UI copy, recovery, kernel wakeup, Markdown preservation, and lease release.
- Memory visibility is read at the existing library, direct-read, and manager-prompt boundaries. It introduces no memory registry or parallel selection store.
- Removing the unused OAuth access-token field reduces retained credential surface without changing the provider boundary.

These changes improve the packaged release and do not introduce a new current maintenance problem.

## Unnecessary code and useful follow-ups

No unnecessary production layer blocks acceptance. One small subtraction opportunity remains: the configured Squirrel maker, `electron-squirrel-startup` dependency/import, and Squirrel-specific startup branch do not participate in the current ZIP deliverable because no native maker artifact was produced. If the installer is explicitly deferred beyond WP-13, removing that inert path would make the declared release shape more honest. If the next release immediately resumes native-installer work, retaining the single Forge maker is low reader load. This is not worth another implementation cycle now.

Other non-blocking follow-ups are evidence tasks, not code requests:

- Resume the same normal-user test after the permitted human completes OpenAI device authorization.
- Do not claim Start-menu install, update-over-install, uninstall/reinstall, or persistent signed-in school-browser retention until those exact boundaries are exercised by a native installer or explicitly removed from the release contract.
- Keep the ZIP size and ASAR decision visible as beta limitations; do not add an updater, generic release framework, broader platform matrix, or speculative pruning layer for this package.

## Checks used

- Retained implementer gates report `npm test`, storage, auth, telemetry, agent, Sites, repaired package, and external-working-directory packaged self-test green.
- Read-only focused rerun: `node --test tests/packaging/diagnostics.test.mjs tests/storage/migration-backup.test.mjs tests/contracts/product-projection.test.mjs` — 4/4 passed.
- Read-only artifact inspection confirmed the reported ZIP SHA-256, required entries, zero forbidden environment/cache paths, and matching protected-source hashes.
- The normal-user test is green through approved Clerk/Convex restore and a real OpenAI device-code handoff, then correctly stops for human authorization.

I changed no production code, automated tests, package configuration, plans, skills, evidence, release artifacts, or conclusions. This reviewer report is the only file added.
