import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AssignmentExecutionCoordinator } from "../../dist/electron/assignment/coordinator.js";
import { startSelectedAssignment } from "../../dist/electron/assignment/start-selected.js";
import { VisibleBrowserWork } from "../../dist/electron/browser/work-ownership.js";
import { initializeHomeworkWorkspace } from "../../dist/electron/files/workspace.js";
import { ManagerCoordinator } from "../../dist/electron/manager/coordinator.js";
import { openLocalStore } from "../../dist/electron/storage/index.js";

const icon = { isEmpty: () => false, resize() { return this; } };
// Electron supplies this in production; this suite runs under plain Node.
process.resourcesPath ??= process.cwd();
globalThis.studiKernelTestElectron = {
  app: new EventEmitter(), powerMonitor: new EventEmitter(),
  Tray: class extends EventEmitter { setToolTip() {} setContextMenu() {} destroy() {} },
  Menu: { buildFromTemplate: items => items },
  nativeImage: { createFromPath: () => icon, createFromDataURL: () => icon },
  Notification: class { static isSupported() { return false; } },
};
const hooks = registerHooks({ resolve(specifier, context, next) {
  return specifier === "electron"
    ? { url: "data:text/javascript,export const {app,powerMonitor,Tray,Menu,nativeImage,Notification}=globalThis.studiKernelTestElectron", shortCircuit: true }
    : next(specifier, context);
} });
const { AppKernel } = await import("../../dist/electron/lifecycle/kernel.js");
hooks.deregister();
delete globalThis.studiKernelTestElectron;

function fixture(options = {}) {
  let clock = "2026-09-01T12:00:00.000Z";
  let entries = options.entries ?? [];
  let schedule = options.schedule ?? null;
  const notices = [];
  const window = Object.assign(new EventEmitter(), { isVisible: () => true, isDestroyed: () => false });
  let reconciliations = 0;
  const manager = {
    allowsAutomaticWork: options.automatic ?? true, isWorkerRunning: false,
    setSchedulingEnabled() {}, reconcileQueue() { reconciliations++; },
    state: () => ({ entries, lease: null }),
  };
  const store = {
    assignments: { get: () => ({ title: "Limits practice" }) },
    productPreferences: { get: async () => ({}) },
    lifecycle: { getSchedule: () => schedule, getActiveExecution: () => null, onExecutionChange: () => () => {},
      putNotification: notification => (notices.push(notification), notification) },
  };
  const kernel = new AppKernel(store, manager, { reconcileDeadlines: options.reconcileDeadlines ?? (async () => {}) },
    { isScanStartBlocked: options.browserBusy ?? (() => false) }, window, {
      focusBrowser() {}, now: () => clock,
      runScheduledScan: options.runScheduledScan ?? (async () => null),
      runScheduledAssignment: options.runScheduledAssignment ?? (async () => {}),
    });
  return { kernel, notices, get count() { return reconciliations; }, setClock(value) { clock = value; }, setEntries(value) { entries = value; }, setSchedule(value) { schedule = value; } };
}
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

test("startup returns during a long scan and reconciliation requests coalesce without overlap", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let finishScan;
  const pending = new Promise(resolve => { finishScan = resolve; });
  let scanCalls = 0;
  const f = fixture({ schedule: { schemaVersion: 1, scheduleId: "school-scan", cadence: "daily", state: "enabled", timezone: "UTC", localTime: "08:00", nextRunAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-01T08:00:00.000Z" },
    runScheduledScan: async () => { scanCalls++; await pending; f.setSchedule(null); return null; } });
  try {
    await f.kernel.start();
    assert.equal(scanCalls, 0, "start does not await scheduled work");
    t.mock.timers.tick(0); await settle();
    assert.equal(scanCalls, 1);
    for (let i = 0; i < 30; i++) f.kernel.requestReconcile();
    t.mock.timers.tick(0); await settle();
    assert.equal(scanCalls, 1, "the running scan is not duplicated");
    finishScan(); await settle();
    const before = f.count;
    t.mock.timers.tick(0); await settle();
    assert.ok(f.count > before, "one follow-up sees changes received during the run");
    const settledCount = f.count;
    t.mock.timers.tick(10 * 60_000); await settle();
    assert.equal(f.count, settledCount, "no eligible work leaves no polling loop");
  } finally { finishScan(); f.kernel.dispose(); }
});

test("scheduled work records its pre-start notification first and overdue entries do not spin", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let starts = 0;
  const f = fixture({ entries: [{ taskId: "task-a", assignmentId: "assignment-a", scheduledStartAt: "2026-09-01T11:00:00.000Z" }],
    runScheduledAssignment: async () => { starts++; assert.equal(f.notices.at(-1).kind, "work_start"); } });
  try {
    await f.kernel.reconcile();
    assert.equal(starts, 1);
    t.mock.timers.tick(0); await settle();
    assert.equal(starts, 1);
    t.mock.timers.tick(29_999); await settle();
    assert.equal(starts, 1, "an unchanged overdue entry has a bounded retry delay");
  } finally { f.kernel.dispose(); }
});

test("requested reconciliation captures errors durably and retries with backoff", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let attempts = 0;
  const f = fixture({ reconcileDeadlines: async () => { attempts++; throw new Error("Saved automation state is temporarily unavailable"); } });
  try {
    f.kernel.requestReconcile(); t.mock.timers.tick(0); await settle();
    assert.equal(attempts, 1);
    assert.equal(f.notices.at(-1).kind, "failure");
    assert.match(f.notices.at(-1).body, /temporarily unavailable/);
    f.kernel.requestReconcile(); t.mock.timers.tick(59_999); await settle();
    assert.equal(attempts, 1);
    f.setClock("2026-09-01T12:01:00.000Z");
    t.mock.timers.tick(1); await settle();
    assert.equal(attempts, 2);
  } finally { f.kernel.dispose(); }
});

