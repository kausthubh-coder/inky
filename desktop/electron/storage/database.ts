import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { StorageError, errorMessage, isStorageError } from "./errors.js";

export const STORAGE_SCHEMA_VERSION = 6 as const;

export type StorageFailurePoint =
  | "migration_before_version"
  | "task_before_projection"
  | "artifact_before_rename"
  | "note_after_rename_before_index"
  | "restore_after_journal_publish"
  | "restore_during_staging_population"
  | "restore_after_staging_population"
  | "restore_after_previous_move"
  | "restore_before_next_cleanup"
  | "restore_before_previous_cleanup";

export type StorageFailureInjector = (point: StorageFailurePoint) => void;

export interface StorageHealth {
  readonly status: "ok";
  readonly schemaVersion: typeof STORAGE_SCHEMA_VERSION;
  readonly databasePath: string;
  readonly integrity: "ok";
}

const migrationOne = `
  CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE assignments (
    assignment_id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL,
    due_at TEXT,
    discovered_at TEXT NOT NULL,
    record_json TEXT NOT NULL CHECK (json_valid(record_json))
  );
  CREATE INDEX assignments_course_due ON assignments(course_id, due_at);

  CREATE TABLE permission_rules (
    rule_id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    course_id TEXT,
    assignment_id TEXT,
    pattern_id TEXT,
    updated_at TEXT NOT NULL,
    record_json TEXT NOT NULL CHECK (json_valid(record_json))
  );
  CREATE INDEX permission_rules_scope ON permission_rules(scope, course_id, assignment_id);

  CREATE TABLE runs (
    run_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    state TEXT NOT NULL,
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    record_json TEXT NOT NULL CHECK (json_valid(record_json))
  );
  CREATE INDEX runs_task_state ON runs(task_id, state);

  CREATE TABLE task_events (
    event_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    type TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    record_json TEXT NOT NULL CHECK (json_valid(record_json)),
    UNIQUE(task_id, sequence)
  );

  CREATE TABLE task_projections (
    task_id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    record_json TEXT NOT NULL CHECK (json_valid(record_json))
  );
  CREATE INDEX task_projections_state ON task_projections(state, updated_at);
`;

const migrationTwo = `
  CREATE TABLE confirmed_pattern_matches (
    assignment_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    pattern_id TEXT NOT NULL,
    confirmed_at TEXT NOT NULL,
    record_json TEXT NOT NULL CHECK (json_valid(record_json)),
    PRIMARY KEY (assignment_id, pattern_id)
  );
  CREATE INDEX confirmed_pattern_matches_assignment
    ON confirmed_pattern_matches(assignment_id, course_id, confirmed_at);

  CREATE TABLE manager_queue (
    task_id TEXT PRIMARY KEY,
    assignment_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    due_at TEXT,
    priority INTEGER NOT NULL CHECK (priority >= 0),
    enqueued_at TEXT NOT NULL,
    record_json TEXT NOT NULL CHECK (json_valid(record_json))
  );
  CREATE INDEX manager_queue_order
    ON manager_queue(priority DESC, due_at, enqueued_at, task_id);

  CREATE TABLE browser_worker_lease (
    lease_id TEXT PRIMARY KEY CHECK (lease_id = 'browser-worker'),
    task_id TEXT NOT NULL,
    state TEXT NOT NULL,
    acquired_at TEXT NOT NULL,
    record_json TEXT NOT NULL CHECK (json_valid(record_json))
  );

  CREATE TABLE manager_session (
    singleton_id TEXT PRIMARY KEY CHECK (singleton_id = 'manager'),
    updated_at TEXT NOT NULL,
    record_json TEXT NOT NULL CHECK (json_valid(record_json))
  );
`;

