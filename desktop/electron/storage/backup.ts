import { randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, join, parse, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

import { z } from "zod";

import { ArtifactStore, assertPlainArtifactTree } from "./artifacts.js";
import {
  STORAGE_SCHEMA_VERSION,
  StudiSqliteDatabase,
  type StorageFailureInjector,
} from "./database.js";
import { StorageError, errorMessage, isStorageError } from "./errors.js";
import { validatePersistedRecords } from "./records.js";
import { validateManagerRecords } from "./manager-records.js";
import { validateSchoolRecords } from "./school-records.js";
import { validateLifecycleRecords } from "./lifecycle-records.js";

const BACKUP_MANIFEST = "backup.json";
const DATABASE_FILE = "studi.sqlite3";
const ARTIFACT_DIRECTORY = "artifacts";

const BackupManifestSchema = z.strictObject({
  format: z.literal("studi-local-backup"),
  schemaVersion: z.literal(STORAGE_SCHEMA_VERSION),
  createdAt: z.iso.datetime({ offset: false, local: false }),
  artifactCount: z.number().int().nonnegative(),
  migration: z.strictObject({
    appVersion: z.string().min(1).max(64),
    fromSchemaVersion: z.number().int().min(1).max(STORAGE_SCHEMA_VERSION - 1),
    toSchemaVersion: z.literal(STORAGE_SCHEMA_VERSION),
  }).optional(),
});

const RestoreJournalSchema = z.strictObject({
  format: z.literal("studi-local-restore"),
  target: z.string().min(1),
  next: z.string().min(1),
  previous: z.string().min(1),
  targetExistedAtStart: z.literal(false).optional(),
});

export interface BackupValidation {
  readonly databasePath: string;
  readonly schemaVersion: typeof STORAGE_SCHEMA_VERSION;
  readonly artifactCount: number;
}

interface BackupSource {
  readonly rootDirectory: string;
  readonly database: StudiSqliteDatabase;
  readonly artifacts: ArtifactStore;
}

export interface MigrationBackupOptions {
  readonly directory: string;
  readonly appVersion: string;
}

export async function createMigrationBackupIfNeeded(
  sourceRootValue: string,
  options: MigrationBackupOptions,
): Promise<BackupValidation | null> {
  const sourceRoot = assertSafeRoot(sourceRootValue, "migration source");
  const sourceDatabasePath = join(sourceRoot, DATABASE_FILE);
  if (!(await pathExists(sourceDatabasePath))) return null;

  const sourceDatabase = new DatabaseSync(sourceDatabasePath, { readOnly: true });
  let fromSchemaVersion: number;
  try {
    assertRawDatabaseIntegrity(sourceDatabase, sourceDatabasePath);
    fromSchemaVersion = readRawSchemaVersion(sourceDatabase);
  } finally {
    sourceDatabase.close();
  }
  if (fromSchemaVersion === 0 || fromSchemaVersion === STORAGE_SCHEMA_VERSION) return null;
  if (fromSchemaVersion > STORAGE_SCHEMA_VERSION) return null;

  const backupDirectory = assertSafeRoot(options.directory, "migration backup directory");
  await mkdir(backupDirectory, { recursive: true });
  const safeAppVersion = options.appVersion.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
  if (!safeAppVersion) throw new StorageError("backup_invalid", "App version cannot name a migration backup");
  const destination = join(
    backupDirectory,
    `pre-migration-v${fromSchemaVersion}-to-v${STORAGE_SCHEMA_VERSION}-app-${safeAppVersion}`,
  );
  if (await pathExists(destination)) {
    const manifest = BackupManifestSchema.parse(
      JSON.parse(await readFile(join(destination, BACKUP_MANIFEST), "utf8")),
    );
    if (
      manifest.migration?.appVersion !== options.appVersion ||
      manifest.migration.fromSchemaVersion !== fromSchemaVersion
    ) {
      throw new StorageError("backup_invalid", "Existing migration backup does not match this migration", {
        destination,
      });
    }
    return validateLocalStoreBackup(destination);
  }

  const parent = dirname(destination);
  const stage = resolve(parent, `${basename(destination)}.studi-backup-${randomUUID()}`);
  assertSiblingWithPrefix(stage, parent, `${basename(destination)}.studi-backup-`);
  await mkdir(stage, { recursive: false });
  try {
    const source = new DatabaseSync(sourceDatabasePath, { readOnly: true });
    try {
      assertRawDatabaseIntegrity(source, sourceDatabasePath);
      await backup(source, join(stage, DATABASE_FILE));
    } finally {
      source.close();
    }
    await copyArtifacts(join(sourceRoot, ARTIFACT_DIRECTORY), join(stage, ARTIFACT_DIRECTORY));
    const migrated = new StudiSqliteDatabase(join(stage, DATABASE_FILE));
    migrated.close();
    const stagedData = await validateDataRoot(stage);
    const manifest = BackupManifestSchema.parse({
      format: "studi-local-backup",
      schemaVersion: STORAGE_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      artifactCount: stagedData.artifactCount,
      migration: {
        appVersion: options.appVersion,
        fromSchemaVersion,
        toSchemaVersion: STORAGE_SCHEMA_VERSION,
      },
    });
    await writeSyncedFile(join(stage, BACKUP_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    const validation = await validateLocalStoreBackup(stage);
    await rename(stage, destination);
    return { ...validation, databasePath: join(destination, DATABASE_FILE) };
  } catch (error) {
    await removeExactOwnedPath(stage, parent, `${basename(destination)}.studi-backup-`);
    if (isStorageError(error)) throw error;
    throw new StorageError(
      "backup_invalid",
      `Pre-migration backup failed: ${errorMessage(error)}`,
      { sourceRoot, destination },
      { cause: error },
    );
  }
}

export async function createLocalStoreBackup(
  source: BackupSource,
  destinationValue: string,
): Promise<BackupValidation> {
  const destination = assertSafeRoot(destinationValue, "backup destination");
  const parent = dirname(destination);
  const stage = resolve(parent, `${basename(destination)}.studi-backup-${randomUUID()}`);
  assertSiblingWithPrefix(stage, parent, `${basename(destination)}.studi-backup-`);
  if (await pathExists(destination)) {
    throw new StorageError(
      "backup_destination_exists",
      `Backup destination already exists: ${destination}`,
      { destination },
    );
  }
  await mkdir(stage, { recursive: false });

  try {
    await backup(source.database.handle, join(stage, DATABASE_FILE));
    await copyArtifacts(source.artifacts.rootDirectory, join(stage, ARTIFACT_DIRECTORY));
    const stagedData = await validateDataRoot(stage);
    const manifest = BackupManifestSchema.parse({
      format: "studi-local-backup",
      schemaVersion: STORAGE_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      artifactCount: stagedData.artifactCount,
    });
    await writeSyncedFile(join(stage, BACKUP_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    const validation = await validateLocalStoreBackup(stage);
    await rename(stage, destination);
    return { ...validation, databasePath: join(destination, DATABASE_FILE) };
  } catch (error) {
    await removeExactOwnedPath(stage, parent, `${basename(destination)}.studi-backup-`);
    if (isStorageError(error)) {
      throw error;
    }
    throw new StorageError(
      "backup_invalid",
      `Backup creation failed: ${errorMessage(error)}`,
      { destination },
      { cause: error },
    );
  }
}

export async function validateLocalStoreBackup(
  backupDirectoryValue: string,
): Promise<BackupValidation> {
  const backupDirectory = assertSafeRoot(backupDirectoryValue, "backup directory");
  try {
    const manifest = BackupManifestSchema.parse(
      JSON.parse(await readFile(join(backupDirectory, BACKUP_MANIFEST), "utf8")),
    );
    const validation = await validateDataRoot(backupDirectory);
    if (manifest.artifactCount !== validation.artifactCount) {
      throw new Error(
        `Artifact count mismatch: manifest ${manifest.artifactCount}, actual ${validation.artifactCount}`,
      );
    }
    return validation;
  } catch (error) {
    if (isStorageError(error) && error.code === "corrupt_database") {
      throw new StorageError(
        "backup_invalid",
        `Backup database is corrupt: ${error.message}`,
        { backupDirectory },
        { cause: error },
      );
    }
    if (isStorageError(error) && error.code === "backup_invalid") {
      throw error;
    }
    throw new StorageError(
      "backup_invalid",
      `Backup validation failed for ${backupDirectory}: ${errorMessage(error)}`,
      { backupDirectory },
      { cause: error },
    );
  }
}

export async function restoreLocalStoreBackup(
  backupDirectoryValue: string,
  targetValue: string,
  options: { readonly failureInjector?: StorageFailureInjector } = {},
): Promise<BackupValidation> {
  const validation = await validateLocalStoreBackup(backupDirectoryValue);
  const backupDirectory = resolve(backupDirectoryValue);
  const target = assertSafeRoot(targetValue, "restore target");
  await recoverInterruptedRestore(target, options.failureInjector);

  const paths = restorePaths(target);
  if (
    (await pathExists(paths.next)) ||
    (await pathExists(paths.previous)) ||
    (await pathExists(paths.journal)) ||
    (await pathExists(paths.journalTemporary))
  ) {
    throw new StorageError("restore_failed", "Restore staging paths are unexpectedly occupied", {
      target,
    });
  }

  const targetExistedAtStart = await pathExists(target);
  let previousMoved = false;
  let installed: BackupValidation;
  try {
    await writeRestoreJournal(paths, targetExistedAtStart);
    options.failureInjector?.("restore_after_journal_publish");
    await mkdir(paths.next, { recursive: false });
    await cp(join(backupDirectory, DATABASE_FILE), join(paths.next, DATABASE_FILE), {
      errorOnExist: true,
      force: false,
    });
    options.failureInjector?.("restore_during_staging_population");
    await copyArtifacts(
      join(backupDirectory, ARTIFACT_DIRECTORY),
      join(paths.next, ARTIFACT_DIRECTORY),
    );
    await validateDataRoot(paths.next);
    options.failureInjector?.("restore_after_staging_population");

    if (targetExistedAtStart) {
      await rename(target, paths.previous);
      previousMoved = true;
      options.failureInjector?.("restore_after_previous_move");
    }
    await rename(paths.next, target);
    installed = await validateDataRoot(target);
  } catch (error) {
    if (previousMoved) {
      try {
        await rollbackLiveRestore(target, paths);
      } catch (rollbackError) {
        throw new StorageError(
          "restore_failed",
          `Restore failed and the prior data root could not be put back: ${errorMessage(rollbackError)}`,
          {
            target,
            backupDirectory,
            previous: paths.previous,
            originalError: errorMessage(error),
            rollbackIncomplete: true,
          },
          { cause: rollbackError },
        );
      }
    } else {
      await discardUninstalledRestore(paths);
    }
    if (isStorageError(error)) {
      throw error;
    }
    throw new StorageError(
      "restore_failed",
      `Restore failed without discarding the prior data root: ${errorMessage(error)}`,
      { target, backupDirectory },
      { cause: error },
    );
  }

  await finishValidTargetRestore(paths, options.failureInjector);
  return installed;
}

export async function recoverInterruptedRestore(
  targetValue: string,
  failureInjector?: StorageFailureInjector,
): Promise<void> {
  const target = assertSafeRoot(targetValue, "data root");
  const paths = restorePaths(target);
  if (!(await pathExists(paths.journal))) {
    await removeJournalTemporary(paths);
    return;
  }

  let journal;
  try {
    journal = RestoreJournalSchema.parse(
      JSON.parse(await readFile(paths.journal, "utf8")),
    );
  } catch (error) {
    throw new StorageError(
      "restore_failed",
      `Restore journal is malformed: ${errorMessage(error)}`,
      { journal: paths.journal },
      { cause: error },
    );
  }
  if (
    journal.target !== paths.target ||
    journal.next !== paths.next ||
    journal.previous !== paths.previous
  ) {
    throw new StorageError("restore_failed", "Restore journal paths do not match the data root", {
      journal: paths.journal,
    });
  }

  if (await pathExists(target)) {
    let targetValidationError: unknown;
    try {
      await validateDataRoot(target);
    } catch (error) {
      targetValidationError = error;
    }

    if (targetValidationError === undefined) {
      await finishValidTargetRestore(paths, failureInjector);
      return;
    }

    if (!(await pathExists(paths.previous))) {
      throw targetValidationError;
    }
    if (await pathExists(paths.next)) {
      throw new StorageError(
        "restore_failed",
        "An invalid active root cannot move aside because the restore staging path is occupied",
        { target, next: paths.next, previous: paths.previous },
        { cause: targetValidationError },
      );
    }
    await rename(target, paths.next);
    await rename(paths.previous, target);
    await validateDataRoot(target);
    await finishValidTargetRestore(paths, failureInjector);
    return;
  }

  if (journal.targetExistedAtStart === false) {
    if (await pathExists(paths.previous)) {
      throw new StorageError(
        "restore_failed",
        "A fresh-target restore unexpectedly has a previous data root",
        { target, previous: paths.previous },
      );
    }
    if (await pathExists(paths.next)) {
      await removeRestoreSibling(paths.next, paths);
    }
    await removeJournal(paths);
    return;
  }

  if (await pathExists(paths.next)) {
    let nextIsValid = false;
    try {
      await validateDataRoot(paths.next);
      nextIsValid = true;
    } catch {
      // Roll back to the prior root below if it is available.
    }
    if (nextIsValid) {
      await rename(paths.next, target);
      await validateDataRoot(target);
      await finishValidTargetRestore(paths, failureInjector);
      return;
    }
  }
  if (await pathExists(paths.previous)) {
    await rename(paths.previous, target);
    await validateDataRoot(target);
    await finishValidTargetRestore(paths, failureInjector);
    return;
  }
  throw new StorageError("restore_failed", "Interrupted restore has no recoverable data root", {
    target,
  });
}

async function validateDataRoot(root: string): Promise<BackupValidation> {
  const databasePath = join(root, DATABASE_FILE);
  const database = new StudiSqliteDatabase(databasePath, { readOnly: true, migrate: false });
  try {
    const health = database.health();
    validatePersistedRecords(database);
    validateManagerRecords(database);
    validateSchoolRecords(database);
    validateLifecycleRecords(database);
    const artifacts = new ArtifactStore(join(root, ARTIFACT_DIRECTORY), database);
    const artifactCount = await artifacts.validateAll();
    return {
      databasePath,
      schemaVersion: health.schemaVersion,
      artifactCount,
    };
  } finally {
    database.close();
  }
}

async function copyArtifacts(source: string, destination: string): Promise<void> {
  if (await pathExists(source)) {
    await assertPlainArtifactTree(source);
    await cp(source, destination, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: async (sourcePath) => {
        const metadata = await lstat(sourcePath);
        if (metadata.isSymbolicLink()) {
          throw new StorageError("backup_invalid", "Artifact copy refused a symbolic link", {
            source: sourcePath,
          });
        }
        return true;
      },
    });
  } else {
    await mkdir(destination, { recursive: true });
  }
}

function assertRawDatabaseIntegrity(database: DatabaseSync, databasePath: string): void {
  const messages = (database.prepare("PRAGMA quick_check").all() as Array<Record<string, unknown>>)
    .flatMap((row) => Object.values(row))
    .map(String);
  if (messages.length !== 1 || messages[0] !== "ok") {
    throw new StorageError("corrupt_database", "SQLite quick_check reported corruption", {
      databasePath,
      messages,
    });
  }
}

function readRawSchemaVersion(database: DatabaseSync): number {
  const migrationTable = database
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get() as { present: number } | undefined;
  if (!migrationTable) return 0;
  const row = database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as {
    version: number | null;
  };
  return row.version ?? 0;
}

interface RestorePaths {
  readonly target: string;
  readonly next: string;
  readonly previous: string;
  readonly journal: string;
  readonly journalTemporary: string;
}

function restorePaths(target: string): RestorePaths {
  const parent = dirname(target);
  const name = basename(target);
  const paths = {
    target,
    next: resolve(parent, `${name}.studi-restore-next`),
    previous: resolve(parent, `${name}.studi-restore-previous`),
    journal: resolve(parent, `${name}.studi-restore-journal.json`),
    journalTemporary: resolve(parent, `${name}.studi-restore-journal.json.tmp`),
  };
  assertExactSibling(paths.next, parent, `${name}.studi-restore-next`);
  assertExactSibling(paths.previous, parent, `${name}.studi-restore-previous`);
  assertExactSibling(paths.journal, parent, `${name}.studi-restore-journal.json`);
  assertExactSibling(paths.journalTemporary, parent, `${name}.studi-restore-journal.json.tmp`);
  return paths;
}

async function writeRestoreJournal(
  paths: RestorePaths,
  targetExistedAtStart: boolean,
): Promise<void> {
  const journal = RestoreJournalSchema.parse({
    format: "studi-local-restore",
    target: paths.target,
    next: paths.next,
    previous: paths.previous,
    ...(targetExistedAtStart ? {} : { targetExistedAtStart: false }),
  });
  await writeSyncedFile(paths.journalTemporary, `${JSON.stringify(journal)}\n`);
  await rename(paths.journalTemporary, paths.journal);
}

async function writeSyncedFile(path: string, content: string): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function removeRestoreSibling(path: string, paths: RestorePaths): Promise<void> {
  if (path !== paths.next && path !== paths.previous) {
    throw new StorageError("restore_failed", "Refused to remove an unowned restore path", { path });
  }
  await rm(path, { recursive: true, force: false });
}

async function removeJournal(paths: RestorePaths): Promise<void> {
  await removeJournalTemporary(paths);
  await rm(paths.journal, { force: true });
}

async function removeJournalTemporary(paths: RestorePaths): Promise<void> {
  await rm(paths.journalTemporary, { force: true });
}

async function rollbackLiveRestore(target: string, paths: RestorePaths): Promise<void> {
  if (!(await pathExists(paths.previous))) {
    throw new StorageError("restore_failed", "The prior data root is missing during rollback", {
      previous: paths.previous,
    });
  }

  if (await pathExists(target)) {
    if (await pathExists(paths.next)) {
      throw new StorageError(
        "restore_failed",
        "Both the installed and staged restore roots exist during rollback",
        { target, next: paths.next, previous: paths.previous },
      );
    }
    await rename(target, paths.next);
  }
  await rename(paths.previous, target);
  await validateDataRoot(target);

  try {
    if (await pathExists(paths.next)) {
      await removeRestoreSibling(paths.next, paths);
    }
    await removeJournal(paths);
  } catch {
    // The prior root is live again. The retained journal makes sibling cleanup retryable on open.
  }
}

async function discardUninstalledRestore(paths: RestorePaths): Promise<void> {
  try {
    if (await pathExists(paths.next)) {
      await removeRestoreSibling(paths.next, paths);
    }
    await removeJournal(paths);
  } catch {
    // The active root never moved. A retained journal or stage is safe to recover on open.
  }
}

async function finishValidTargetRestore(
  paths: RestorePaths,
  failureInjector?: StorageFailureInjector,
): Promise<void> {
  try {
    if (await pathExists(paths.next)) {
      failureInjector?.("restore_before_next_cleanup");
      await removeRestoreSibling(paths.next, paths);
    }
    if (await pathExists(paths.previous)) {
      failureInjector?.("restore_before_previous_cleanup");
      await removeRestoreSibling(paths.previous, paths);
    }
    await removeJournal(paths);
  } catch {
    // Installation already validated. Keep the journal so the next open can finish cleanup.
  }
}

async function removeExactOwnedPath(path: string, parent: string, prefix: string): Promise<void> {
  assertSiblingWithPrefix(path, parent, prefix);
  if (await pathExists(path)) {
    await rm(path, { recursive: true, force: false });
  }
}

function assertExactSibling(path: string, parent: string, expectedName: string): void {
  const name = basename(path);
  if (dirname(path) !== resolve(parent) || name !== expectedName) {
    throw new StorageError("restore_failed", "Refused an unsafe owned-path operation", { path });
  }
}

function assertSiblingWithPrefix(path: string, parent: string, expectedPrefix: string): void {
  const name = basename(path);
  if (dirname(path) !== resolve(parent) || !name.startsWith(expectedPrefix)) {
    throw new StorageError("restore_failed", "Refused an unsafe owned-path operation", { path });
  }
}

function assertSafeRoot(pathValue: string, label: string): string {
  const path = resolve(pathValue);
  if (path === parse(path).root || basename(path).length === 0) {
    throw new StorageError("restore_failed", `${label} cannot be a filesystem root`, { path });
  }
  return path;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