test("explicit do-next waits for the browser and runs in manual mode without starting other homework", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const starts = [];
  let browserBusy = true;
  const automatic = { taskId: "task-auto", assignmentId: "assignment-auto", requestOrigin: "automatic", scheduledStartAt: "2026-09-01T11:00:00.000Z" };
  const requested = { taskId: "task-next", assignmentId: "assignment-next", requestOrigin: "student", startRequestedAt: "2026-09-01T11:00:00.000Z" };
  const f = fixture({ automatic: false, browserBusy: () => browserBusy, entries: [requested, automatic],
    runScheduledAssignment: async id => { starts.push(id); f.setEntries([automatic]); } });
  try {
    await f.kernel.reconcile();
    assert.deepEqual(starts, []);
    browserBusy = false;
    await f.kernel.reconcile();
    assert.deepEqual(starts, ["task-next"]);
    await f.kernel.reconcile();
    assert.deepEqual(starts, ["task-next"], "manual mode still excludes automatic homework");
  } finally { f.kernel.dispose(); }
});

test("the queue moves on by itself: when a run lets go of the page the next one starts, and saved work can go again", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-kernel-queue-"));
  let now = "2026-09-01T12:00:00.000Z";
  const store = await openLocalStore(root);
  const homeworkRoot = join(root, "homework");
  await mkdir(homeworkRoot, { recursive: true });
  await initializeHomeworkWorkspace(homeworkRoot);
  await store.productPreferences.put({ ...await store.productPreferences.get(), homeworkRoot, updatedAt: now });
  for (const id of ["a", "b", "c"]) seedHomework(store, id, now);
  store.permissionRules.put({ schemaVersion: 1, ruleId: "attempt", scope: "global", mode: "attempt", updatedAt: now });
  const runtime = {
    createWorkerSession: async () => runtime.session([]),
    createAssignmentSession: async tools => runtime.session(tools),
    session: tools => {
      const listeners = new Set();
      return {
        sessionId: `session-${Math.random()}`, sessionPath: `session-${Math.random()}.jsonl`, toolNames: tools.map(tool => tool.name),
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        prompt: async () => {
          await tools.find(tool => tool.name === "assignment_start_review")?.execute("review", { answers: "x = 4", completedRequirements: [{ requirement: "Solve", evidence: "The answer is filled in" }], summary: "Ready" }, undefined, undefined, {});
          for (const listener of listeners) listener({ schemaVersion: 1, type: "terminal", outcome: "completed" });
        },
        abort: async () => {}, compact: async () => {}, replace: async () => {}, dispose() {},
      };
    },
  };
  const browser = { snapshot: async () => ({ revision: 1, url: "https://school.example.edu/a", title: "Assignment", text: "", elements: [], truncated: false }) };
  const manager = await ManagerCoordinator.create(store, runtime, { now: () => now });
  const browserWork = new VisibleBrowserWork(store);
  const execution = await AssignmentExecutionCoordinator.create(store, manager, browser, { now: () => now, browserWork, reviewWindowMs: 60_000, handoffWindowMs: 120_000 });
  const window = Object.assign(new EventEmitter(), { isVisible: () => true, isDestroyed: () => false });
  const kernel = new AppKernel(store, manager, execution, browserWork, window, {
    focusBrowser() {}, now: () => now, runScheduledScan: async () => null,
    runScheduledAssignment: taskId => startSelectedAssignment(store, manager, execution, taskId),
  });
  const phase = id => store.lifecycle.getExecution(`task-${id}`)?.phase;
  const until = async (condition, message) => {
    for (let i = 0; i < 400 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(condition(), message);
  };
  try {
    assert.equal((await execution.start("task-a")).phase, "ready_review");
    manager.queueNext("task-b");
    await kernel.start();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(store.tasks.get("task-b").state, "queued", "B waits while A's finished work holds the page for review");
    now = "2026-09-01T12:03:00.000Z";
    kernel.requestReconcile();
    await until(() => phase("b") === "ready_review", "when A's review window ends, B starts by itself");
    assert.equal(phase("a"), "preserved");
    manager.queueNext("task-c");
    manager.queueNext("task-a");
    execution.cancel("task-b");
    await until(() => phase("a") === "ready_review", "stopping B starts the next one straight away, and saved work carries on");
    assert.equal(store.tasks.get("task-b").state, "cancelled");
    execution.cancel("task-a");
    await until(() => phase("c") === "ready_review", "the queue keeps going");
    assert.equal(manager.state().lease.taskId, "task-c");
    assert.deepEqual(manager.state().entries.map(entry => entry.taskId), ["task-c"]);
  } finally {
    kernel.dispose(); execution.dispose(); manager.dispose(); store.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

function seedHomework(store, suffix, at) {
  const assignmentId = `assignment-${suffix}`;
  const taskId = `task-${suffix}`;
  store.assignments.put({ schemaVersion: 1, assignmentId, courseId: `course-${suffix}`, title: `Assignment ${suffix}`,
    sourceTarget: `https://school.example.edu/assignments/${suffix}`, dueAt: "2026-09-03T12:00:00.000Z", discoveredAt: at, evidence: [] });
  const task = { schemaVersion: 1, taskId, assignmentId, state: "discovered", revision: 0, createdAt: at, updatedAt: at };
  store.tasks.append({ expectedRevision: null, projection: task, event: {
    schemaVersion: 1, eventId: `event-${suffix}`, aggregateType: "task", aggregateId: taskId, runId: `run-${suffix}`, sequence: 0,
    occurredAt: at, type: "task_created", payload: { taskId, assignmentId, state: "discovered", revision: 0, createdAt: at, updatedAt: at },
  } });
}