const migrationThree = `
  CREATE TABLE school_profile (
    singleton_id TEXT PRIMARY KEY CHECK (singleton_id = 'primary-school'),
    updated_at TEXT NOT NULL,
    record_json TEXT NOT NULL CHECK (json_valid(record_json))
  );

  CREATE TABLE school_scans (
    scan_id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    record_json TEXT NOT NULL CHECK (json_valid(record_json))
  );
  CREATE INDEX school_scans_state_updated ON school_scans(state, updated_at);

  CREATE TABLE courses (
    course_id TEXT PRIMARY KEY,
    last_verified_scan_id TEXT NOT NULL,
    last_verified_at TEXT NOT NULL,
    record_json TEXT NOT NULL CHECK (json_valid(record_json))
  );
  CREATE INDEX courses_last_verified ON courses(last_verified_at, course_id);

  CREATE TABLE linked_systems (
    linked_system_id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    last_observed_scan_id TEXT NOT NULL,
    last_verified_scan_id TEXT,
    last_observed_at TEXT NOT NULL,
    record_json TEXT NOT NULL CHECK (json_valid(record_json))
  );
  CREATE INDEX linked_systems_state_observed
    ON linked_systems(state, last_observed_at, linked_system_id);
`;

const migrationFour = `
  CREATE TABLE automation_schedules (
    schedule_id TEXT PRIMARY KEY CHECK (schedule_id = 'school-scan'),
    state TEXT NOT NULL,
    cadence TEXT NOT NULL,
    next_run_at TEXT,
    updated_at TEXT NOT NULL,
    record_json TEXT NOT NULL CHECK (json_valid(record_json))
  );
  CREATE INDEX automation_schedules_due ON automation_schedules(state, next_run_at);

  CREATE TABLE assignment_executions (
    task_id TEXT PRIMARY KEY,
    assignment_id TEXT NOT NULL,
    phase TEXT NOT NULL,
    review_deadline TEXT,
    updated_at TEXT NOT NULL,
    record_json TEXT NOT NULL CHECK (json_valid(record_json))
  );
  CREATE INDEX assignment_executions_phase_deadline
    ON assignment_executions(phase, review_deadline, updated_at);

  CREATE TABLE execution_attempts (
    task_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 2),
    recorded_at TEXT NOT NULL,
    record_json TEXT NOT NULL CHECK (json_valid(record_json)),
    PRIMARY KEY (task_id, ordinal)
  );

  CREATE TABLE notification_intents (
    notification_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    delivered_at TEXT,
    clicked_at TEXT,
    record_json TEXT NOT NULL CHECK (json_valid(record_json))
  );
  CREATE INDEX notification_intents_delivery ON notification_intents(delivered_at, created_at);

  CREATE TABLE submission_receipts (
    receipt_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL UNIQUE,
    submitted_at TEXT NOT NULL,
    record_json TEXT NOT NULL CHECK (json_valid(record_json))
  );
`;

const migrationFive = `
  CREATE TABLE agent_jobs (
    job_id TEXT PRIMARY KEY,
    target_key TEXT NOT NULL UNIQUE,
    target_kind TEXT NOT NULL,
    subject_id TEXT,
    phase TEXT NOT NULL,
    turn_index INTEGER NOT NULL CHECK (turn_index >= 0),
    run_id TEXT NOT NULL,
    session_id TEXT,
    session_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    record_json TEXT NOT NULL CHECK (json_valid(record_json))
  );
  CREATE INDEX agent_jobs_phase_updated ON agent_jobs(phase, updated_at);

  CREATE TABLE agent_messages (
    message_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL CHECK (turn_index >= 0),
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    record_json TEXT NOT NULL CHECK (json_valid(record_json)),
    FOREIGN KEY (job_id) REFERENCES agent_jobs(job_id) ON DELETE CASCADE
  );
  CREATE INDEX agent_messages_job_turn ON agent_messages(job_id, turn_index, created_at, message_id);
`;

