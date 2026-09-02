import { z } from "zod";

import {
  BrowserWorkerLeaseSchema,
  ConfirmedPatternMatchSchema,
  ManagerQueueEntrySchema,
  ManagerSessionLinkSchema,
  type BrowserWorkerLease,
  type ConfirmedPatternMatch,
  type ManagerQueueEntry,
  type ManagerSessionLink,
} from "../../shared/index.js";
import type { StudiSqliteDatabase } from "./database.js";
import { StorageError, errorMessage } from "./errors.js";

type JsonRow = { record_json: string };
type QueueRow = JsonRow & {
  task_id: string;
  assignment_id: string;
  course_id: string;
  due_at: string | null;
  priority: number;
  enqueued_at: string;
};

function parseValue<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  try {
    return schema.parse(value);
  } catch (error) {
    throw new StorageError(
      "record_validation_failed",
      `Invalid ${label}: ${errorMessage(error)}`,
      { recordType: label },
      { cause: error },
    );
  }
}

function parseRow<T>(schema: z.ZodType<T>, row: JsonRow, label: string): T {
  try {
    return schema.parse(JSON.parse(row.record_json));
  } catch (error) {
    throw new StorageError(
      "record_validation_failed",
      `Stored ${label} failed validation: ${errorMessage(error)}`,
      { recordType: label },
      { cause: error },
    );
  }
}

function recordJson<T>(schema: z.ZodType<T>, value: T): string {
  return JSON.stringify(schema.parse(value));
}

function assertColumns(
  label: string,
  recordId: string,
  actual: Readonly<Record<string, string | number | null>>,
  expected: Readonly<Record<string, string | number | null>>,
): void {
  const mismatches = Object.keys(expected).filter((column) => actual[column] !== expected[column]);
  if (mismatches.length > 0) {
    throw new StorageError(
      "record_validation_failed",
      `Stored ${label} columns do not match the validated record JSON`,
      { recordId, mismatches },
    );
  }
}

function parseQueueRow(row: QueueRow): ManagerQueueEntry {
  const entry = parseRow(ManagerQueueEntrySchema, row, "manager queue entry");
  assertColumns(
    "manager queue entry",
    entry.taskId,
    {
      task_id: row.task_id,
      assignment_id: row.assignment_id,
      course_id: row.course_id,
      due_at: row.due_at,
      priority: row.priority,
      enqueued_at: row.enqueued_at,
    },
    {
      task_id: entry.taskId,
      assignment_id: entry.assignmentId,
      course_id: entry.courseId,
      due_at: entry.dueAt ?? null,
      priority: entry.priority,
      enqueued_at: entry.enqueuedAt,
    },
  );
  return entry;
}

export class ManagerStateRepository {
  constructor(private readonly database: StudiSqliteDatabase) {}

  confirmPatternMatch(value: unknown): ConfirmedPatternMatch {
    const match = parseValue(ConfirmedPatternMatchSchema, value, "confirmed pattern match");
    this.database.handle.prepare(`
      INSERT INTO confirmed_pattern_matches(
        assignment_id, course_id, pattern_id, confirmed_at, record_json
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(assignment_id, pattern_id) DO UPDATE SET
        course_id = excluded.course_id,
        confirmed_at = excluded.confirmed_at,
        record_json = excluded.record_json
    `).run(
      match.assignmentId,
      match.courseId,
      match.patternId,
      match.confirmedAt,
      recordJson(ConfirmedPatternMatchSchema, match),
    );
    return match;
  }

  listConfirmedPatterns(assignmentId: string, courseId: string): ConfirmedPatternMatch[] {
    const rows = this.database.handle.prepare(`
      SELECT assignment_id, course_id, pattern_id, confirmed_at, record_json
      FROM confirmed_pattern_matches
      WHERE assignment_id = ? AND course_id = ?
      ORDER BY confirmed_at, pattern_id
    `).all(assignmentId, courseId) as unknown as Array<JsonRow & {
      assignment_id: string;
      course_id: string;
      pattern_id: string;
      confirmed_at: string;
    }>;
    return rows.map((row) => {
      const match = parseRow(ConfirmedPatternMatchSchema, row, "confirmed pattern match");
      assertColumns(
        "confirmed pattern match",
        `${match.assignmentId}/${match.patternId}`,
        {
          assignment_id: row.assignment_id,
          course_id: row.course_id,
          pattern_id: row.pattern_id,
          confirmed_at: row.confirmed_at,
        },
        {
          assignment_id: match.assignmentId,
          course_id: match.courseId,
          pattern_id: match.patternId,
          confirmed_at: match.confirmedAt,
        },
      );
      return match;
    });
  }

  putQueueEntry(value: unknown): ManagerQueueEntry {
    const entry = parseValue(ManagerQueueEntrySchema, value, "manager queue entry");
    this.database.handle.prepare(`
      INSERT INTO manager_queue(
        task_id, assignment_id, course_id, due_at, priority, enqueued_at, record_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        assignment_id = excluded.assignment_id,
        course_id = excluded.course_id,
        due_at = excluded.due_at,
        priority = excluded.priority,
        enqueued_at = excluded.enqueued_at,
        record_json = excluded.record_json
    `).run(
      entry.taskId,
      entry.assignmentId,
      entry.courseId,
      entry.dueAt ?? null,
      entry.priority,
      entry.enqueuedAt,
      recordJson(ManagerQueueEntrySchema, entry),
    );
    return entry;
  }

  getQueueEntry(taskId: string): ManagerQueueEntry | null {
    const row = this.database.handle
      .prepare(`SELECT task_id, assignment_id, course_id, due_at, priority, enqueued_at, record_json
        FROM manager_queue WHERE task_id = ?`)
      .get(taskId) as QueueRow | undefined;
    return row ? parseQueueRow(row) : null;
  }

