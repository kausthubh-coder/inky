import { randomUUID } from "node:crypto";

import {
  Menu,
  Notification,
  Tray,
  app,
  nativeImage,
  powerMonitor,
  type BrowserWindow,
} from "electron";

import { STUDI_SCHEMA_VERSION, type AutomationSchedule, type LifecycleState, type NotificationIntent, type SchoolOnboardingState } from "../../shared/index.js";
import type { AssignmentExecutionCoordinator, ExecutionNotification } from "../assignment/coordinator.js";
import { VisibleBrowserBusyError, type VisibleBrowserWork } from "../browser/work-ownership.js";
import type { ManagerCoordinator } from "../manager/coordinator.js";
import type { LocalStore } from "../storage/index.js";
import { createAutomationSchedule, nextScheduleRun } from "./schedule.js";

const MAX_TIMER_MS = 2_147_000_000;
const BUSY_BROWSER_RECHECK_MS = 30_000;
const TRAY_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAIElEQVR42mNkYGD4z0ABYBw1gGE0DBgGBoZRA0YNGAAA7v0DHbCaqwAAAABJRU5ErkJggg==";

export class AppKernel {
  readonly #store: LocalStore;
  readonly #manager: ManagerCoordinator;
  readonly #execution: AssignmentExecutionCoordinator;
  readonly #browserWork: VisibleBrowserWork;
  readonly #window: BrowserWindow;
  readonly #runScheduledScan: (claimOccurrence: () => AutomationSchedule | null) => Promise<{ readonly claim: AutomationSchedule; readonly state: SchoolOnboardingState } | null>;
  readonly #focusBrowser: () => void;
  readonly #now: () => string;
  #tray: Tray | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #quitting = false;
  #disposed = false;
  #closeInterceptions = 0;
  #openRequests = 0;