const migrationSix = `
  CREATE TABLE note_index (
    note_id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    about TEXT NOT NULL,
    note_key TEXT NOT NULL,
    title TEXT NOT NULL,
    markdown_path TEXT NOT NULL UNIQUE,
    revision INTEGER NOT NULL CHECK (revision > 0),
    content_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    record_json TEXT NOT NULL CHECK (json_valid(record_json)),
    UNIQUE(scope, subject_id, about, note_key)
  );
  CREATE INDEX note_index_scope_subject_updated
    ON note_index(scope, subject_id, about, updated_at, note_id);

  CREATE TABLE school_scan_workflow (
    workflow_id TEXT PRIMARY KEY CHECK (workflow_id = 'school-scan'),
    school_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    updated_at TEXT NOT NULL,
    record_json TEXT NOT NULL CHECK (json_valid(record_json))
  );

  UPDATE assignment_executions
  SET record_json = json_set(record_json, '$.taskBudget.maxAgentTurns', 24, '$.turnCount', COALESCE(json_extract(record_json, '$.turnCount'), 0))
  WHERE json_extract(record_json, '$.taskBudget.maxAgentTurns') = 1
     OR json_extract(record_json, '$.turnCount') IS NULL;
`;

const storageMigrations = [
  { version: 1, sql: migrationOne },
  { version: 2, sql: migrationTwo },
  { version: 3, sql: migrationThree },
  { version: 4, sql: migrationFour },
  { version: 5, sql: migrationFive },
  { version: 6, sql: migrationSix },
] as const;

type RequiredColumn = readonly [
  name: string,
  type: "INTEGER" | "TEXT",
  notNull: 0 | 1,
  primaryKeyOrder: 0 | 1 | 2,
];

