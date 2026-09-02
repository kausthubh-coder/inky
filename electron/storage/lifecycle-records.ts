import { z } from "zod";

import {
  AssignmentExecutionSchema,
  AutomationScheduleSchema,
  ExecutionAttemptSchema,
  NotificationIntentSchema,
  SubmissionReceiptSchema,
  type AssignmentExecution,
  type AutomationSchedule,
  type ExecutionAttempt,
  type NotificationIntent,
  type SubmissionReceipt,
} from "../../shared/index.js";
import type { StudiSqliteDatabase } from "./database.js";
import { StorageError, errorMessage } from "./errors.js";

type JsonRow = { record_json: string };
type ScheduleRow = JsonRow & { schedule_id: string; state: string; cadence: string; next_run_at: string | null; updated_at: string };
type ExecutionRow = JsonRow & { task_id: string; assignment_id: string; phase: string; review_deadline: string | null; updated_at: string };
type AttemptRow = JsonRow & { task_id: string; ordinal: number; recorded_at: string };
type NotificationRow = JsonRow & { notification_id: string; kind: string; target_type: string; target_id: string; created_at: string; delivered_at: string | null; clicked_at: string | null };
type ReceiptRow = JsonRow & { receipt_id: string; task_id: string; submitted_at: string };

function parseValue<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  try {
    return schema.parse(value);
  } catch (error) {
    throw new StorageError("record_validation_failed", `Invalid ${label}: ${errorMessage(error)}`, { recordType: label }, { cause: error });
  }
}

function parseRow<T>(schema: z.ZodType<T>, row: JsonRow, label: string): T {
  try {
    return schema.parse(JSON.parse(row.record_json));
  } catch (error) {
    throw new StorageError("record_validation_failed", `Stored ${label} failed validation: ${errorMessage(error)}`, { recordType: label }, { cause: error });
  }
}

function json<T>(schema: z.ZodType<T>, value: T): string {
  return JSON.stringify(schema.parse(value));
}

function assertColumns(label: string, id: string, actual: Record<string, unknown>, expected: Record<string, unknown>): void {
  const mismatches = Object.keys(expected).filter((column) => actual[column] !== expected[column]);
  if (mismatches.length) throw new StorageError("record_validation_failed", `Stored ${label} columns do not match the validated record JSON`, { recordId: id, mismatches });
}

function parseScheduleRow(row: ScheduleRow): AutomationSchedule {
  const record = parseRow(AutomationScheduleSchema, row, "automation schedule");
  assertColumns("automation schedule", record.scheduleId, row, { schedule_id: record.scheduleId, state: record.state, cadence: record.cadence, next_run_at: record.nextRunAt ?? null, updated_at: record.updatedAt });
  return record;
}

function parseExecutionRow(row: ExecutionRow): AssignmentExecution {
  const record = parseRow(AssignmentExecutionSchema, row, "assignment execution");
  assertColumns("assignment execution", record.taskId, row, { task_id: record.taskId, assignment_id: record.assignmentId, phase: record.phase, review_deadline: record.reviewDeadline ?? null, updated_at: record.updatedAt });
  return record;
}

function parseAttemptRow(row: AttemptRow): ExecutionAttempt {
  const record = parseRow(ExecutionAttemptSchema, row, "execution attempt");
  assertColumns("execution attempt", `${record.taskId}/${record.ordinal}`, row, { task_id: record.taskId, ordinal: record.ordinal, recorded_at: record.recordedAt });
  return record;
}

function parseNotificationRow(row: NotificationRow): NotificationIntent {
  const record = parseRow(NotificationIntentSchema, row, "notification intent");
  assertColumns("notification intent", record.notificationId, row, { notification_id: record.notificationId, kind: record.kind, target_type: record.target.type, target_id: record.target.id, created_at: record.createdAt, delivered_at: record.deliveredAt ?? null, clicked_at: record.clickedAt ?? null });
  return record;
}

function parseReceiptRow(row: ReceiptRow): SubmissionReceipt {
  const record = parseRow(SubmissionReceiptSchema, row, "submission receipt");
  assertColumns("submission receipt", record.receiptId, row, { receipt_id: record.receiptId, task_id: record.taskId, submitted_at: record.submittedAt });
  return record;
}

