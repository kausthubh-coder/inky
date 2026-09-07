import type { UpdateState } from "../../shared/updates.js";
import { newerVersion } from "../../shared/updates.js";

export interface NativeUpdater {
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
  setFeedURL(options: { url: string }): void;
  checkForUpdates(): void;
  quitAndInstall(): void;
}
export interface UpdateDependencies {
  platform: string;
  arch: string;
  packaged: boolean;
  version: string;
  firstRun: boolean;
  native: NativeUpdater;
  blocked: () => string | null;
  prepare: () => Promise<void>;
  recover?: () => void;
  now?: () => number;
  openDownload: (url: string) => Promise<void>;
  fetchRelease?: () => Promise<unknown>;
  report: (error: unknown) => void;
}

const repository =
  "https://api.github.com/repos/kausthubh-coder/inky/releases/latest";
export class UpdateService {
  #state: UpdateState;
  #inFlight = false;
  #disposed = false;
  #watchdog: ReturnType<typeof setTimeout> | undefined;
  #listeners: Array<[string, (...args: any[]) => void]> = [];
  readonly #allowCheckAt: number;
  #downloadUrl: string | null = null;
  #ready = false;
  #timer: ReturnType<typeof setInterval> | undefined;
  readonly #deps: UpdateDependencies;
  constructor(deps: UpdateDependencies) {
    this.#deps = deps;
    this.#allowCheckAt =
      (deps.now?.() ?? Date.now()) + (deps.firstRun ? 10_000 : 0);
    this.#state = {
      capability: !deps.packaged
        ? "unavailable"
        : deps.platform === "win32" && deps.arch === "x64"
          ? "native"
          : deps.platform === "darwin"
            ? "manual"
            : "unavailable",
      installedVersion: deps.version,
      targetVersion: null,
      phase: "idle",
      notes: "",
      error: null,
      restartBlock: null,
    };
    if (this.#state.capability === "native") {
      deps.native.setFeedURL({
        url: `https://update.electronjs.org/kausthubh-coder/inky/win32-x64/${deps.version}`,
      });
      this.#on("update-available", () => {
        if (this.#inFlight) {
          this.#state.phase = "downloading";
          this.#armWatchdog(15 * 60_000);
        }
      });
      this.#on("update-not-available", () => {
        if (!this.#ready && this.#inFlight) {
          clearTimeout(this.#watchdog);
          this.#state.phase = "idle";
          this.#inFlight = false;
        }
      });
      this.#on("update-downloaded", (_event, notes, name) => {
        clearTimeout(this.#watchdog);
        this.#ready = true;
        this.#inFlight = false;
        this.#state = {
          ...this.#state,
          phase: "ready",
          targetVersion:
            typeof name === "string" && newerVersion(name, deps.version)
              ? name.replace(/^v/, "")
              : null,
          notes: typeof notes === "string" ? notes.slice(0, 20_000) : "",
          error: null,
        };
      });
      this.#on("error", (error) => this.#fail(error));
    }
  }
  get restarting(): boolean {
    return this.#state.phase === "preparing_restart";
  }
  state(): UpdateState {
    return { ...this.#state, restartBlock: this.#deps.blocked() };
  }
  start(): void {
    if (this.#state.capability === "unavailable" || this.#timer) return;
    // Squirrel holds an installation lock on first launch. The hourly check is safe later.
    if (!this.#deps.firstRun) void this.check();
    this.#timer = setInterval(() => void this.check(), 60 * 60 * 1000);
    this.#timer.unref();
  }
  dispose(): void {
    this.#disposed = true;
    clearInterval(this.#timer);
    clearTimeout(this.#watchdog);
    for (const [event, listener] of this.#listeners)
      this.#deps.native.removeListener(event, listener);
    this.#listeners = [];
  }
  async check(): Promise<UpdateState> {
    if (
      this.#disposed ||
      (this.#deps.now?.() ?? Date.now()) < this.#allowCheckAt ||
      this.#inFlight ||
      this.#ready ||
      this.restarting ||
      this.#state.capability === "unavailable"
    )
      return this.state();
    this.#inFlight = true;
    this.#state.phase = "checking";
    this.#state.error = null;
    try {
      if (this.#state.capability === "native") {
        this.#armWatchdog(60_000);
        this.#deps.native.checkForUpdates();
      } else {
        const raw = await (this.#deps.fetchRelease?.() ??
          fetch(repository, {
            headers: { Accept: "application/vnd.github+json" },
            signal: AbortSignal.timeout(15_000),
          }).then((response) => {
            if (!response.ok)
              throw new Error("The update service could not be reached.");
            return response.json();
          }));
        if (this.#disposed) return this.state();
        if (!raw || typeof raw !== "object")
          throw new Error("The release information is incomplete.");
        const release = raw as {
          tag_name?: string;
          draft?: boolean;
          prerelease?: boolean;
          body?: string;
          assets?: Array<{ name?: string; browser_download_url?: string }>;
        };
        if (!release.tag_name || release.draft || release.prerelease)
          throw new Error("The release information is incomplete.");
        if (!newerVersion(release.tag_name, this.#deps.version))
          this.#state.phase = "idle";
        else {
          const asset = release.assets?.find(
            (item) => item.name === "Studi-macOS.dmg",
          );
          const expected = `https://github.com/kausthubh-coder/inky/releases/download/${encodeURIComponent(release.tag_name)}/Studi-macOS.dmg`;
          if (!asset || asset.browser_download_url !== expected)
            throw new Error("The Mac installer is not available yet.");
          this.#downloadUrl = expected;
          this.#ready = true;
          this.#state = {
            ...this.#state,
            phase: "ready",
            targetVersion: release.tag_name.replace(/^v/, ""),
            notes:
              typeof release.body === "string"
                ? release.body.slice(0, 20_000)
                : "",
          };
        }
        this.#inFlight = false;
      }
    } catch (error) {
      this.#fail(error);
    }
    return this.state();
  }
  async install(): Promise<UpdateState> {
    if (this.#disposed || !this.#ready || this.restarting) return this.state();
    if (this.#state.capability === "manual") {
      try {
        if (this.#downloadUrl) await this.#deps.openDownload(this.#downloadUrl);
      } catch (error) {
        this.#fail(error);
      }
      return this.state();
    }
    const block = this.#deps.blocked();
    if (block) return this.state();
    this.#state.phase = "preparing_restart";
    try {
      await this.#deps.prepare();
      this.#deps.native.quitAndInstall();
    } catch (error) {
      this.#deps.recover?.();
      this.#fail(error);
    }
    return this.state();
  }
  #on(event: string, listener: (...args: any[]) => void): void {
    const guarded = (...args: any[]) => {
      if (!this.#disposed) listener(...args);
    };
    this.#listeners.push([event, guarded]);
    this.#deps.native.on(event, guarded);
  }
  #armWatchdog(ms: number): void {
    clearTimeout(this.#watchdog);
    this.#watchdog = setTimeout(
      () =>
        this.#fail(
          new Error(
            "The update is taking too long. Try again when your connection is ready.",
          ),
        ),
      ms,
    );
    this.#watchdog.unref();
  }
  #fail(error: unknown): void {
    if (this.#disposed) return;
    clearTimeout(this.#watchdog);
    this.#inFlight = false;
    this.#state.phase = this.#ready ? "ready" : "error";
    this.#state.error =
      error instanceof Error ? error.message : "The update could not finish.";
    this.#deps.report(error);
  }
}