const requiredTables = {
  schema_migrations: [
    ["version", "INTEGER", 0, 1],
    ["applied_at", "TEXT", 1, 0],
  ],
  assignments: [
    ["assignment_id", "TEXT", 0, 1],
    ["course_id", "TEXT", 1, 0],
    ["due_at", "TEXT", 0, 0],
    ["discovered_at", "TEXT", 1, 0],
    ["record_json", "TEXT", 1, 0],
  ],
  permission_rules: [
    ["rule_id", "TEXT", 0, 1],
    ["scope", "TEXT", 1, 0],
    ["course_id", "TEXT", 0, 0],
    ["assignment_id", "TEXT", 0, 0],
    ["pattern_id", "TEXT", 0, 0],
    ["updated_at", "TEXT", 1, 0],
    ["record_json", "TEXT", 1, 0],
  ],
  runs: [
    ["run_id", "TEXT", 0, 1],
    ["task_id", "TEXT", 1, 0],
    ["state", "TEXT", 1, 0],
    ["revision", "INTEGER", 1, 0],
    ["updated_at", "TEXT", 1, 0],
    ["record_json", "TEXT", 1, 0],
  ],
  task_events: [
    ["event_id", "TEXT", 0, 1],
    ["task_id", "TEXT", 1, 0],
    ["run_id", "TEXT", 1, 0],
    ["sequence", "INTEGER", 1, 0],
    ["type", "TEXT", 1, 0],
    ["occurred_at", "TEXT", 1, 0],
    ["record_json", "TEXT", 1, 0],
  ],
  task_projections: [
    ["task_id", "TEXT", 0, 1],
    ["state", "TEXT", 1, 0],
    ["revision", "INTEGER", 1, 0],
    ["updated_at", "TEXT", 1, 0],
    ["record_json", "TEXT", 1, 0],
  ],
  confirmed_pattern_matches: [
    ["assignment_id", "TEXT", 1, 1],
    ["course_id", "TEXT", 1, 0],
    ["pattern_id", "TEXT", 1, 2],
    ["confirmed_at", "TEXT", 1, 0],
    ["record_json", "TEXT", 1, 0],
  ],
  manager_queue: [
    ["task_id", "TEXT", 0, 1],
    ["assignment_id", "TEXT", 1, 0],
    ["course_id", "TEXT", 1, 0],
    ["due_at", "TEXT", 0, 0],
    ["priority", "INTEGER", 1, 0],
    ["enqueued_at", "TEXT", 1, 0],
    ["record_json", "TEXT", 1, 0],
  ],
  browser_worker_lease: [
    ["lease_id", "TEXT", 0, 1],
    ["task_id", "TEXT", 1, 0],
    ["state", "TEXT", 1, 0],
    ["acquired_at", "TEXT", 1, 0],
    ["record_json", "TEXT", 1, 0],
  ],
  manager_session: [
    ["singleton_id", "TEXT", 0, 1],
    ["updated_at", "TEXT", 1, 0],
    ["record_json", "TEXT", 1, 0],
  ],
  school_profile: [
    ["singleton_id", "TEXT", 0, 1],
    ["updated_at", "TEXT", 1, 0],
    ["record_json", "TEXT", 1, 0],
  ],
  school_scans: [
    ["scan_id", "TEXT", 0, 1],
    ["state", "TEXT", 1, 0],
    ["started_at", "TEXT", 1, 0],
    ["updated_at", "TEXT", 1, 0],
    ["completed_at", "TEXT", 0, 0],
    ["record_json", "TEXT", 1, 0],
  ],
  courses: [
    ["course_id", "TEXT", 0, 1],
    ["last_verified_scan_id", "TEXT", 1, 0],
    ["last_verified_at", "TEXT", 1, 0],
    ["record_json", "TEXT", 1, 0],
  ],
  linked_systems: [
    ["linked_system_id", "TEXT", 0, 1],
    ["state", "TEXT", 1, 0],
    ["last_observed_scan_id", "TEXT", 1, 0],
    ["last_verified_scan_id", "TEXT", 0, 0],
    ["last_observed_at", "TEXT", 1, 0],
    ["record_json", "TEXT", 1, 0],
  ],
  automation_schedules: [
    ["schedule_id", "TEXT", 0, 1],
    ["state", "TEXT", 1, 0],
    ["cadence", "TEXT", 1, 0],
    ["next_run_at", "TEXT", 0, 0],
    ["updated_at", "TEXT", 1, 0],
    ["record_json", "TEXT", 1, 0],
  ],
  assignment_executions: [
    ["task_id", "TEXT", 0, 1],
    ["assignment_id", "TEXT", 1, 0],
    ["phase", "TEXT", 1, 0],
    ["review_deadline", "TEXT", 0, 0],
    ["updated_at", "TEXT", 1, 0],
    ["record_json", "TEXT", 1, 0],
  ],
  execution_attempts: [
    ["task_id", "TEXT", 1, 1],
    ["ordinal", "INTEGER", 1, 2],
    ["recorded_at", "TEXT", 1, 0],
    ["record_json", "TEXT", 1, 0],
  ],
  notification_intents: [
    ["notification_id", "TEXT", 0, 1],
    ["kind", "TEXT", 1, 0],
    ["target_type", "TEXT", 1, 0],
    ["target_id", "TEXT", 1, 0],
    ["created_at", "TEXT", 1, 0],
    ["delivered_at", "TEXT", 0, 0],
    ["clicked_at", "TEXT", 0, 0],
    ["record_json", "TEXT", 1, 0],
  ],
  submission_receipts: [
    ["receipt_id", "TEXT", 0, 1],
    ["task_id", "TEXT", 1, 0],
    ["submitted_at", "TEXT", 1, 0],
    ["record_json", "TEXT", 1, 0],
  ],
  agent_jobs: [
    ["job_id", "TEXT", 0, 1],
    ["target_key", "TEXT", 1, 0],
    ["target_kind", "TEXT", 1, 0],
    ["subject_id", "TEXT", 0, 0],
    ["phase", "TEXT", 1, 0],
    ["turn_index", "INTEGER", 1, 0],
    ["run_id", "TEXT", 1, 0],
    ["session_id", "TEXT", 0, 0],
    ["session_path", "TEXT", 0, 0],
    ["created_at", "TEXT", 1, 0],
    ["updated_at", "TEXT", 1, 0],
    ["record_json", "TEXT", 1, 0],
  ],
  agent_messages: [
    ["message_id", "TEXT", 0, 1],
    ["job_id", "TEXT", 1, 0],
    ["turn_index", "INTEGER", 1, 0],
    ["role", "TEXT", 1, 0],
    ["created_at", "TEXT", 1, 0],
    ["record_json", "TEXT", 1, 0],
  ],
  note_index: [
    ["note_id", "TEXT", 0, 1],
    ["scope", "TEXT", 1, 0],
    ["subject_id", "TEXT", 1, 0],
    ["about", "TEXT", 1, 0],
    ["note_key", "TEXT", 1, 0],
    ["title", "TEXT", 1, 0],
    ["markdown_path", "TEXT", 1, 0],
    ["revision", "INTEGER", 1, 0],
    ["content_hash", "TEXT", 1, 0],
    ["updated_at", "TEXT", 1, 0],
    ["record_json", "TEXT", 1, 0],
  ],
  school_scan_workflow: [
    ["workflow_id", "TEXT", 0, 1],
    ["school_id", "TEXT", 1, 0],
    ["revision", "INTEGER", 1, 0],
    ["updated_at", "TEXT", 1, 0],
    ["record_json", "TEXT", 1, 0],
  ],
} as const satisfies Readonly<Record<string, readonly RequiredColumn[]>>;

