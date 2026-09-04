import { z } from "zod";

import {
  AgentJobSchema,
  AgentMessageSchema,
  AgentTargetSchema,
  type AgentJob,
  type AgentMessage,
  type AgentTarget,
} from "../../shared/index.js";
import type { StudiSqliteDatabase } from "./database.js";
import { StorageError, errorMessage } from "./errors.js";

const StoredAgentJobSchema = AgentJobSchema.omit({ messages: true }).extend({
  sessionPath: z.string().min(1).nullable(),
});

type StoredAgentJob = z.infer<typeof StoredAgentJobSchema>;

type JobRow = {
  job_id: string;
  target_key: string;
  target_kind: string;
  subject_id: string | null;
  phase: string;
  turn_index: number;
  run_id: string;
  session_id: string | null;
  session_path: string | null;
  created_at: string;
  updated_at: string;
  record_json: string;
};

type MessageRow = {
  message_id: string;
  job_id: string;
  turn_index: number;
  role: string;
  created_at: string;
  record_json: string;
};

export interface PersistedAgentJob {
  readonly job: AgentJob;
  readonly sessionPath: string | null;
}

export function agentTargetKey(target: AgentTarget): string {
  if (target.kind === "assignment") return `assignment:${target.assignmentId}`;
  if (target.kind === "scan") return `scan:${target.scanId}`;
  return target.kind;
}

function subjectId(target: AgentTarget): string | null {
  if (target.kind === "assignment") return target.assignmentId;
  if (target.kind === "scan") return target.scanId;
  return null;
}

function parseJson<T>(schema: z.ZodType<T>, json: string, label: string): T {
  try {
    return schema.parse(JSON.parse(json));
  } catch (error) {
    throw new StorageError(
      "record_validation_failed",
      `Stored ${label} failed validation: ${errorMessage(error)}`,
      { recordType: label },
      { cause: error },
    );
  }
}

function assertEqual(label: string, id: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new StorageError(
      "record_validation_failed",
      `Stored ${label} columns do not match the validated record JSON`,
      { recordId: id },
    );
  }
}

export class AgentJobRepository {
  constructor(private readonly database: StudiSqliteDatabase) {}

  put(value: unknown, sessionPath: string | null = null): PersistedAgentJob {
    const job = AgentJobSchema.parse(value);
    const { messages, ...jobWithoutMessages } = job;
    const stored = StoredAgentJobSchema.parse({ ...jobWithoutMessages, sessionPath });
    const target = AgentTargetSchema.parse(job.target);
    this.database.transaction(() => {
      this.database.handle.prepare(`
        INSERT INTO agent_jobs(
          job_id, target_key, target_kind, subject_id, phase, turn_index, run_id,
          session_id, session_path, created_at, updated_at, record_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id) DO UPDATE SET
          target_key = excluded.target_key,
          target_kind = excluded.target_kind,
          subject_id = excluded.subject_id,
          phase = excluded.phase,
          turn_index = excluded.turn_index,
          run_id = excluded.run_id,
          session_id = excluded.session_id,
          session_path = excluded.session_path,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          record_json = excluded.record_json
      `).run(
        job.jobId,
        agentTargetKey(target),
        target.kind,
        subjectId(target),
        job.phase,
        job.turnIndex,
        job.runId,
        job.sessionId,
        sessionPath,
        job.createdAt,
        job.updatedAt,
        JSON.stringify(stored),
      );
      for (const message of messages) this.#appendMessage(job.jobId, message);
    });
    return { job, sessionPath };
  }

