/** Serialize account activation and teardown, including sign-out during startup. */
export class ProtectedRuntimeLifecycle {
  #wanted: string | null = null;
  #active: string | null = null;
  #running: Promise<void> | null = null;
  constructor(
    private readonly initialize: (owner: string, isCurrent: () => boolean) => Promise<void>,
    private readonly dispose: () => Promise<void>,
  ) {}

  get transitioning(): boolean { return this.#running !== null; }
  activate(owner: string): Promise<void> {
    this.#wanted = owner;
    return this.#reconcile();
  }
  deactivate(): Promise<void> {
    this.#wanted = null;
    return this.#reconcile();
  }
  #reconcile(): Promise<void> {
    if (this.#running) return this.#running;
    if (this.#wanted === this.#active) return Promise.resolve();
    // Defer one microtask so #running is installed before any callback executes.
    this.#running = Promise.resolve().then(async () => {
      while (this.#wanted !== this.#active) {
        if (this.#active !== null) {
          this.#active = null;
          await this.dispose();
          continue;
        }
        const owner = this.#wanted;
        if (owner === null) break;
        try {
          await this.initialize(owner, () => this.#wanted === owner);
        } catch (error) {
          await this.dispose();
          if (this.#wanted === owner) throw error;
          continue;
        }
        if (this.#wanted !== owner) await this.dispose();
        else this.#active = owner;
      }
    }).finally(() => { this.#running = null; });
    return this.#running;
  }
}