const requiredIndexes = [
  {
    table: "assignments",
    name: "assignments_course_due",
    unique: 0,
    origin: "c",
    columns: ["course_id", "due_at"],
  },
  {
    table: "permission_rules",
    name: "permission_rules_scope",
    unique: 0,
    origin: "c",
    columns: ["scope", "course_id", "assignment_id"],
  },
  {
    table: "runs",
    name: "runs_task_state",
    unique: 0,
    origin: "c",
    columns: ["task_id", "state"],
  },
  {
    table: "task_events",
    unique: 1,
    origin: "u",
    columns: ["task_id", "sequence"],
  },
  {
    table: "task_projections",
    name: "task_projections_state",
    unique: 0,
    origin: "c",
    columns: ["state", "updated_at"],
  },
  {
    table: "confirmed_pattern_matches",
    name: "confirmed_pattern_matches_assignment",
    unique: 0,
    origin: "c",
    columns: ["assignment_id", "course_id", "confirmed_at"],
  },
  {
    table: "manager_queue",
    name: "manager_queue_order",
    unique: 0,
    origin: "c",
    columns: ["priority", "due_at", "enqueued_at", "task_id"],
  },
  {
    table: "school_scans",
    name: "school_scans_state_updated",
    unique: 0,
    origin: "c",
    columns: ["state", "updated_at"],
  },
  {
    table: "courses",
    name: "courses_last_verified",
    unique: 0,
    origin: "c",
    columns: ["last_verified_at", "course_id"],
  },
  {
    table: "linked_systems",
    name: "linked_systems_state_observed",
    unique: 0,
    origin: "c",
    columns: ["state", "last_observed_at", "linked_system_id"],
  },
  {
    table: "automation_schedules",
    name: "automation_schedules_due",
    unique: 0,
    origin: "c",
    columns: ["state", "next_run_at"],
  },
  {
    table: "assignment_executions",
    name: "assignment_executions_phase_deadline",
    unique: 0,
    origin: "c",
    columns: ["phase", "review_deadline", "updated_at"],
  },
  {
    table: "notification_intents",
    name: "notification_intents_delivery",
    unique: 0,
    origin: "c",
    columns: ["delivered_at", "created_at"],
  },
  {
    table: "submission_receipts",
    unique: 1,
    origin: "u",
    columns: ["task_id"],
  },
  {
    table: "agent_jobs",
    unique: 1,
    origin: "u",
    columns: ["target_key"],
  },
  {
    table: "agent_jobs",
    name: "agent_jobs_phase_updated",
    unique: 0,
    origin: "c",
    columns: ["phase", "updated_at"],
  },
  {
    table: "agent_messages",
    name: "agent_messages_job_turn",
    unique: 0,
    origin: "c",
    columns: ["job_id", "turn_index", "created_at", "message_id"],
  },
  {
    table: "note_index",
    unique: 1,
    origin: "u",
    columns: ["markdown_path"],
  },
  {
    table: "note_index",
    unique: 1,
    origin: "u",
    columns: ["scope", "subject_id", "about", "note_key"],
  },
  {
    table: "note_index",
    name: "note_index_scope_subject_updated",
    unique: 0,
    origin: "c",
    columns: ["scope", "subject_id", "about", "updated_at", "note_id"],
  },
] as const;

