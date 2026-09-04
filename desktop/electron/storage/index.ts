export {
  createLocalStoreBackup,
  createMigrationBackupIfNeeded,
  restoreLocalStoreBackup,
  validateLocalStoreBackup,
  type BackupValidation,
  type MigrationBackupOptions,
} from "./backup.js";
export {
  STORAGE_SCHEMA_VERSION,
  type StorageFailureInjector,
  type StorageFailurePoint,
  type StorageHealth,
} from "./database.js";
export { StorageError, isStorageError, type StorageErrorCode } from "./errors.js";
export { ManagerStateRepository } from "./manager-records.js";
export { LifecycleRepository } from "./lifecycle-records.js";
export { SchoolRepository } from "./school-records.js";
export { AgentJobRepository, agentTargetKey, type PersistedAgentJob } from "./agent-job-records.js";
export { NoteStore, type NoteListFilter, type NoteUpsertInput } from "./notes.js";
export { ProductPreferencesStore } from "./product-preferences.js";
export { HomeworkFiles, type HomeworkFileEntry } from "../files/homework-files.js";
export { LocalStore, openLocalStore, type OpenLocalStoreOptions } from "./store.js";