  constructor(
    store: LocalStore,
    manager: ManagerCoordinator,
    execution: AssignmentExecutionCoordinator,
    browserWork: VisibleBrowserWork,
    window: BrowserWindow,
    options: {
      readonly runScheduledScan: (claimOccurrence: () => AutomationSchedule | null) => Promise<{ readonly claim: AutomationSchedule; readonly state: SchoolOnboardingState } | null>;
      readonly focusBrowser: () => void;
      readonly now?: () => string;
    },
  ) {
    this.#store = store;
    this.#manager = manager;
    this.#execution = execution;
    this.#browserWork = browserWork;
    this.#window = window;
    this.#runScheduledScan = options.runScheduledScan;
    this.#focusBrowser = options.focusBrowser;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async start(): Promise<void> {
    this.#assertUsable();
    this.#window.on("close", this.#hideOnClose);
    app.on("before-quit", this.#beforeQuit);
    powerMonitor.on("resume", this.#resume);
    this.#tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON));
    this.#tray.setToolTip("Studi");
    this.#tray.on("click", this.open);
    this.#refreshTray();
    await this.reconcile();
  }

  state(): LifecycleState {
    return this.#execution.state(this.#window.isVisible());
  }

  configureSchedule(
    cadence: "manual" | "daily" | "weekly",
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
    requested: { readonly localTime?: string; readonly weekday?: number } = {},
  ): LifecycleState {
    const now = this.#now();
    const schedule = createAutomationSchedule(cadence, timezone, now, this.#store.lifecycle.getSchedule(), requested);
    this.#store.lifecycle.putSchedule(schedule);
    this.#refreshTray();
    this.#armTimer();
    return this.state();
  }

  setAutomationPaused(paused: boolean): LifecycleState {
    const current = this.#store.lifecycle.getSchedule();
    if (!current) throw new Error("No automation schedule is configured");
    const now = this.#now();
    const nextRunAt = !paused && current.cadence !== "manual"
      ? (!current.nextRunAt || current.nextRunAt <= now ? nextScheduleRun(current, now) : current.nextRunAt)
      : current.nextRunAt;
    this.#store.lifecycle.putSchedule({
      ...current,
      state: paused ? "paused" : "enabled",
      ...(nextRunAt === undefined ? {} : { nextRunAt }),
      updatedAt: now,
    });
    this.#refreshTray();
    this.#armTimer();
    return this.state();
  }

  async notify(intent: ExecutionNotification): Promise<void> {
    const now = this.#now();
    const record = this.#store.lifecycle.putNotification({
      ...intent,
      schemaVersion: STUDI_SCHEMA_VERSION,
      notificationId: `notification-${randomUUID()}`,
      createdAt: now,
    });
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title: record.title, body: record.body, silent: false });
    notification.on("click", () => {
      this.#store.lifecycle.putNotification({ ...record, deliveredAt: record.deliveredAt ?? now, clickedAt: this.#now() });
      this.#focusTarget(record);
    });
    notification.show();
    this.#store.lifecycle.putNotification({ ...record, deliveredAt: this.#now() });
  }

  open = (): void => {
    this.#openRequests += 1;
    if (this.#window.isMinimized()) this.#window.restore();
    this.#window.show();
    this.#window.focus();
    this.#focusBrowser();
  };

  requestQuit(): void {
    this.#quitting = true;
    app.quit();
  }

  lifecycleReceipt(): { readonly closeInterceptions: number; readonly openRequests: number; readonly quitting: boolean } {
    return { closeInterceptions: this.#closeInterceptions, openRequests: this.#openRequests, quitting: this.#quitting };
  }

  async reconcile(): Promise<void> {
    this.#assertUsable();
    await this.#execution.reconcileDeadlines();
    const schedule = this.#store.lifecycle.getSchedule();
    const now = this.#now();
    if (schedule?.state === "enabled" && schedule.cadence !== "manual" && schedule.nextRunAt && schedule.nextRunAt <= now) {
      const nextRunAt = nextScheduleRun(schedule, now);
      try {
        const scheduled = await this.#runScheduledScan(() => this.#store.lifecycle.claimDueSchedule(now, nextRunAt));
        if (scheduled) {
          const scan = scheduled.state.scan;
          await this.notify({
            kind: scan?.state === "succeeded" ? "scan_result" : scan?.state === "needs_user" ? "handoff" : "failure",
            target: { type: "scan", id: scan?.scanId ?? scheduled.claim.lastClaimedOccurrence! },
            title: scan?.state === "succeeded" ? "School scan finished" : "School scan needs attention",
            body: scan?.currentStep ?? "The scheduled school scan did not return a scan record.",
          });
        }
      } catch (error) {
        if (!(error instanceof VisibleBrowserBusyError)) {
          await this.notify({
            kind: "failure",
            target: { type: "scan", id: schedule.nextRunAt },
            title: "Scheduled school scan failed",
            body: error instanceof Error ? error.message.slice(0, 500) : "The scheduled scan stopped.",
          });
        }
      }
    }
    this.#refreshTray();
    this.#armTimer();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    powerMonitor.removeListener("resume", this.#resume);
    app.removeListener("before-quit", this.#beforeQuit);
    this.#window.removeListener("close", this.#hideOnClose);
    this.#tray?.removeListener("click", this.open);
    this.#tray?.destroy();
    this.#tray = null;
  }

  #hideOnClose = (event: Electron.Event): void => {
    if (this.#quitting) return;
    this.#closeInterceptions += 1;
    event.preventDefault();
    this.#window.hide();
    this.#refreshTray();
  };

  #beforeQuit = (): void => {
    this.#quitting = true;
  };

  #resume = (): void => {
    void this.reconcile();
  };

  #focusTarget(intent: NotificationIntent): void {
    this.open();
    this.#window.webContents.send("studi:lifecycle-activated", intent.target);
  }

  #refreshTray(): void {
    if (!this.#tray) return;
    const schedule = this.#store.lifecycle.getSchedule();
    const lease = this.#manager.state().lease;
    const status = lease
      ? `Working on ${lease.taskId}`
      : schedule?.state === "paused"
        ? "Automation paused"
        : schedule?.nextRunAt
          ? `Next scan ${new Date(schedule.nextRunAt).toLocaleString()}`
          : "Ready";
    this.#tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open Studi", click: this.open },
      { label: status, enabled: false },
      { type: "separator" },
      {
        label: schedule?.state === "paused" ? "Resume automation" : "Pause automation",
        enabled: Boolean(schedule),
        click: () => { this.setAutomationPaused(schedule?.state !== "paused"); },
      },
      { type: "separator" },
      { label: "Quit Studi", click: () => this.requestQuit() },
    ]));
  }

  #armTimer(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    const candidates: number[] = [];
    const now = Date.parse(this.#now());
    const schedule = this.#store.lifecycle.getSchedule();
    if (schedule?.state === "enabled" && schedule.nextRunAt) {
      const scheduledAt = Date.parse(schedule.nextRunAt);
      candidates.push(scheduledAt <= now && this.#browserWork.isScanStartBlocked() ? now + BUSY_BROWSER_RECHECK_MS : scheduledAt);
    }
    const execution = this.#store.lifecycle.getActiveExecution();
    if (execution?.phase === "ready_review") {
      const releaseAt = execution.handoffDeadline ?? execution.reviewDeadline;
      if (releaseAt) candidates.push(Date.parse(releaseAt));
    }
    if (candidates.length === 0) return;
    const delay = Math.min(MAX_TIMER_MS, Math.max(0, Math.min(...candidates) - now));
    this.#timer = setTimeout(() => { void this.reconcile(); }, delay);
  }

  #assertUsable(): void {
    if (this.#disposed) throw new Error("App kernel is disposed");
  }
}
