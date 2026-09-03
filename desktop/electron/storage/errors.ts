export type StorageErrorCode =
  | "corrupt_database"
  | "schema_too_new"
  | "migration_failed"
  | "database_open_failed"
  | "record_validation_failed"
  | "record_not_found"
  | "optimistic_revision_conflict"
  | "event_sequence_invalid"
  | "invalid_event_stream"
  | "invalid_artifact_path"
  | "malformed_frontmatter"
  | "artifact_write_failed"
  | "backup_invalid"
  | "backup_destination_exists"
  | "restore_failed";

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: StorageErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StorageError";
    this.code = code;
    this.details = details;
  }
}

export function isStorageError(error: unknown): error is StorageError {
  return error instanceof StorageError;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
