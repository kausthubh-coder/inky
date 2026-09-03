import { z } from "zod";

import {
  AssignmentSchema,
  PermissionRuleSchema,
  RunSchema,
  TASK_TRANSITIONS,
  TaskEventSchema,
  TaskSchema,
  type Assignment,
  type PermissionRule,
  type Run,
  type Task,
  type TaskEvent,
  type TaskState,
} from "../../shared/index.js";
import { StudiSqliteDatabase } from "./database.js";
import { StorageError, errorMessage, isStorageError } from "./errors.js";

type JsonRow = { record_json: string };
type StoredColumn = string | number | null;

function canonicalJson<T>(schema: z.ZodType<T>, value: unknown, recordType: string): string {
  try {
    return JSON.stringify(schema.parse(value));
  } catch (error) {
    throw new StorageError(
      "record_validation_failed",
      `Invalid ${recordType}: ${errorMessage(error)}`,
      { recordType },
      { cause: error },
    );
  }
}

function parseRecord<T>(schema: z.ZodType<T>, value: unknown, recordType: string): T {
  try {
    return schema.parse(value);
  } catch (error) {
    throw new StorageError(
      "record_validation_failed",
      `Invalid ${recordType}: ${errorMessage(error)}`,
      { recordType },
      { cause: error },
    );
  }
}

function parseJson<T>(schema: z.ZodType<T>, raw: string, recordType: string): T {
  try {
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    throw new StorageError(
      "record_validation_failed",
      `Stored ${recordType} failed validation: ${errorMessage(error)}`,
      { recordType },
      { cause: error },
    );
  }
}

function rowsToRecords<T>(
  schema: z.ZodType<T>,
  rows: readonly JsonRow[],
  recordType: string,
): T[] {
  return rows.map((row) => parseJson(schema, row.record_json, recordType));
}

function assertStoredColumns(
  table: string,
  recordId: string,
  actual: Readonly<Record<string, StoredColumn>>,
  expected: Readonly<Record<string, StoredColumn>>,
): void {
  const mismatches = Object.keys(expected).filter((column) => actual[column] !== expected[column]);
  if (mismatches.length > 0) {
    throw new StorageError(
      "record_validation_failed",
      `Stored ${table} columns do not match the validated record JSON`,
      { table, recordId, mismatches },
    );
  }
}

