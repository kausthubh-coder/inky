import { randomUUID } from "node:crypto";

import { z } from "zod";

export const AgentTraceEventTypeSchema = z.enum([
  "job_created",
  "message_received",
  "turn_built",
  "model_started",
  "model_finished",
  "tool_started",
  "tool_finished",
  "phase_changed",
  "claim_changed",
  "reply_recorded",
  "restart",
  "aborted",
  "error",
]);

export const AgentTraceEventSchema = z.strictObject({
  schemaVersion: z.literal(1),
  eventId: z.string().uuid(),
  traceId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  capturedAt: z.string().datetime(),
  jobId: z.string().min(1).max(256),
  runId: z.string().min(1).max(256),
  turnIndex: z.number().int().nonnegative(),
  type: AgentTraceEventTypeSchema,
  payload: z.record(z.string().min(1).max(128), z.unknown()),
});

export type AgentTraceEvent = z.infer<typeof AgentTraceEventSchema>;
export type AgentTraceEventType = z.infer<typeof AgentTraceEventTypeSchema>;
export type AgentTraceListener = (event: AgentTraceEvent) => void | Promise<void>;

export class AgentTrace {
  readonly traceId: string;
  readonly #now: () => string;
  readonly #listeners = new Set<AgentTraceListener>();
  readonly #events: AgentTraceEvent[] = [];

  constructor(options: { readonly traceId?: string; readonly now?: () => string } = {}) {
    this.traceId = options.traceId ?? randomUUID();
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  subscribe(listener: AgentTraceListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  events(): readonly AgentTraceEvent[] {
    return Object.freeze([...this.#events]);
  }

  async emit(input: {
    readonly jobId: string;
    readonly runId: string;
    readonly turnIndex: number;
    readonly type: AgentTraceEventType;
    readonly payload?: Readonly<Record<string, unknown>>;
  }): Promise<AgentTraceEvent> {
    const event = AgentTraceEventSchema.parse({
      schemaVersion: 1,
      eventId: randomUUID(),
      traceId: this.traceId,
      sequence: this.#events.length,
      capturedAt: this.#now(),
      jobId: input.jobId,
      runId: input.runId,
      turnIndex: input.turnIndex,
      type: input.type,
      payload: input.payload ?? {},
    });
    this.#events.push(event);
    await Promise.all([...this.#listeners].map((listener) => listener(event)));
    return event;
  }
}

