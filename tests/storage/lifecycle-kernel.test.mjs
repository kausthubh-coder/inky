import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { registerHooks } from "node:module";
import test from "node:test";

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
    allowsAutomaticWork: true, isWorkerRunning: false,
    setSchedulingEnabled() {}, reconcileQueue() { reconciliations++; },
    state: () => ({ entries, lease: null }),
  };
  const store = {
    assignments: { get: () => ({ title: "Limits practice" }) },
    productPreferences: { get: async () => ({}) },
    lifecycle: { getSchedule: () => schedule, getActiveExecution: () => null,
      putNotification: notification => (notices.push(notification), notification) },
  };
  const kernel = new AppKernel(store, manager, { reconcileDeadlines: options.reconcileDeadlines ?? (async () => {}) },
    { isScanStartBlocked: () => false }, window, {
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