export function validatePersistedRecords(database: StudiSqliteDatabase): void {
  const assignments = database.handle
    .prepare(
      "SELECT assignment_id, course_id, due_at, discovered_at, record_json FROM assignments",
    )
    .all() as unknown as Array<
    JsonRow & {
      assignment_id: string;
      course_id: string;
      due_at: string | null;
      discovered_at: string;
    }
  >;
  for (const row of assignments) {
    const record = parseJson(AssignmentSchema, row.record_json, "assignment");
    assertStoredColumns(
      "assignments",
      record.assignmentId,
      {
        assignment_id: row.assignment_id,
        course_id: row.course_id,
        due_at: row.due_at,
        discovered_at: row.discovered_at,
      },
      {
        assignment_id: record.assignmentId,
        course_id: record.courseId,
        due_at: record.dueAt ?? null,
        discovered_at: record.discoveredAt,
      },
    );
  }

  const permissionRules = database.handle
    .prepare(
      `SELECT rule_id, scope, course_id, assignment_id, pattern_id, updated_at, record_json
       FROM permission_rules`,
    )
    .all() as unknown as Array<
    JsonRow & {
      rule_id: string;
      scope: string;
      course_id: string | null;
      assignment_id: string | null;
      pattern_id: string | null;
      updated_at: string;
    }
  >;
  for (const row of permissionRules) {
    const record = parseJson(PermissionRuleSchema, row.record_json, "permission rule");
    assertStoredColumns(
      "permission_rules",
      record.ruleId,
      {
        rule_id: row.rule_id,
        scope: row.scope,
        course_id: row.course_id,
        assignment_id: row.assignment_id,
        pattern_id: row.pattern_id,
        updated_at: row.updated_at,
      },
      {
        rule_id: record.ruleId,
        scope: record.scope,
        course_id: "courseId" in record ? record.courseId : null,
        assignment_id: "assignmentId" in record ? record.assignmentId : null,
        pattern_id: "patternId" in record ? record.patternId : null,
        updated_at: record.updatedAt,
      },
    );
  }

  const runs = database.handle
    .prepare("SELECT run_id, task_id, state, revision, updated_at, record_json FROM runs")
    .all() as unknown as Array<
    JsonRow & {
      run_id: string;
      task_id: string;
      state: string;
      revision: number;
      updated_at: string;
    }
  >;
  for (const row of runs) {
    const record = parseJson(RunSchema, row.record_json, "run");
    assertStoredColumns(
      "runs",
      record.runId,
      {
        run_id: row.run_id,
        task_id: row.task_id,
        state: row.state,
        revision: row.revision,
        updated_at: row.updated_at,
      },
      {
        run_id: record.runId,
        task_id: record.taskId,
        state: record.state,
        revision: record.revision,
        updated_at: record.updatedAt,
      },
    );
  }

  const taskEvents = database.handle
    .prepare(
      `SELECT event_id, task_id, run_id, sequence, type, occurred_at, record_json
       FROM task_events ORDER BY task_id, sequence`,
    )
    .all() as unknown as Array<
    JsonRow & {
      event_id: string;
      task_id: string;
      run_id: string;
      sequence: number;
      type: string;
      occurred_at: string;
    }
  >;
  const taskEventsById = new Map<string, TaskEvent[]>();
  for (const row of taskEvents) {
    const record = parseJson(TaskEventSchema, row.record_json, "task event");
    assertStoredColumns(
      "task_events",
      record.eventId,
      {
        event_id: row.event_id,
        task_id: row.task_id,
        run_id: row.run_id,
        sequence: row.sequence,
        type: row.type,
        occurred_at: row.occurred_at,
      },
      {
        event_id: record.eventId,
        task_id: record.aggregateId,
        run_id: record.runId,
        sequence: record.sequence,
        type: record.type,
        occurred_at: record.occurredAt,
      },
    );
    if (row.task_id !== record.payload.taskId) {
      throw new StorageError(
        "record_validation_failed",
        "Stored task event task_id does not match its validated payload",
        { table: "task_events", recordId: record.eventId, mismatches: ["task_id"] },
      );
    }
    const stream = taskEventsById.get(record.aggregateId);
    if (stream) {
      stream.push(record);
    } else {
      taskEventsById.set(record.aggregateId, [record]);
    }
  }

  const taskProjections = database.handle
    .prepare("SELECT task_id, state, revision, updated_at, record_json FROM task_projections")
    .all() as unknown as Array<
    JsonRow & {
      task_id: string;
      state: string;
      revision: number;
      updated_at: string;
    }
  >;
  const taskProjectionById = new Map<string, Task>();
  for (const row of taskProjections) {
    const record = parseJson(TaskSchema, row.record_json, "task projection");
    assertStoredColumns(
      "task_projections",
      record.taskId,
      {
        task_id: row.task_id,
        state: row.state,
        revision: row.revision,
        updated_at: row.updated_at,
      },
      {
        task_id: record.taskId,
        state: record.state,
        revision: record.revision,
        updated_at: record.updatedAt,
      },
    );
    taskProjectionById.set(record.taskId, record);
  }

  for (const [taskId, events] of taskEventsById) {
    const replayed = replayTaskEvents(taskId, events);
    const projection = taskProjectionById.get(taskId);
    if (projection && JSON.stringify(projection) !== JSON.stringify(replayed)) {
      throw new StorageError(
        "record_validation_failed",
        "Stored task projection does not match its replayed event stream",
        { table: "task_projections", recordId: taskId },
      );
    }
  }
  for (const taskId of taskProjectionById.keys()) {
    if (!taskEventsById.has(taskId)) {
      throw new StorageError(
        "record_validation_failed",
        "Stored task projection has no event stream to replay",
        { table: "task_projections", recordId: taskId },
      );
    }
  }
}

export class AssignmentRepository {
  constructor(private readonly database: StudiSqliteDatabase) {}