  listQueue(): ManagerQueueEntry[] {
    const rows = this.database.handle.prepare(`
      SELECT task_id, assignment_id, course_id, due_at, priority, enqueued_at, record_json
      FROM manager_queue
      ORDER BY priority DESC, due_at IS NULL, due_at, enqueued_at, task_id
    `).all() as unknown as QueueRow[];
    return rows.map(parseQueueRow);
  }

  steerNext(taskId: string): ManagerQueueEntry {
    return this.database.transaction(() => {
      const current = this.getQueueEntry(taskId);
      if (!current) {
        throw new StorageError("record_not_found", `Task ${taskId} is not in the manager queue`, {
          taskId,
        });
      }
      const row = this.database.handle
        .prepare("SELECT COALESCE(MAX(priority), 0) AS priority FROM manager_queue")
        .get() as { priority: number };
      return this.putQueueEntry({ ...current, priority: row.priority + 1 });
    });
  }

  removeQueueEntry(taskId: string): void {
    this.database.handle.prepare("DELETE FROM manager_queue WHERE task_id = ?").run(taskId);
  }

  acquireLease(taskId: string, acquiredAt: string): BrowserWorkerLease | null {
    const lease = BrowserWorkerLeaseSchema.parse({
      schemaVersion: 1,
      leaseId: "browser-worker",
      taskId,
      state: "acquiring",
      acquiredAt,
    });
    const result = this.database.handle.prepare(`
      INSERT INTO browser_worker_lease(lease_id, task_id, state, acquired_at, record_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(lease_id) DO NOTHING
    `).run(
      lease.leaseId,
      lease.taskId,
      lease.state,
      lease.acquiredAt,
      recordJson(BrowserWorkerLeaseSchema, lease),
    );
    return Number(result.changes) === 1 ? lease : null;
  }

  activateLease(
    taskId: string,
    workerSessionId: string,
    workerSessionPath: string,
  ): BrowserWorkerLease {
    return this.database.transaction(() => {
      const current = this.getLease();
      if (!current || current.taskId !== taskId || current.state !== "acquiring") {
        throw new StorageError("optimistic_revision_conflict", "Browser worker lease changed before activation", {
          taskId,
        });
      }
      const active = BrowserWorkerLeaseSchema.parse({
        ...current,
        state: "active",
        workerSessionId,
        workerSessionPath,
      });
      this.database.handle.prepare(`
        UPDATE browser_worker_lease SET state = ?, record_json = ?
        WHERE lease_id = ? AND task_id = ? AND state = ?
      `).run(
        active.state,
        recordJson(BrowserWorkerLeaseSchema, active),
        active.leaseId,
        active.taskId,
        current.state,
      );
      return active;
    });
  }

  getLease(): BrowserWorkerLease | null {
    const row = this.database.handle
      .prepare(`SELECT lease_id, task_id, state, acquired_at, record_json
        FROM browser_worker_lease WHERE lease_id = 'browser-worker'`)
      .get() as (JsonRow & {
        lease_id: string;
        task_id: string;
        state: string;
        acquired_at: string;
      }) | undefined;
    if (!row) return null;
    const lease = parseRow(BrowserWorkerLeaseSchema, row, "browser worker lease");
    assertColumns(
      "browser worker lease",
      lease.leaseId,
      {
        lease_id: row.lease_id,
        task_id: row.task_id,
        state: row.state,
        acquired_at: row.acquired_at,
      },
      {
        lease_id: lease.leaseId,
        task_id: lease.taskId,
        state: lease.state,
        acquired_at: lease.acquiredAt,
      },
    );
    return lease;
  }

  releaseLease(taskId?: string): boolean {
    const statement = taskId
      ? this.database.handle.prepare(
          "DELETE FROM browser_worker_lease WHERE lease_id = 'browser-worker' AND task_id = ?",
        )
      : this.database.handle.prepare(
          "DELETE FROM browser_worker_lease WHERE lease_id = 'browser-worker'",
        );
    const result = taskId ? statement.run(taskId) : statement.run();
    return Number(result.changes) === 1;
  }

  saveManagerSession(value: unknown): ManagerSessionLink {
    const link = parseValue(ManagerSessionLinkSchema, value, "manager session link");
    this.database.handle.prepare(`
      INSERT INTO manager_session(singleton_id, updated_at, record_json)
      VALUES ('manager', ?, ?)
      ON CONFLICT(singleton_id) DO UPDATE SET
        updated_at = excluded.updated_at,
        record_json = excluded.record_json
    `).run(link.updatedAt, recordJson(ManagerSessionLinkSchema, link));
    return link;
  }

  getManagerSession(): ManagerSessionLink | null {
    const row = this.database.handle
      .prepare(`SELECT updated_at, record_json FROM manager_session
        WHERE singleton_id = 'manager'`)
      .get() as (JsonRow & { updated_at: string }) | undefined;
    if (!row) return null;
    const link = parseRow(ManagerSessionLinkSchema, row, "manager session link");
    assertColumns(
      "manager session link",
      link.sessionId,
      { updated_at: row.updated_at },
      { updated_at: link.updatedAt },
    );
    return link;
  }
}

export function validateManagerRecords(database: StudiSqliteDatabase): void {
  const repository = new ManagerStateRepository(database);
  repository.listQueue();
  repository.getLease();
  repository.getManagerSession();
  const rows = database.handle.prepare(
    "SELECT record_json FROM confirmed_pattern_matches",
  ).all() as unknown as JsonRow[];
  for (const row of rows) {
    parseRow(ConfirmedPatternMatchSchema, row, "confirmed pattern match");
  }
}