export class StudiSqliteDatabase {
  readonly handle!: DatabaseSync;
  readonly databasePath: string;
  readonly failureInjector: StorageFailureInjector | undefined;
  #closed = false;

  constructor(
    databasePath: string,
    options: {
      readonly readOnly?: boolean;
      readonly migrate?: boolean;
      readonly failureInjector?: StorageFailureInjector;
    } = {},
  ) {
    this.databasePath = databasePath;
    this.failureInjector = options.failureInjector;
    if (!options.readOnly) {
      mkdirSync(dirname(databasePath), { recursive: true });
    }

    let opened: DatabaseSync | undefined;
    try {
      opened = new DatabaseSync(databasePath, {
        readOnly: options.readOnly ?? false,
      });
      this.handle = opened;
      this.handle.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
      this.assertIntegrity();
      if (options.migrate !== false) {
        this.runMigrations();
      } else {
        this.assertSupportedSchema();
      }
    } catch (error) {
      try {
        opened?.close();
      } catch {
        // The original diagnostic is more useful than a close failure.
      }
      if (isStorageError(error)) {
        throw error;
      }
      const message = errorMessage(error);
      const corrupt = /(?:malformed|not a database|file is encrypted|disk image)/i.test(message);
      throw new StorageError(
        corrupt ? "corrupt_database" : "database_open_failed",
        corrupt
          ? `SQLite integrity check failed for ${databasePath}: ${message}`
          : `Could not open SQLite database ${databasePath}: ${message}`,
        { databasePath },
        { cause: error },
      );
    }
  }