  put(value: unknown): Assignment {
    const record = parseRecord(AssignmentSchema, value, "assignment");
    const recordJson = canonicalJson(AssignmentSchema, record, "assignment");
    this.database.handle
      .prepare(`
        INSERT INTO assignments(assignment_id, course_id, due_at, discovered_at, record_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(assignment_id) DO UPDATE SET
          course_id = excluded.course_id,
          due_at = excluded.due_at,
          discovered_at = excluded.discovered_at,
          record_json = excluded.record_json
      `)
      .run(
        record.assignmentId,
        record.courseId,
        record.dueAt ?? null,
        record.discoveredAt,
        recordJson,
      );
    return record;
  }

  get(assignmentId: string): Assignment | null {
    const row = this.database.handle
      .prepare("SELECT record_json FROM assignments WHERE assignment_id = ?")
      .get(assignmentId) as JsonRow | undefined;
    return row ? parseJson(AssignmentSchema, row.record_json, "assignment") : null;
  }

  listByCourse(courseId: string): Assignment[] {
    const rows = this.database.handle
      .prepare(
        "SELECT record_json FROM assignments WHERE course_id = ? ORDER BY due_at, assignment_id",
      )
      .all(courseId) as unknown as JsonRow[];
    return rowsToRecords(AssignmentSchema, rows, "assignment");
  }

  listDueThrough(dueAt: string): Assignment[] {
    const rows = this.database.handle
      .prepare(
        "SELECT record_json FROM assignments WHERE due_at IS NOT NULL AND due_at <= ? ORDER BY due_at, assignment_id",
      )
      .all(dueAt) as unknown as JsonRow[];
    return rowsToRecords(AssignmentSchema, rows, "assignment");
  }

  listAll(): Assignment[] {
    const rows = this.database.handle
      .prepare("SELECT record_json FROM assignments ORDER BY due_at IS NULL, due_at, assignment_id")
      .all() as unknown as JsonRow[];
    return rowsToRecords(AssignmentSchema, rows, "assignment");
  }
}

export class PermissionRuleRepository {
  constructor(private readonly database: StudiSqliteDatabase) {}

  put(value: unknown): PermissionRule {
    const record = parseRecord(PermissionRuleSchema, value, "permission rule");
    const recordJson = canonicalJson(PermissionRuleSchema, record, "permission rule");
    const courseId = "courseId" in record ? record.courseId : null;
    const assignmentId = "assignmentId" in record ? record.assignmentId : null;
    const patternId = "patternId" in record ? record.patternId : null;
    this.database.handle
      .prepare(`
        INSERT INTO permission_rules(
          rule_id, scope, course_id, assignment_id, pattern_id, updated_at, record_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(rule_id) DO UPDATE SET
          scope = excluded.scope,
          course_id = excluded.course_id,
          assignment_id = excluded.assignment_id,
          pattern_id = excluded.pattern_id,
          updated_at = excluded.updated_at,
          record_json = excluded.record_json
      `)
      .run(
        record.ruleId,
        record.scope,
        courseId,
        assignmentId,
        patternId,
        record.updatedAt,
        recordJson,
      );
    return record;
  }

  get(ruleId: string): PermissionRule | null {
    const row = this.database.handle
      .prepare("SELECT record_json FROM permission_rules WHERE rule_id = ?")
      .get(ruleId) as JsonRow | undefined;
    return row ? parseJson(PermissionRuleSchema, row.record_json, "permission rule") : null;
  }

  listByScope(scope: PermissionRule["scope"]): PermissionRule[] {
    const rows = this.database.handle
      .prepare(
        "SELECT record_json FROM permission_rules WHERE scope = ? ORDER BY updated_at DESC, rule_id",
      )
      .all(scope) as unknown as JsonRow[];
    return rowsToRecords(PermissionRuleSchema, rows, "permission rule");
  }

  listAll(): PermissionRule[] {
    const rows = this.database.handle
      .prepare("SELECT record_json FROM permission_rules ORDER BY updated_at DESC, rule_id")
      .all() as unknown as JsonRow[];
    return rowsToRecords(PermissionRuleSchema, rows, "permission rule");
  }

  delete(ruleId: string): boolean {
    const result = this.database.handle.prepare("DELETE FROM permission_rules WHERE rule_id = ?").run(ruleId);
    return Number(result.changes) === 1;
  }
}

