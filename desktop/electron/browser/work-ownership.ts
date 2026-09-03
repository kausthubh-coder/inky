import type { LocalStore } from "../storage/index.js";

type BrowserWorkRequest =
  | { readonly kind: "assignment_start" }
  | { readonly kind: "assignment_resume"; readonly taskId: string }
  | { readonly kind: "scan_start" }
  | { readonly kind: "scan_resume" };

export class VisibleBrowserBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisibleBrowserBusyError";
  }
}

export class VisibleBrowserWork {
  readonly #store: LocalStore;
  #reservation: "assignment" | "scan" | null = null;

  constructor(store: LocalStore) {
    this.#store = store;
  }

  startAssignment<T>(run: () => Promise<T>): Promise<T> {
    return this.#run({ kind: "assignment_start" }, "assignment", run);
  }

  resumeAssignment<T>(taskId: string, run: () => Promise<T>): Promise<T> {
    return this.#run({ kind: "assignment_resume", taskId }, "assignment", run);
  }

  startScan<T>(run: () => Promise<T>): Promise<T> {
    return this.#run({ kind: "scan_start" }, "scan", run);
  }

  resumeScan<T>(run: () => Promise<T>): Promise<T> {
    return this.#run({ kind: "scan_resume" }, "scan", run);
  }

  isScanStartBlocked(): boolean {
    return this.#conflict({ kind: "scan_start" }) !== null;
  }

  async #run<T>(request: BrowserWorkRequest, reservation: "assignment" | "scan", run: () => Promise<T>): Promise<T> {
    const conflict = this.#conflict(request);
    if (conflict) throw new VisibleBrowserBusyError(conflict);
    this.#reservation = reservation;
    try {
      return await run();
    } finally {
      this.#reservation = null;
    }
  }

  #conflict(request: BrowserWorkRequest): string | null {
    if (this.#reservation) return `The visible school browser is already reserved for ${this.#reservation} work`;

    const assignmentLease = this.#store.manager.getLease();
    const scan = this.#store.school.latestScan();
    const scanOwnsBrowser = scan?.state === "running" || scan?.state === "needs_user";

    if (request.kind === "assignment_start") {
      if (assignmentLease) return `Assignment ${assignmentLease.taskId} already owns the visible school browser`;
      if (scanOwnsBrowser) return `School scan ${scan.scanId} must finish before an assignment can start`;
    }

    if (request.kind === "assignment_resume") {
      if (assignmentLease && assignmentLease.taskId !== request.taskId) {
        return `Assignment ${assignmentLease.taskId} already owns the visible school browser`;
      }
      if (scanOwnsBrowser) return `School scan ${scan.scanId} must finish before an assignment can resume`;
    }

    if (request.kind === "scan_start") {
      if (assignmentLease) return `Assignment ${assignmentLease.taskId} must finish before a school scan can start`;
      if (scanOwnsBrowser) return `School scan ${scan.scanId} already owns the visible school browser`;
    }

    if (request.kind === "scan_resume") {
      if (assignmentLease) return `Assignment ${assignmentLease.taskId} must finish before a school scan can resume`;
      if (scan?.state === "running") return `School scan ${scan.scanId} is already running`;
    }

    return null;
  }
}
