import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { FeedbackReceipt } from "../../shared/index.js";

export interface CloudAccountResult {
  readonly subject: string;
  readonly email: string | null;
  readonly name: string | null;
  readonly approved: boolean;
  readonly reason: "waitlist" | "device_conflict" | null;
  readonly plan: "beta" | "supporter" | null;
  readonly credits: number | null;
  readonly checkedAt: number;
}

const bootstrapAccount = makeFunctionReference<"mutation", { deviceId: string }, CloudAccountResult>("account:bootstrap");
const releaseAccountDevice = makeFunctionReference<"mutation", { deviceId: string }, null>("account:releaseDevice");
const submitAccountFeedback = makeFunctionReference<"mutation", { deviceId: string; feedbackId: string; message: string }, FeedbackReceipt>("feedback:submit");

export class CloudAccountClient {
  readonly #client: ConvexHttpClient;
  readonly #getIdentityToken: () => Promise<string | null>;

  constructor(url: string, getIdentityToken: () => Promise<string | null>) {
    this.#client = new ConvexHttpClient(url);
    this.#getIdentityToken = getIdentityToken;
  }

  async evaluate(deviceId: string): Promise<CloudAccountResult> {
    await this.#authenticate();
    return this.#client.mutation(bootstrapAccount, { deviceId });
  }

  async submitFeedback(deviceId: string, feedbackId: string, message: string): Promise<FeedbackReceipt> {
    await this.#authenticate();
    return this.#client.mutation(submitAccountFeedback, { deviceId, feedbackId, message });
  }

  async releaseDevice(deviceId: string): Promise<void> {
    await this.#authenticate();
    await this.#client.mutation(releaseAccountDevice, { deviceId });
  }

  clearAuth(): void {
    this.#client.clearAuth();
  }

  async #authenticate(): Promise<void> {
    const token = await this.#getIdentityToken();
    if (!token) throw new Error("Authentication is no longer valid");
    this.#client.setAuth(token);
  }
}
