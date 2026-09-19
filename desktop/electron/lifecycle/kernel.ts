import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  Menu,
  Notification,
  Tray,
  app,
  nativeImage,
  powerMonitor,
  type BrowserWindow,
} from "electron";

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  LIFECYCLE_ACTIVATED_CHANNEL,
  PLAY_NOTIFICATION_SOUND_CHANNEL,
  STUDI_SCHEMA_VERSION,
  resolveNotificationSound,
  shouldShowNotificationBanner,
  type AutomationSchedule,
  type LifecycleState,
  type NotificationIntent,
  type NotificationKind,
  type NotificationSoundId,
  type NotificationTestReceipt,
  type SchoolOnboardingState,
} from "../../shared/index.js";
import type { AssignmentExecutionCoordinator, ExecutionNotification } from "../assignment/coordinator.js";
import { VisibleBrowserBusyError, type VisibleBrowserWork } from "../browser/work-ownership.js";
import type { ManagerCoordinator } from "../manager/coordinator.js";
import type { LocalStore } from "../storage/index.js";
import { createAutomationSchedule, nextScheduleRun, withinHomeworkHours } from "./schedule.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const unpackedSoundDirectory = resolve(moduleDirectory, "..", "..", "..", "assets", "sounds");

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
  readonly #runScheduledAssignment: ((taskId: string) => Promise<unknown>) | undefined;
  #reconciling = false;
  #reconcileRequested = false;
  #requestTimer: ReturnType<typeof setTimeout> | null = null;
  #reconcileRetryAt = 0;
  #assignmentRetryAt = 0;
  readonly #iconPath: string | undefined;
  readonly #now: () => string;
  #tray: Tray | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #quitting = false;
  #disposed = false;
  #updating = false;
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
      readonly runScheduledAssignment?: (taskId: string) => Promise<unknown>;
      readonly iconPath?: string;
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
    this.#runScheduledAssignment = options.runScheduledAssignment;
    this.#iconPath = options.iconPath;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async start(): Promise<void> {
    this.#assertUsable();
    this.#manager.setSchedulingEnabled(Boolean(this.#runScheduledAssignment));
    this.#window.on("close", this.#hideOnClose);
    app.on("before-quit", this.#beforeQuit);
    powerMonitor.on("resume", this.#resume);
    const bundledIcon = this.#iconPath ? nativeImage.createFromPath(this.#iconPath) : nativeImage.createFromDataURL(TRAY_ICON);
    const trayIcon = bundledIcon.isEmpty()
      ? nativeImage.createFromDataURL(TRAY_ICON)
      : bundledIcon.resize({ width: 32, height: 32, quality: "best" });
    this.#tray = new Tray(trayIcon);
    this.#tray.setToolTip("Studi");
    this.#tray.on("click", this.open);
    this.#refreshTray();
    this.requestReconcile();
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
    this.#manager.reconcileQueue();
    this.#refreshTray();
    this.#armTimer();
    this.requestReconcile();
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
    this.#manager.reconcileQueue();
    this.#refreshTray();
    this.#armTimer();
    this.requestReconcile();
    return this.state();
  }

  async notify(intent: ExecutionNotification): Promise<NotificationTestReceipt> {
    const now = this.#now();
    const preferences = (await this.#store.productPreferences.get()).notifications ?? DEFAULT_NOTIFICATION_PREFERENCES;
    const sound = preferences.kinds[intent.kind].sound;
    const resolved = resolveNotificationSound(preferences, intent.kind, (soundId) => bundledNotificationSoundPath(soundId) !== null);
    const record = this.#store.lifecycle.putNotification({
      ...intent,
      schemaVersion: STUDI_SCHEMA_VERSION,
      notificationId: `notification-${randomUUID()}`,
      createdAt: now,
    });
    const supported = Notification.isSupported();
    if (!shouldShowNotificationBanner(preferences, intent.kind) || !supported) {
      return { notification: record, shown: false, sound, supported };
    }
    const icon = this.#iconPath ? nativeImage.createFromPath(this.#iconPath) : undefined;
    const notification = new Notification({
      title: record.title,
      body: record.body,
      silent: resolved.silent,
      ...(icon && !icon.isEmpty() ? { icon } : {}),
    });
    notification.on("click", () => {
      this.#store.lifecycle.putNotification({ ...record, deliveredAt: record.deliveredAt ?? now, clickedAt: this.#now() });
      this.#focusTarget(record);
    });
    notification.show();
    const delivered = this.#store.lifecycle.putNotification({ ...record, deliveredAt: this.#now() });
    this.#playBundledSound(resolved.playSoundId);
    return { notification: delivered, shown: true, sound, supported };
  }

  async preview(kind: NotificationKind): Promise<NotificationTestReceipt> {
    const copy = PREVIEW_COPY[kind];
    const execution = this.#store.lifecycle.getActiveExecution();
    const scanId = this.#store.school.latestScan()?.scanId;
    return this.notify({
      kind,
      title: copy.title,
      body: copy.body,
      target: kind === "scan_result"
        ? { type: "scan", id: scanId ?? "settings-preview" }
        : { type: "task", id: execution?.taskId ?? "settings-preview" },
    });
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
    if (this.#updating) return;
    if (this.#reconciling) { this.#reconcileRequested = true; return; }
    this.#reconciling = true;
    this.#reconcileRequested = false;
    try {
    this.#manager.reconcileQueue();
    await this.#execution.reconcileDeadlines();
    if (this.#updating || this.#disposed) return;
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
    const workNow = this.#now();
    const workTimezone = this.#store.lifecycle.getSchedule()?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!this.#updating && !this.#disposed && this.#runScheduledAssignment && this.#manager.allowsAutomaticWork &&
      this.#store.lifecycle.getSchedule()?.state !== "paused" && !this.#browserWork.isScanStartBlocked() &&
      Date.parse(workNow) >= this.#assignmentRetryAt && withinHomeworkHours(workNow, workTimezone)) {
      this.#manager.reconcileQueue();
      const next = this.#manager.state().entries.find(entry => entry.scheduledStartAt && entry.scheduledStartAt <= workNow);
      if (next) {
        try {
          const assignment = this.#store.assignments.get(next.assignmentId);
          await this.notify({ kind: "work_start", target: { type: "task", id: next.taskId }, title: "Inky is about to start", body: `I'm about to start ${assignment?.title ?? "your homework"}. You can take over from Studi.`.slice(0, 500) });
          // A rule or ownership command may have arrived while the notification was being saved.
          this.#manager.reconcileQueue();
          const current = this.#manager.state().entries.find(entry => entry.taskId === next.taskId);
          if (current?.scheduledStartAt && current.scheduledStartAt <= this.#now() && this.#store.lifecycle.getSchedule()?.state !== "paused") await this.#runScheduledAssignment(next.taskId);
          this.#assignmentRetryAt = 0;
        }
        catch (error) {
          // Keep a permitted queue entry for retry; never claim that execution started.
          this.#assignmentRetryAt = Date.parse(this.#now()) + 5 * 60_000;
          if (!(error instanceof VisibleBrowserBusyError)) await this.notify({ kind: "failure", target: { type: "task", id: next.taskId }, title: "Homework could not start", body: error instanceof Error ? error.message.slice(0, 500) : "Inky could not start this homework." });
        }
      }
    }
    this.#reconcileRetryAt = 0;
    } finally {
      this.#reconciling = false;
      if (!this.#disposed) { this.#refreshTray(); this.#armTimer(); }
      if (this.#reconcileRequested) this.requestReconcile();
    }
  }

  requestReconcile(): void {
    if (this.#disposed || this.#updating) return;
    this.#reconcileRequested = true;
    if (this.#reconciling || this.#requestTimer) return;
    this.#requestTimer = setTimeout(() => {
      this.#requestTimer = null;
      if (this.#disposed || this.#updating) return;
      void this.reconcile().catch(error => {
        if (this.#disposed) return;
        this.#reconcileRetryAt = Date.parse(this.#now()) + 60_000;
        const reason = error instanceof Error ? error.message.slice(0, 500) : "Studi could not check its saved automation state.";
        // Persist a readable failure even if native notification delivery is the failing boundary.
        try { this.#store.lifecycle.putNotification({ schemaVersion: 1, notificationId: `notification-${randomUUID()}`, kind: "failure", target: { type: "scan", id: "automation" }, title: "Automation needs attention", body: reason || "Automation failed.", createdAt: this.#now() }); }
        catch { console.error("Studi could not save its automation failure notification."); }
        if (this.#requestTimer) clearTimeout(this.#requestTimer);
        this.#requestTimer = null;
        this.requestReconcile();
      });
    }, Math.max(0, this.#reconcileRetryAt - Date.parse(this.#now())));
  }

  prepareUpdate(): void {
    this.#updating=true;
    this.#quitting=true;
    if(this.#timer)clearTimeout(this.#timer);
    if(this.#requestTimer)clearTimeout(this.#requestTimer);
    this.#requestTimer=null;
    this.#timer=null;
  }
  cancelUpdate(): void {this.#updating=false;this.#quitting=false;this.requestReconcile();}

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#timer) clearTimeout(this.#timer);
    if (this.#requestTimer) clearTimeout(this.#requestTimer);
    this.#requestTimer = null;
    this.#timer = null;
    powerMonitor.removeListener("resume", this.#resume);
    app.removeListener("before-quit", this.#beforeQuit);
    this.#window.removeListener("close", this.#hideOnClose);
    this.#tray?.removeListener("click", this.open);
    this.#tray?.destroy();
    this.#tray = null;
    this.#manager.setSchedulingEnabled(false);
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
    this.requestReconcile();
  };

  #focusTarget(intent: NotificationIntent): void {
    this.open();
    this.#window.webContents.send(LIFECYCLE_ACTIVATED_CHANNEL, intent.target);
  }

  #refreshTray(): void {
    if (!this.#tray) return;
    const schedule = this.#store.lifecycle.getSchedule();
    const lease = this.#manager.state().lease;
    const nextWork = this.#manager.state().entries.filter(entry => entry.scheduledStartAt).sort((a, b) => a.scheduledStartAt!.localeCompare(b.scheduledStartAt!))[0];
    const status = lease
      ? `Working on ${this.#store.assignments.get(this.#store.tasks.get(lease.taskId)?.assignmentId ?? "")?.title ?? "homework"}`
      : schedule?.state === "paused"
        ? "Automation paused"
        : nextWork?.scheduledStartAt
          ? `Next homework ${new Date(nextWork.scheduledStartAt).toLocaleString()}`
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
    if(this.#updating||this.#disposed)return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    const candidates: number[] = [];
    const now = Date.parse(this.#now());
    const schedule = this.#store.lifecycle.getSchedule();
    if (this.#runScheduledAssignment && this.#manager.allowsAutomaticWork && schedule?.state !== "paused") {
      for (const entry of this.#manager.state().entries) {
        if (!entry.scheduledStartAt) continue;
        let start = Math.max(Date.parse(entry.scheduledStartAt), this.#assignmentRetryAt);
        if (start <= now && this.#browserWork.isScanStartBlocked()) start = now + BUSY_BROWSER_RECHECK_MS;
        const timezone = schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (start <= now && !withinHomeworkHours(this.#now(), timezone)) start = Date.parse(nextScheduleRun({ schemaVersion: 1, scheduleId: "school-scan", cadence: "daily", state: "enabled", timezone, localTime: "08:00", updatedAt: this.#now() }, this.#now()));
        candidates.push(start);
      }
    }
    if (schedule?.state === "enabled" && schedule.nextRunAt) {
      const scheduledAt = Date.parse(schedule.nextRunAt);
      candidates.push(scheduledAt <= now && this.#browserWork.isScanStartBlocked() ? now + BUSY_BROWSER_RECHECK_MS : scheduledAt);
    }
    const execution = this.#store.lifecycle.getActiveExecution();
    if (execution?.phase === "ready_review") {
      const assignment = this.#store.assignments.get(execution.assignmentId);
      const maySubmit = assignment && this.#manager.resolvePermission(assignment.assignmentId, assignment.courseId).maySubmit;
      const deadline = schedule?.state !== "paused" && !execution.reviewSubmissionRequestedAt && !execution.doubts?.length && maySubmit
        ? execution.reviewDeadline : execution.handoffDeadline ?? execution.reviewDeadline;
      if (deadline) candidates.push(Math.max(Date.parse(deadline), this.#manager.isWorkerRunning ? now + BUSY_BROWSER_RECHECK_MS : 0));
    }
    if (execution?.phase === "needs_user" && execution.handoffDeadline) candidates.push(Math.max(Date.parse(execution.handoffDeadline), this.#manager.isWorkerRunning ? now + BUSY_BROWSER_RECHECK_MS : 0));
    if (candidates.length === 0) return;
    // Overdue work can remain ineligible or wait on another boundary. Only new
    // commands request immediate reconciliation; a timer always yields time.
    const remaining = Math.max(this.#reconcileRetryAt, Math.min(...candidates)) - now;
    const delay = Math.min(MAX_TIMER_MS, remaining > 0 ? remaining : BUSY_BROWSER_RECHECK_MS);
    this.#timer = setTimeout(() => { this.requestReconcile(); }, delay);
  }

  #playBundledSound(soundId: NotificationSoundId | null): void {
    if (!soundId) return;
    const path = bundledNotificationSoundPath(soundId);
    if (!path || this.#window.isDestroyed()) return;
    this.#window.webContents.send(PLAY_NOTIFICATION_SOUND_CHANNEL, pathToFileURL(path).href);
  }

  #assertUsable(): void {
    if (this.#disposed) throw new Error("App kernel is disposed");
  }
}

const PREVIEW_COPY: Record<NotificationKind, { title: string; body: string }> = {
  handoff: { title: "Needs you", body: "Inky is waiting for you to finish something in the page." },
  review_ready: { title: "Ready to look over", body: "An assignment is sitting on the school page for you." },
  scan_result: { title: "Scan finished", body: "Inky finished looking at your classes." },
  failure: { title: "Something went wrong", body: "Inky had to stop and needs another look." },
  work_start: { title: "Inky is about to start", body: "I'm about to start your next homework. You can take over from Studi." },
};

function bundledNotificationSoundPath(soundId: NotificationSoundId): string | null {
  if (soundId === "silent" || soundId === "os") return null;
  const packaged = join(process.resourcesPath, "sounds", `${soundId}.wav`);
  const unpacked = join(unpackedSoundDirectory, `${soundId}.wav`);
  if (existsSync(packaged)) return packaged;
  if (existsSync(unpacked)) return unpacked;
  return null;
}
