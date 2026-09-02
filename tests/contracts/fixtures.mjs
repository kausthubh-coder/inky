export const timestamp = "2026-08-30T12:34:56.000Z";

export const evidence = {
  schemaVersion: 1,
  evidenceId: "evidence-1",
  reference: "evidence-ref-1",
  kind: "screenshot",
  sourceTarget: "https://school.example.edu/courses/biology/assignments/1",
  capturedAt: timestamp,
  digest: `sha256:${"a".repeat(64)}`,
  summary: "Assignment title and due date were visible.",
};

export const assignment = {
  schemaVersion: 1,
  assignmentId: "assignment-1",
  courseId: "course-biology",
  title: "Cell structure worksheet",
  sourceTarget: "https://school.example.edu/courses/biology/assignments/1",
  dueAt: "2026-09-01T16:00:00.000Z",
  discoveredAt: timestamp,
  evidence: [evidence],
};

export const task = {
  schemaVersion: 1,
  taskId: "task-1",
  assignmentId: assignment.assignmentId,
  state: "discovered",
  revision: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
};

export const taskTransitionCommand = {
  type: "transition",
  to: "queued",
  eventId: "event-transition-1",
  runId: "run-transition-1",
  sequence: 1,
  occurredAt: timestamp,
};

export const taskCreatedEvent = {
  schemaVersion: 1,
  eventId: "event-created-1",
  aggregateType: "task",
  aggregateId: task.taskId,
  runId: "run-created-1",
  sequence: 0,
  occurredAt: timestamp,
  type: "task_created",
  payload: {
    taskId: task.taskId,
    assignmentId: task.assignmentId,
    state: "discovered",
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
};

export const run = {
  schemaVersion: 1,
  runId: "run-1",
  taskId: task.taskId,
  state: "queued",
  revision: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
};

export const event = {
  schemaVersion: 1,
  eventId: "event-1",
  aggregateType: "task",
  aggregateId: task.taskId,
  runId: run.runId,
  sequence: 0,
  occurredAt: timestamp,
  type: "task_discovered",
  payload: { assignmentId: assignment.assignmentId },
};

export const toolMutation = {
  schemaVersion: 1,
  toolCallId: "tool-call-1",
  taskId: task.taskId,
  runId: run.runId,
  tabId: "tab-1",
  idempotencyKey: "idempotency-1",
  expectedPageRevision: 0,
};

export const toolResult = {
  schemaVersion: 1,
  toolCallId: "tool-call-1",
  taskId: task.taskId,
  runId: run.runId,
  tabId: "tab-1",
  idempotencyKey: "idempotency-1",
  pageRevision: 1,
  outcome: "succeeded",
  evidence: [evidence],
};
