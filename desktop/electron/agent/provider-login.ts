import type { AuthEvent } from "@earendil-works/pi-ai";

import {
  ProviderLoginHandoffSchema,
  type AgentProviderId,
  type ProviderLoginHandoff,
} from "../../shared/index.js";

export interface ProviderLoginInteraction {
  notify(event: AuthEvent): void;
  /** Resolves with the code the student pasted, or rejects when the attempt is abandoned. */
  awaitManualCode(signal?: AbortSignal): Promise<string>;
}

export type BeginProviderLogin = (
  providerId: AgentProviderId,
  signal: AbortSignal,
  interaction: ProviderLoginInteraction,
) => Promise<void>;

interface ActiveLoginAttempt {
  readonly providerId: AgentProviderId;
  readonly controller: AbortController;
  expiryTimer?: ReturnType<typeof setTimeout>;
  manualCode?: { resolve(code: string): void; reject(error: Error): void } | undefined;
}

const DEFAULT_DEVICE_CODE_EXPIRY_SECONDS = 15 * 60;
const BROWSER_LOGIN_EXPIRY_SECONDS = 10 * 60;

/**
 * Owns at most one subscription sign-in at a time and projects only the retry-safe parts of it.
 * Device codes (ChatGPT) and browser sign-ins (Claude) both land here; tokens never leave Pi.
 */
export class ProviderLoginAttemptOwner {
  readonly #beginLogin: BeginProviderLogin;
  #active: ActiveLoginAttempt | null = null;
  #handoff: ProviderLoginHandoff | null = null;

  constructor(beginLogin: BeginProviderLogin) {
    this.#beginLogin = beginLogin;
  }

  get handoff(): ProviderLoginHandoff | null {
    return this.#handoff;
  }

  start(providerId: AgentProviderId): ProviderLoginHandoff {
    if (this.#active?.providerId === providerId) return this.#handoff ?? { phase: "starting", providerId };
    this.cancel();

    const attempt: ActiveLoginAttempt = { providerId, controller: new AbortController() };
    this.#active = attempt;
    this.#handoff = { phase: "starting", providerId };
    void this.#run(attempt);
    return this.#handoff;
  }

  /** Hands a pasted code to the waiting sign-in. Ignored when nothing is waiting for one. */
  complete(providerId: AgentProviderId, code: string): void {
    const attempt = this.#active;
    if (!attempt || attempt.providerId !== providerId || !attempt.manualCode) return;
    const pending = attempt.manualCode;
    attempt.manualCode = undefined;
    pending.resolve(code);
  }

  cancel(): void {
    const attempt = this.#active;
    this.#active = null;
    this.#handoff = null;
    if (!attempt) return;
    this.#finish(attempt);
    attempt.controller.abort();
  }

  dispose(): void {
    this.cancel();
  }

  async #run(attempt: ActiveLoginAttempt): Promise<void> {
    try {
      await this.#beginLogin(attempt.providerId, attempt.controller.signal, {
        notify: (event) => this.#accept(attempt, event),
        awaitManualCode: (signal) => this.#awaitManualCode(attempt, signal),
      });
      if (this.#active !== attempt) return;
      this.#finish(attempt);
      this.#active = null;
      this.#handoff = null;
    } catch {
      if (this.#active !== attempt) return;
      this.#finish(attempt);
      this.#active = null;
      this.#handoff = attempt.controller.signal.aborted
        ? null
        : { phase: "failed", providerId: attempt.providerId };
    }
  }

  #accept(attempt: ActiveLoginAttempt, event: AuthEvent): void {
    if (this.#active !== attempt) return;
    if (event.type === "device_code") {
      const expiresInSeconds = event.expiresInSeconds ?? DEFAULT_DEVICE_CODE_EXPIRY_SECONDS;
      this.#handoff = ProviderLoginHandoffSchema.parse({
        phase: "waiting",
        providerId: attempt.providerId,
        verificationUri: event.verificationUri,
        userCode: event.userCode,
        expiresAt: expiresAt(expiresInSeconds),
      });
      this.#expireAfter(attempt, expiresInSeconds);
    } else if (event.type === "auth_url") {
      this.#handoff = ProviderLoginHandoffSchema.parse({
        phase: "browser",
        providerId: attempt.providerId,
        authorizationUrl: event.url,
        expiresAt: expiresAt(BROWSER_LOGIN_EXPIRY_SECONDS),
      });
      this.#expireAfter(attempt, BROWSER_LOGIN_EXPIRY_SECONDS);
    }
  }

  #awaitManualCode(attempt: ActiveLoginAttempt, signal?: AbortSignal): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (this.#active !== attempt) {
        reject(new Error("Login attempt ended"));
        return;
      }
      attempt.manualCode = { resolve, reject };
      signal?.addEventListener(
        "abort",
        () => {
          if (attempt.manualCode?.resolve === resolve) attempt.manualCode = undefined;
          reject(new Error("Login callback completed"));
        },
        { once: true },
      );
    });
  }

  #expireAfter(attempt: ActiveLoginAttempt, seconds: number): void {
    if (attempt.expiryTimer) clearTimeout(attempt.expiryTimer);
    attempt.expiryTimer = setTimeout(() => {
      if (this.#active !== attempt) return;
      this.#finish(attempt);
      this.#active = null;
      this.#handoff = { phase: "expired", providerId: attempt.providerId };
      attempt.controller.abort();
    }, seconds * 1_000);
  }

  #finish(attempt: ActiveLoginAttempt): void {
    if (attempt.expiryTimer) clearTimeout(attempt.expiryTimer);
    attempt.manualCode?.reject(new Error("Login attempt ended"));
    attempt.manualCode = undefined;
  }
}

function expiresAt(seconds: number): string {
  return new Date(Date.now() + seconds * 1_000).toISOString();
}