  appendMessage(jobId: string, value: unknown): AgentMessage {
    const message = AgentMessageSchema.parse(value);
    return this.database.transaction(() => this.#appendMessage(jobId, message));
  }

  get(jobId: string): PersistedAgentJob | null {
    const row = this.database.handle.prepare(`
      SELECT job_id, target_key, target_kind, subject_id, phase, turn_index, run_id,
             session_id, session_path, created_at, updated_at, record_json
      FROM agent_jobs WHERE job_id = ?
    `).get(jobId) as JobRow | undefined;
    return row ? this.#parseJob(row) : null;
  }

  getByTarget(target: AgentTarget): PersistedAgentJob | null {
    const row = this.database.handle.prepare(`
      SELECT job_id, target_key, target_kind, subject_id, phase, turn_index, run_id,
             session_id, session_path, created_at, updated_at, record_json
      FROM agent_jobs WHERE target_key = ?
    `).get(agentTargetKey(AgentTargetSchema.parse(target))) as JobRow | undefined;
    return row ? this.#parseJob(row) : null;
  }

  list(): PersistedAgentJob[] {
    const rows = this.database.handle.prepare(`
      SELECT job_id, target_key, target_kind, subject_id, phase, turn_index, run_id,
             session_id, session_path, created_at, updated_at, record_json
      FROM agent_jobs ORDER BY created_at, job_id
    `).all() as unknown as JobRow[];
    return rows.map((row) => this.#parseJob(row));
  }

  #appendMessage(jobId: string, message: AgentMessage): AgentMessage {
    const existing = this.database.handle.prepare(
      "SELECT record_json FROM agent_messages WHERE message_id = ?",
    ).get(message.messageId) as { record_json: string } | undefined;
    const json = JSON.stringify(message);
    if (existing) {
      if (existing.record_json !== json) {
        throw new StorageError(
          "record_validation_failed",
          "Agent messages are immutable",
          { recordId: message.messageId },
        );
      }
      return message;
    }
    const parent = this.database.handle.prepare("SELECT 1 AS found FROM agent_jobs WHERE job_id = ?").get(jobId);
    if (!parent) throw new Error(`Agent job ${jobId} does not exist`);
    this.database.handle.prepare(`
      INSERT INTO agent_messages(message_id, job_id, turn_index, role, created_at, record_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(message.messageId, jobId, message.turnIndex, message.role, message.createdAt, json);
    return message;
  }

  #messages(jobId: string): AgentMessage[] {
    const rows = this.database.handle.prepare(`
      SELECT message_id, job_id, turn_index, role, created_at, record_json
      FROM agent_messages
      WHERE job_id = ?
      ORDER BY turn_index, created_at, message_id
    `).all(jobId) as unknown as MessageRow[];
    return rows.map((row) => {
      const message = parseJson(AgentMessageSchema, row.record_json, "agent message");
      assertEqual("agent message", message.messageId, row.message_id, message.messageId);
      assertEqual("agent message", message.messageId, row.turn_index, message.turnIndex);
      assertEqual("agent message", message.messageId, row.role, message.role);
      assertEqual("agent message", message.messageId, row.created_at, message.createdAt);
      return message;
    });
  }

  #parseJob(row: JobRow): PersistedAgentJob {
    const stored = parseJson(StoredAgentJobSchema, row.record_json, "agent job");
    assertEqual("agent job", stored.jobId, row.job_id, stored.jobId);
    assertEqual("agent job", stored.jobId, row.target_key, agentTargetKey(stored.target));
    assertEqual("agent job", stored.jobId, row.target_kind, stored.target.kind);
    assertEqual("agent job", stored.jobId, row.subject_id, subjectId(stored.target));
    assertEqual("agent job", stored.jobId, row.phase, stored.phase);
    assertEqual("agent job", stored.jobId, row.turn_index, stored.turnIndex);
    assertEqual("agent job", stored.jobId, row.run_id, stored.runId);
    assertEqual("agent job", stored.jobId, row.session_id, stored.sessionId);
    assertEqual("agent job", stored.jobId, row.session_path, stored.sessionPath);
    assertEqual("agent job", stored.jobId, row.created_at, stored.createdAt);
    assertEqual("agent job", stored.jobId, row.updated_at, stored.updatedAt);
    const { sessionPath, ...jobWithoutMessages } = stored;
    return {
      job: AgentJobSchema.parse({ ...jobWithoutMessages, messages: this.#messages(stored.jobId) }),
      sessionPath,
    };
  }
}