export class LifecycleRepository {
  constructor(private readonly database: StudiSqliteDatabase) {}

  putSchedule(value: unknown): AutomationSchedule {
    const schedule = parseValue(AutomationScheduleSchema, value, "automation schedule");
    this.database.handle.prepare(`
      INSERT INTO automation_schedules(schedule_id, state, cadence, next_run_at, updated_at, record_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(schedule_id) DO UPDATE SET state=excluded.state, cadence=excluded.cadence,
        next_run_at=excluded.next_run_at, updated_at=excluded.updated_at, record_json=excluded.record_json
    `).run(schedule.scheduleId, schedule.state, schedule.cadence, schedule.nextRunAt ?? null, schedule.updatedAt, json(AutomationScheduleSchema, schedule));
    return schedule;
  }

  getSchedule(): AutomationSchedule | null {
    const row = this.database.handle.prepare("SELECT schedule_id, state, cadence, next_run_at, updated_at, record_json FROM automation_schedules WHERE schedule_id = 'school-scan'").get() as ScheduleRow | undefined;
    return row ? parseScheduleRow(row) : null;
  }

  claimDueSchedule(now: string, nextRunAt: string): AutomationSchedule | null {
    return this.database.transaction(() => {
      const current = this.getSchedule();
      if (!current || current.state !== "enabled" || !current.nextRunAt || current.nextRunAt > now) return null;
      const claimed = current.nextRunAt;
      const next = this.putSchedule({ ...current, nextRunAt, lastClaimedOccurrence: claimed, updatedAt: now });
      return next.lastClaimedOccurrence === claimed ? next : null;
    });
  }

  putExecution(value: unknown): AssignmentExecution {
    const execution = parseValue(AssignmentExecutionSchema, value, "assignment execution");
    this.database.handle.prepare(`
      INSERT INTO assignment_executions(task_id, assignment_id, phase, review_deadline, updated_at, record_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET assignment_id=excluded.assignment_id, phase=excluded.phase,
        review_deadline=excluded.review_deadline, updated_at=excluded.updated_at, record_json=excluded.record_json
    `).run(execution.taskId, execution.assignmentId, execution.phase, execution.reviewDeadline ?? null, execution.updatedAt, json(AssignmentExecutionSchema, execution));
    return execution;
  }

  getExecution(taskId: string): AssignmentExecution | null {
    const row = this.database.handle.prepare("SELECT task_id, assignment_id, phase, review_deadline, updated_at, record_json FROM assignment_executions WHERE task_id = ?").get(taskId) as ExecutionRow | undefined;
    return row ? parseExecutionRow(row) : null;
  }

  getActiveExecution(): AssignmentExecution | null {
    const row = this.database.handle.prepare(`
      SELECT task_id, assignment_id, phase, review_deadline, updated_at, record_json FROM assignment_executions
      WHERE phase NOT IN ('submitted', 'preserved', 'failed')
      ORDER BY updated_at DESC, task_id LIMIT 1
    `).get() as ExecutionRow | undefined;
    return row ? parseExecutionRow(row) : null;
  }

  latestExecution(): AssignmentExecution | null {
    const row = this.database.handle.prepare("SELECT task_id, assignment_id, phase, review_deadline, updated_at, record_json FROM assignment_executions ORDER BY updated_at DESC, task_id LIMIT 1").get() as ExecutionRow | undefined;
    return row ? parseExecutionRow(row) : null;
  }

  listExpiredReviewHandoffs(now: string): AssignmentExecution[] {
    const rows = this.database.handle.prepare(`
      SELECT task_id, assignment_id, phase, review_deadline, updated_at, record_json FROM assignment_executions
      WHERE phase = 'ready_review' ORDER BY review_deadline, task_id
    `).all() as unknown as ExecutionRow[];
    return rows.map(parseExecutionRow).filter((execution) => {
      const releaseAt = execution.handoffDeadline ?? execution.reviewDeadline;
      return releaseAt !== undefined && releaseAt <= now;
    });
  }

