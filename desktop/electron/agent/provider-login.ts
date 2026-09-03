import type { AuthEvent } from "@earendil-works/pi-ai";

import {
  ProviderLoginHandoffSchema,
  type ProviderLoginHandoff,
} from "../../shared/index.js";

export type BeginProviderLogin = (
  signal: AbortSignal,
  notify: (event: AuthEvent) => void,
) => Promise<void>;

interface ActiveLoginAttempt {
  readonly controller: AbortController;
  expiryTimer?: ReturnType<typeof setTimeout>;
}

const DEFAULT_DEVICE_CODE_EXPIRY_SECONDS = 15 * 60;

export class OpenAiCodexLoginAttemptOwner {
  readonly #beginLogin: BeginProviderLogin;
  #active: ActiveLoginAttempt | null = null;
  #handoff: ProviderLoginHandoff | null = null;

  constructor(beginLogin: BeginProviderLogin) {
    this.#beginLogin = beginLogin;
  }

  get handoff(): ProviderLoginHandoff | null {
    return this.#handoff;
  }

  start(): ProviderLoginHandoff {
    if (this.#active) return this.#handoff ?? { phase: "starting" };

    const attempt: ActiveLoginAttempt = { controller: new AbortController() };
    this.#active = attempt;
    this.#handoff = { phase: "starting" };
    void this.#run(attempt);
    return this.#handoff;
  }

  cancel(): void {
    const attempt = this.#active;
    this.#active = null;
    this.#handoff = null;
    if (!attempt) return;
    if (attempt.expiryTimer) clearTimeout(attempt.expiryTimer);
    attempt.controller.abort();
  }

  dispose(): void {
    this.cancel();
  }

  async #run(attempt: ActiveLoginAttempt): Promise<void> {
    try {
      await this.#beginLogin(attempt.controller.signal, (event) => {
        if (event.type === "device_code") this.#acceptDeviceCode(attempt, event);
      });
      if (this.#active !== attempt) return;
      if (attempt.expiryTimer) clearTimeout(attempt.expiryTimer);
      this.#active = null;
      this.#handoff = null;
    } catch {
      if (this.#active !== attempt) return;
      if (attempt.expiryTimer) clearTimeout(attempt.expiryTimer);
      this.#active = null;
      this.#handoff = attempt.controller.signal.aborted ? null : { phase: "failed" };
    }
  }

  #acceptDeviceCode(
    attempt: ActiveLoginAttempt,
    event: Extract<AuthEvent, { type: "device_code" }>,
  ): void {
    if (this.#active !== attempt) return;
    const expiresInSeconds = event.expiresInSeconds ?? DEFAULT_DEVICE_CODE_EXPIRY_SECONDS;
    const handoff = ProviderLoginHandoffSchema.parse({
      phase: "waiting",
      verificationUri: event.verificationUri,
      userCode: event.userCode,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1_000).toISOString(),
    });
    this.#handoff = handoff;
    attempt.expiryTimer = setTimeout(() => {
      if (this.#active !== attempt) return;
      this.#active = null;
      this.#handoff = { phase: "expired" };
      attempt.controller.abort();
    }, expiresInSeconds * 1_000);
  }
}
