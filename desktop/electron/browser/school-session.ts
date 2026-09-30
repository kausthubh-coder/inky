import { existsSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import type { Cookie, Session } from "electron";

// Chromium drops cookies with no expiry date when the app quits, and school single sign-on often
// uses exactly those. Studi keeps them: saved encrypted on quit and every 10 minutes, restored at
// launch before any school page loads, dropped after 14 days, deleted on sign-out.
// While Studi runs and the computer is awake, a read-only load of the school's root keeps the session alive.

const DAY_MS = 86_400_000;

export interface Encryptor {
  isEncryptionAvailable(): boolean;
  encryptString(text: string): Buffer;
  decryptString(data: Buffer): string;
}

type SavedCookie = {
  readonly url: string;
  readonly name: string;
  readonly value: string;
  readonly domain?: string;
  readonly path?: string;
  readonly secure?: boolean;
  readonly httpOnly?: boolean;
  readonly sameSite?: Cookie["sameSite"];
  /** When Studi first saw this cookie; it's dropped 14 days later. */
  readonly since: number;
};

export class SchoolSessionKeeper {
  readonly #session: Pick<Session, "cookies" | "fetch">;
  readonly #file: string;
  readonly #crypto: Encryptor;
  readonly #schoolRoot: () => string | null;
  readonly #now: () => number;
  readonly #maxAgeMs: number;
  #since = new Map<string, number>();
  #timers: ReturnType<typeof setInterval>[] = [];
  #asleep = false;

  constructor(session: Pick<Session, "cookies" | "fetch">, file: string, crypto: Encryptor, options: {
    readonly schoolRoot: () => string | null;
    readonly now?: () => number;
    readonly maxAgeDays?: number;
  }) {
    this.#session = session;
    this.#file = file;
    this.#crypto = crypto;
    this.#schoolRoot = options.schoolRoot;
    this.#now = options.now ?? Date.now;
    this.#maxAgeMs = (options.maxAgeDays ?? 14) * DAY_MS;
  }

  /** Puts saved session cookies back. Call before any school page loads. Returns how many came back. */
  async restore(): Promise<number> {
    if (!existsSync(this.#file) || !this.#crypto.isEncryptionAvailable()) return 0;
    let saved: SavedCookie[];
    try {
      saved = JSON.parse(this.#crypto.decryptString(await readFile(this.#file))) as SavedCookie[];
    } catch {
      await this.forget();
      return 0;
    }
    const fresh = saved.filter((cookie) => this.#now() - cookie.since < this.#maxAgeMs);
    let restored = 0;
    for (const cookie of fresh) {
      const { since, ...details } = cookie;
      try {
        await this.#session.cookies.set(details);
        this.#since.set(key(cookie), since);
        restored += 1;
      } catch {
        // A cookie the browser no longer accepts is simply left out.
      }
    }
    return restored;
  }

  /** Saves the session cookies (the ones Chromium would drop on quit), encrypted. */
  async save(): Promise<void> {
    if (!this.#crypto.isEncryptionAvailable()) return;
    const cookies = (await this.#session.cookies.get({})).filter((cookie) => cookie.session);
    const now = this.#now();
    const saved: SavedCookie[] = cookies.map((cookie) => {
      const since = this.#since.get(key(cookie)) ?? now;
      this.#since.set(key(cookie), since);
      const host = (cookie.domain ?? "").replace(/^\./, "");
      return {
        url: `${cookie.secure ? "https" : "http"}://${host}${cookie.path ?? "/"}`,
        name: cookie.name, value: cookie.value,
        ...(cookie.domain ? { domain: cookie.domain } : {}), ...(cookie.path ? { path: cookie.path } : {}),
        secure: cookie.secure ?? false, httpOnly: cookie.httpOnly ?? false,
        ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}), since,
      };
    }).filter((cookie) => now - cookie.since < this.#maxAgeMs);
    const temporary = `${this.#file}.tmp`;
    await writeFile(temporary, this.#crypto.encryptString(JSON.stringify(saved)));
    await rename(temporary, this.#file);
  }

  /** A plain read of the school's root page, which keeps the school's session alive. */
  async keepAlive(): Promise<void> {
    const root = this.#schoolRoot();
    if (!root || this.#asleep) return;
    try {
      await this.#session.fetch(root, { method: "GET", redirect: "follow" });
    } catch {
      // Offline or the school is down; the next round tries again.
    }
  }

  start({ saveEveryMs = 10 * 60_000, keepAliveEveryMs = 20 * 60_000 } = {}): void {
    this.stop();
    this.#timers = [
      setInterval(() => void this.save().catch(() => undefined), saveEveryMs),
      setInterval(() => void this.keepAlive(), keepAliveEveryMs),
    ];
  }

  /** The computer went to sleep or woke up. Nothing is loaded while it sleeps. */
  setAsleep(asleep: boolean): void {
    this.#asleep = asleep;
    if (!asleep) void this.keepAlive();
  }

  stop(): void {
    for (const timer of this.#timers) clearInterval(timer);
    this.#timers = [];
  }

  /** Signing out of Studi or releasing the device deletes the saved sign-in. */
  async forget(): Promise<void> {
    this.#since.clear();
    await rm(this.#file, { force: true });
  }
}

const key = (cookie: Pick<Cookie, "name" | "domain" | "path">) => `${cookie.domain ?? ""}|${cookie.path ?? "/"}|${cookie.name}`;
