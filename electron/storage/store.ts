import { join, resolve } from "node:path";

import { ArtifactStore } from "./artifacts.js";
import {
  createLocalStoreBackup,
  createMigrationBackupIfNeeded,
  recoverInterruptedRestore,
  type BackupValidation,
  type MigrationBackupOptions,
} from "./backup.js";
import {
  StudiSqliteDatabase,
  type StorageFailureInjector,
  type StorageHealth,
} from "./database.js";
import {
  AssignmentRepository,
  PermissionRuleRepository,
  RunRepository,
  TaskRepository,
} from "./records.js";
import { ManagerStateRepository } from "./manager-records.js";
import { LifecycleRepository } from "./lifecycle-records.js";
import { SchoolRepository } from "./school-records.js";
import { ProductPreferencesStore } from "./product-preferences.js";

export interface OpenLocalStoreOptions {
  readonly failureInjector?: StorageFailureInjector;
  readonly migrationBackup?: MigrationBackupOptions;
}

export class LocalStore {
  readonly rootDirectory: string;
  readonly databasePath: string;
  readonly database: StudiSqliteDatabase;
  readonly assignments: AssignmentRepository;
  readonly permissionRules: PermissionRuleRepository;
  readonly runs: RunRepository;
  readonly tasks: TaskRepository;
  readonly artifacts: ArtifactStore;
  readonly manager: ManagerStateRepository;
  readonly lifecycle: LifecycleRepository;
  readonly school: SchoolRepository;
  readonly productPreferences: ProductPreferencesStore;

  constructor(rootDirectory: string, options: OpenLocalStoreOptions = {}) {
    this.rootDirectory = resolve(rootDirectory);
    this.databasePath = join(this.rootDirectory, "studi.sqlite3");
    this.database = new StudiSqliteDatabase(this.databasePath, {
      ...(options.failureInjector === undefined
        ? {}
        : { failureInjector: options.failureInjector }),
    });
    this.assignments = new AssignmentRepository(this.database);
    this.permissionRules = new PermissionRuleRepository(this.database);
    this.runs = new RunRepository(this.database);
    this.tasks = new TaskRepository(this.database);
    this.manager = new ManagerStateRepository(this.database);
    this.lifecycle = new LifecycleRepository(this.database);
    this.school = new SchoolRepository(this.database);
    this.artifacts = new ArtifactStore(join(this.rootDirectory, "artifacts"), this.database);
    this.productPreferences = new ProductPreferencesStore(join(this.rootDirectory, "product-preferences.json"));
  }

  health(): StorageHealth {
    return this.database.health();
  }

  backup(destination: string): Promise<BackupValidation> {
    return createLocalStoreBackup(this, destination);
  }

  close(): void {
    this.database.close();
  }
}

export async function openLocalStore(
  rootDirectory: string,
  options: OpenLocalStoreOptions = {},
): Promise<LocalStore> {
  await recoverInterruptedRestore(rootDirectory, options.failureInjector);
  if (options.migrationBackup) {
    await createMigrationBackupIfNeeded(rootDirectory, options.migrationBackup);
  }
  return new LocalStore(rootDirectory, options);
}