export class RunRepository {
  constructor(private readonly database: StudiSqliteDatabase) {}

  put(value: unknown): Run {
    const record = parseRecord(RunSchema, value, "run");
    const recordJson = canonicalJson(RunSchema, record, "run");
    this.database.handle
      .prepare(`
        INSERT INTO runs(run_id, task_id, state, revision, updated_at, record_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
          task_id = excluded.task_id,
          state = excluded.state,
          revision = excluded.revision,
          updated_at = excluded.updated_at,
          record_json = excluded.record_json
      `)
      .run(
        record.runId,
        record.taskId,
        record.state,
        record.revision,
        record.updatedAt,
        recordJson,
      );
    return record;
  }

  get(runId: string): Run | null {
    const row = this.database.handle
      .prepare("SELECT record_json FROM runs WHERE run_id = ?")
      .get(runId) as JsonRow | undefined;
    return row ? parseJson(RunSchema, row.record_json, "run") : null;
  }

  listByTask(taskId: string): Run[] {
    const rows = this.database.handle
      .prepare("SELECT record_json FROM runs WHERE task_id = ? ORDER BY updated_at, run_id")
      .all(taskId) as unknown as JsonRow[];
    return rowsToRecords(RunSchema, rows, "run");
  }

  listByState(state: Run["state"]): Run[] {
    const rows = this.database.handle
      .prepare("SELECT record_json FROM runs WHERE state = ? ORDER BY updated_at, run_id")
      .all(state) as unknown as JsonRow[];
    return rowsToRecords(RunSchema, rows, "run");
  }
}

export interface AppendTaskEventInput {
  readonly event: unknown;
  readonly projection: unknown;
  readonly expectedRevision: number | null;
}

export class TaskRepository {
  constructor(private readonly database: StudiSqliteDatabase) {}

  get(taskId: string): Task | null {
    const row = this.database.handle
      .prepare("SELECT record_json FROM task_projections WHERE task_id = ?")
      .get(taskId) as JsonRow | undefined;
    return row ? parseJson(TaskSchema, row.record_json, "task projection") : null;
  }

  listByState(state: TaskState): Task[] {
    const rows = this.database.handle
      .prepare(
        "SELECT record_json FROM task_projections WHERE state = ? ORDER BY updated_at, task_id",
      )
      .all(state) as unknown as JsonRow[];
    return rowsToRecords(TaskSchema, rows, "task projection");
  }

  listAll(): Task[] {
    const rows = this.database.handle
      .prepare("SELECT record_json FROM task_projections ORDER BY updated_at DESC, task_id")
      .all() as unknown as JsonRow[];
    return rowsToRecords(TaskSchema, rows, "task projection");
  }

  listEvents(taskId: string): TaskEvent[] {
    return this.readEvents(taskId);
  }