  addAttempt(value: unknown): ExecutionAttempt {
    const attempt = parseValue(ExecutionAttemptSchema, value, "execution attempt");
    const prior = this.listAttempts(attempt.taskId);
    if (prior.length >= 2) throw new StorageError("record_validation_failed", "An assignment may record at most two recovery attempts", { taskId: attempt.taskId });
    if (prior.some((item) => item.plan.trim().toLowerCase() === attempt.plan.trim().toLowerCase())) {
      throw new StorageError("record_validation_failed", "Recovery plans must be meaningfully different", { taskId: attempt.taskId });
    }
    this.database.handle.prepare(`
      INSERT INTO execution_attempts(task_id, ordinal, recorded_at, record_json) VALUES (?, ?, ?, ?)
    `).run(attempt.taskId, attempt.ordinal, attempt.recordedAt, json(ExecutionAttemptSchema, attempt));
    return attempt;
  }

  listAttempts(taskId: string): ExecutionAttempt[] {
    const rows = this.database.handle.prepare("SELECT task_id, ordinal, recorded_at, record_json FROM execution_attempts WHERE task_id = ? ORDER BY ordinal").all(taskId) as unknown as AttemptRow[];
    return rows.map(parseAttemptRow);
  }

  putNotification(value: unknown): NotificationIntent {
    const intent = parseValue(NotificationIntentSchema, value, "notification intent");
    this.database.handle.prepare(`
      INSERT INTO notification_intents(notification_id, kind, target_type, target_id, created_at, delivered_at, clicked_at, record_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(notification_id) DO UPDATE SET kind=excluded.kind, target_type=excluded.target_type,
        target_id=excluded.target_id, created_at=excluded.created_at, delivered_at=excluded.delivered_at,
        clicked_at=excluded.clicked_at, record_json=excluded.record_json
    `).run(intent.notificationId, intent.kind, intent.target.type, intent.target.id, intent.createdAt, intent.deliveredAt ?? null, intent.clickedAt ?? null, json(NotificationIntentSchema, intent));
    return intent;
  }

  getNotification(notificationId: string): NotificationIntent | null {
    const row = this.database.handle.prepare("SELECT notification_id, kind, target_type, target_id, created_at, delivered_at, clicked_at, record_json FROM notification_intents WHERE notification_id = ?").get(notificationId) as NotificationRow | undefined;
    return row ? parseNotificationRow(row) : null;
  }

  latestNotification(): NotificationIntent | null {
    const row = this.database.handle.prepare("SELECT notification_id, kind, target_type, target_id, created_at, delivered_at, clicked_at, record_json FROM notification_intents ORDER BY created_at DESC, notification_id DESC LIMIT 1").get() as NotificationRow | undefined;
    return row ? parseNotificationRow(row) : null;
  }

  putSubmissionReceipt(value: unknown): SubmissionReceipt {
    const receipt = parseValue(SubmissionReceiptSchema, value, "submission receipt");
    this.database.handle.prepare(`
      INSERT INTO submission_receipts(receipt_id, task_id, submitted_at, record_json) VALUES (?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET receipt_id=excluded.receipt_id, submitted_at=excluded.submitted_at, record_json=excluded.record_json
    `).run(receipt.receiptId, receipt.taskId, receipt.submittedAt, json(SubmissionReceiptSchema, receipt));
    return receipt;
  }

  getSubmissionReceipt(taskId: string): SubmissionReceipt | null {
    const row = this.database.handle.prepare("SELECT receipt_id, task_id, submitted_at, record_json FROM submission_receipts WHERE task_id = ?").get(taskId) as ReceiptRow | undefined;
    return row ? parseReceiptRow(row) : null;
  }
}

export function validateLifecycleRecords(database: StudiSqliteDatabase): void {
  const repository = new LifecycleRepository(database);
  repository.getSchedule();
  repository.getActiveExecution();
  repository.latestExecution();
  repository.latestNotification();
  const tasks = database.handle.prepare("SELECT task_id FROM assignment_executions").all() as unknown as Array<{ task_id: string }>;
  for (const row of tasks) {
    repository.getExecution(row.task_id);
    repository.listAttempts(row.task_id);
    repository.getSubmissionReceipt(row.task_id);
  }
}