  transaction<T>(operation: () => T): T {
    this.handle.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.handle.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.handle.exec("ROLLBACK");
      } catch {
        // Keep the operation error. The connection will not be reused if rollback failed.
      }
      throw error;
    }
  }

  injectFailure(point: StorageFailurePoint): void {
    this.failureInjector?.(point);
  }

  health(): StorageHealth {
    this.assertIntegrity();
    const schemaVersion = this.schemaVersion();
    if (schemaVersion !== STORAGE_SCHEMA_VERSION) {
      throw new StorageError("database_open_failed", "SQLite schema version changed while open", {
        databasePath: this.databasePath,
        schemaVersion,
      });
    }
    this.assertSchemaShape();
    return {
      status: "ok",
      schemaVersion,
      databasePath: this.databasePath,
      integrity: "ok",
    };
  }

  close(): void {
    if (!this.#closed) {
      this.handle.close();
      this.#closed = true;
    }
  }

  private assertIntegrity(): void {
    try {
      const rows = this.handle.prepare("PRAGMA quick_check").all() as Array<
        Record<string, unknown>
      >;
      const messages = rows.flatMap((row) => Object.values(row)).map(String);
      if (messages.length !== 1 || messages[0] !== "ok") {
        throw new StorageError("corrupt_database", "SQLite quick_check reported corruption", {
          databasePath: this.databasePath,
          messages,
        });
      }
    } catch (error) {
      if (isStorageError(error)) {
        throw error;
      }
      throw new StorageError(
        "corrupt_database",
        `SQLite integrity check failed for ${this.databasePath}: ${errorMessage(error)}`,
        { databasePath: this.databasePath },
        { cause: error },
      );
    }
  }

  private schemaVersion(): number {
    const migrationTable = this.handle
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get() as { present: number } | undefined;
    if (!migrationTable) {
      return 0;
    }

    const row = this.handle.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as {
      version: number | null;
    };
    return row.version ?? 0;
  }

  private assertSupportedSchema(): void {
    const version = this.schemaVersion();
    if (version > STORAGE_SCHEMA_VERSION) {
      throw new StorageError(
        "schema_too_new",
        `Database schema ${version} is newer than supported schema ${STORAGE_SCHEMA_VERSION}`,
        {
          databasePath: this.databasePath,
          foundVersion: version,
          supportedVersion: STORAGE_SCHEMA_VERSION,
        },
      );
    }
    if (version !== STORAGE_SCHEMA_VERSION) {
      throw new StorageError(
        "backup_invalid",
        `Expected database schema ${STORAGE_SCHEMA_VERSION}, found ${version}`,
        { databasePath: this.databasePath, foundVersion: version },
      );
    }
    this.assertSchemaShape();
  }

  private runMigrations(): void {
    const currentVersion = this.schemaVersion();
    if (currentVersion > STORAGE_SCHEMA_VERSION) {
      throw new StorageError(
        "schema_too_new",
        `Database schema ${currentVersion} is newer than supported schema ${STORAGE_SCHEMA_VERSION}`,
        {
          databasePath: this.databasePath,
          foundVersion: currentVersion,
          supportedVersion: STORAGE_SCHEMA_VERSION,
        },
      );
    }
    if (currentVersion === STORAGE_SCHEMA_VERSION) {
      this.assertSchemaShape();
      return;
    }

    try {
      this.transaction(() => {
        for (const migration of storageMigrations) {
          if (migration.version <= currentVersion) {
            continue;
          }
          this.handle.exec(migration.sql);
          if (migration.version === 1) {
            this.injectFailure("migration_before_version");
          }
          this.handle
            .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
            .run(migration.version, new Date().toISOString());
        }
      });
      this.assertSchemaShape();
    } catch (error) {
      if (isStorageError(error)) {
        throw error;
      }
      throw new StorageError(
        "migration_failed",
        `SQLite migration failed and was rolled back: ${errorMessage(error)}`,
        { databasePath: this.databasePath, fromVersion: currentVersion },
        { cause: error },
      );
    }
  }

  private assertSchemaShape(): void {
    const problems: string[] = [];
    const tableColumns = this.handle.prepare(
      'SELECT name, type, "notnull" AS not_null, pk FROM pragma_table_info(?) ORDER BY cid',
    );
    const tableIndexes = this.handle.prepare(
      'SELECT name, "unique" AS is_unique, origin, partial FROM pragma_index_list(?)',
    );
    const indexColumns = this.handle.prepare(
      "SELECT name FROM pragma_index_info(?) ORDER BY seqno",
    );

    for (const [table, expected] of Object.entries(requiredTables)) {
      const actual = tableColumns.all(table).map((row) => {
        const column = row as Record<string, unknown>;
        return [
          String(column.name),
          String(column.type).toUpperCase(),
          Number(column.not_null),
          Number(column.pk),
        ];
      });
      if (!sameRows(actual, expected)) {
        problems.push(`table ${table} has changed columns`);
      }
    }

    for (const expected of requiredIndexes) {
      const found = tableIndexes.all(expected.table).some((row) => {
        const index = row as Record<string, unknown>;
        const name = String(index.name);
        if (
          ("name" in expected && name !== expected.name) ||
          Number(index.is_unique) !== expected.unique ||
          String(index.origin) !== expected.origin ||
          Number(index.partial) !== 0
        ) {
          return false;
        }
        const columns = indexColumns
          .all(name)
          .map((columnRow) => String((columnRow as Record<string, unknown>).name));
        return sameRows(columns, expected.columns);
      });
      if (!found) {
        const label = "name" in expected ? expected.name : `${expected.table} unique sequence`;
        problems.push(`index ${label} is missing or changed`);
      }
    }

    if (problems.length > 0) {
      throw new StorageError(
        "database_open_failed",
        `SQLite schema ${STORAGE_SCHEMA_VERSION} does not match the required shape`,
        { databasePath: this.databasePath, problems },
      );
    }
  }
}

function sameRows(
  actual: readonly (readonly unknown[] | string)[],
  expected: readonly (readonly unknown[] | string)[],
): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}