  append(input: AppendTaskEventInput): Task {
    const event = this.parseTaskEvent(input.event);
    const projection = parseRecord(TaskSchema, input.projection, "task projection");
    this.assertAppendMatches(event, projection, input.expectedRevision);
    const eventJson = canonicalJson(TaskEventSchema, event, "task event");
    const projectionJson = canonicalJson(TaskSchema, projection, "task projection");

    try {
      return this.database.transaction(() => {
        const current = this.get(projection.taskId);
        const lastSequence = this.lastSequence(projection.taskId);
        this.assertCurrentState(event, projection, input.expectedRevision, current, lastSequence);

        this.database.handle
          .prepare(`
            INSERT INTO task_events(event_id, task_id, run_id, sequence, type, occurred_at, record_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            event.eventId,
            projection.taskId,
            event.runId,
            event.sequence,
            event.type,
            event.occurredAt,
            eventJson,
          );

        this.database.injectFailure("task_before_projection");

        if (input.expectedRevision === null) {
          this.database.handle
            .prepare(`
              INSERT INTO task_projections(task_id, state, revision, updated_at, record_json)
              VALUES (?, ?, ?, ?, ?)
            `)
            .run(
              projection.taskId,
              projection.state,
              projection.revision,
              projection.updatedAt,
              projectionJson,
            );
        } else {
          const result = this.database.handle
            .prepare(`
              UPDATE task_projections
              SET state = ?, revision = ?, updated_at = ?, record_json = ?
              WHERE task_id = ? AND revision = ?
            `)
            .run(
              projection.state,
              projection.revision,
              projection.updatedAt,
              projectionJson,
              projection.taskId,
              input.expectedRevision,
            );
          if (Number(result.changes) !== 1) {
            throw new StorageError(
              "optimistic_revision_conflict",
              `Task ${projection.taskId} changed before its event could commit`,
              { taskId: projection.taskId, expectedRevision: input.expectedRevision },
            );
          }
        }
        return projection;
      });
    } catch (error) {
      if (isStorageError(error)) {
        throw error;
      }
      throw new StorageError(
        "invalid_event_stream",
        `Task event and projection transaction rolled back: ${errorMessage(error)}`,
        { taskId: projection.taskId, eventId: event.eventId },
        { cause: error },
      );
    }
  }

  deleteProjection(taskId: string): void {
    this.database.handle.prepare("DELETE FROM task_projections WHERE task_id = ?").run(taskId);
  }

  replay(taskId: string): Task {
    return replayTaskEvents(taskId, this.readEvents(taskId));
  }

  rebuildProjection(taskId: string): Task {
    return this.database.transaction(() => {
      const task = replayTaskEvents(taskId, this.readEvents(taskId));
      const recordJson = canonicalJson(TaskSchema, task, "task projection");
      this.database.handle.prepare("DELETE FROM task_projections WHERE task_id = ?").run(taskId);
      this.database.handle
        .prepare(`
          INSERT INTO task_projections(task_id, state, revision, updated_at, record_json)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(task.taskId, task.state, task.revision, task.updatedAt, recordJson);
      return task;
    });
  }

  private parseTaskEvent(value: unknown): TaskEvent {
    try {
      return TaskEventSchema.parse(value);
    } catch (error) {
      throw new StorageError(
        "record_validation_failed",
        `Invalid task event: ${errorMessage(error)}`,
        { recordType: "task event" },
        { cause: error },
      );
    }
  }

  private readEvents(taskId: string): TaskEvent[] {
    const rows = this.database.handle
      .prepare("SELECT record_json FROM task_events WHERE task_id = ? ORDER BY sequence")
      .all(taskId) as unknown as JsonRow[];
    return rowsToRecords(TaskEventSchema, rows, "task event");
  }

  private lastSequence(taskId: string): number | null {
    const row = this.database.handle
      .prepare("SELECT MAX(sequence) AS sequence FROM task_events WHERE task_id = ?")
      .get(taskId) as { sequence: number | null };
    return row.sequence;
  }

  private assertAppendMatches(
    event: TaskEvent,
    projection: Task,
    expectedRevision: number | null,
  ): void {
    if (event.aggregateId !== projection.taskId || event.payload.taskId !== projection.taskId) {
      throw new StorageError("invalid_event_stream", "Task event identity does not match projection", {
        eventTaskId: event.aggregateId,
        projectionTaskId: projection.taskId,
      });
    }
    if (event.payload.assignmentId !== projection.assignmentId) {
      throw new StorageError(
        "invalid_event_stream",
        "Task event assignment does not match projection",
        { taskId: projection.taskId },
      );
    }
    if (event.type === "task_created") {
      const expected: Task = {
        schemaVersion: event.schemaVersion,
        taskId: event.payload.taskId,
        assignmentId: event.payload.assignmentId,
        state: event.payload.state,
        revision: event.payload.revision,
        createdAt: event.payload.createdAt,
        updatedAt: event.payload.updatedAt,
      };
      if (
        expectedRevision !== null ||
        event.occurredAt !== event.payload.createdAt ||
        event.payload.createdAt !== event.payload.updatedAt ||
        JSON.stringify(expected) !== JSON.stringify(projection)
      ) {
        throw new StorageError("invalid_event_stream", "Task origin event does not match projection", {
          taskId: projection.taskId,
        });
      }
      return;
    }
    if (
      expectedRevision === null ||
      projection.state !== event.payload.to ||
      projection.revision !== event.payload.revision ||
      projection.updatedAt !== event.occurredAt
    ) {
      throw new StorageError("invalid_event_stream", "Task transition event does not match projection", {
        taskId: projection.taskId,
      });
    }
  }

  private assertCurrentState(
    event: TaskEvent,
    projection: Task,
    expectedRevision: number | null,
    current: Task | null,
    lastSequence: number | null,
  ): void {
    const expectedSequence = lastSequence === null ? 0 : lastSequence + 1;
    if (event.sequence !== expectedSequence) {
      throw new StorageError(
        "event_sequence_invalid",
        `Task ${projection.taskId} expected event sequence ${expectedSequence}, received ${event.sequence}`,
        { taskId: projection.taskId, expectedSequence, receivedSequence: event.sequence },
      );
    }
    if (event.type === "task_created") {
      if (current || lastSequence !== null) {
        throw new StorageError("invalid_event_stream", "Task origin must be the first stored event", {
          taskId: projection.taskId,
        });
      }
      return;
    }
    if (!current || expectedRevision === null || current.revision !== expectedRevision) {
      throw new StorageError(
        "optimistic_revision_conflict",
        `Task ${projection.taskId} is not at expected revision ${String(expectedRevision)}`,
        {
          taskId: projection.taskId,
          expectedRevision,
          actualRevision: current?.revision ?? null,
        },
      );
    }
    const allowed = TASK_TRANSITIONS[current.state] as readonly TaskState[];
    if (
      event.payload.from !== current.state ||
      !allowed.includes(event.payload.to) ||
      event.payload.revision !== current.revision + 1 ||
      projection.assignmentId !== current.assignmentId ||
      projection.createdAt !== current.createdAt
    ) {
      throw new StorageError("invalid_event_stream", "Task transition does not advance current state", {
        taskId: projection.taskId,
        currentState: current.state,
        currentRevision: current.revision,
      });
    }
  }
}

export function replayTaskEvents(taskId: string, events: readonly TaskEvent[]): Task {
  if (events.length === 0) {
    throw new StorageError("record_not_found", `No events exist for task ${taskId}`, { taskId });
  }

  let task: Task | null = null;
  let expectedSequence = 0;
  for (const event of events) {
    if (
      event.aggregateType !== "task" ||
      event.aggregateId !== taskId ||
      event.payload.taskId !== taskId ||
      event.sequence !== expectedSequence
    ) {
      throw new StorageError("invalid_event_stream", "Task event stream has invalid identity or order", {
        taskId,
        eventId: event.eventId,
        expectedSequence,
        receivedSequence: event.sequence,
      });
    }
    if (event.type === "task_created") {
      if (task || expectedSequence !== 0) {
        throw new StorageError("invalid_event_stream", "Task stream contains a misplaced origin event", {
          taskId,
          eventId: event.eventId,
        });
      }
      task = TaskSchema.parse({
        schemaVersion: event.schemaVersion,
        taskId: event.payload.taskId,
        assignmentId: event.payload.assignmentId,
        state: event.payload.state,
        revision: event.payload.revision,
        createdAt: event.payload.createdAt,
        updatedAt: event.payload.updatedAt,
      });
    } else {
      if (!task) {
        throw new StorageError("invalid_event_stream", "Task stream starts without an origin event", {
          taskId,
          eventId: event.eventId,
        });
      }
      const allowed = TASK_TRANSITIONS[task.state] as readonly TaskState[];
      if (
        event.payload.assignmentId !== task.assignmentId ||
        event.payload.from !== task.state ||
        !allowed.includes(event.payload.to) ||
        event.payload.revision !== task.revision + 1
      ) {
        throw new StorageError("invalid_event_stream", "Task transition cannot replay from current state", {
          taskId,
          eventId: event.eventId,
          state: task.state,
          revision: task.revision,
        });
      }
      task = TaskSchema.parse({
        ...task,
        state: event.payload.to,
        revision: event.payload.revision,
        updatedAt: event.occurredAt,
      });
    }
    expectedSequence += 1;
  }
  if (!task) {
    throw new StorageError("invalid_event_stream", "Task stream did not produce a task", { taskId });
  }
  return task;
}
