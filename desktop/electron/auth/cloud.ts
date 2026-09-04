import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { ConnectedAppConnection, ConnectedAppExecution, ConnectedAppsState, ConnectedAppToolSearch, FeedbackReceipt, UsageRecordInput, UsageState } from "../../shared/index.js";

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
const getConnectedApps = makeFunctionReference<"action", Record<string, never>, ConnectedAppsState>("composio:status");
const authorizeConnectedApp = makeFunctionReference<"action", { toolkit: string }, ConnectedAppConnection>("composio:authorize");
const getConnectedAppConnection = makeFunctionReference<"action", { toolkit: string }, ConnectedAppConnection>("composio:connection");
const searchConnectedAppTools = makeFunctionReference<"action", { toolkit: string; query: string }, ConnectedAppToolSearch>("composio:search");
const executeConnectedAppTool = makeFunctionReference<"action", { toolkit: string; toolSlug: string; arguments: Record<string, unknown> }, ConnectedAppExecution>("composio:execute");
const getCurrentUsage = makeFunctionReference<"query", { period: string; throughDate: string }, UsageState>("usage:current");
const recordUsage = makeFunctionReference<"mutation", {
  deviceId: string;
  eventId: string;
  occurredAt: number;
  kind: UsageRecordInput["kind"];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  toolCalls: number;
}, { recorded: boolean }>("usage:record");

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

  async connectedApps(): Promise<ConnectedAppsState> {
    await this.#authenticate();
    return this.#client.action(getConnectedApps, {});
  }

  async authorizeConnectedApp(toolkit: string): Promise<ConnectedAppConnection> {
    await this.#authenticate();
    return this.#client.action(authorizeConnectedApp, { toolkit });
  }

  async connectedAppConnection(toolkit: string): Promise<ConnectedAppConnection> {
    await this.#authenticate();
    return this.#client.action(getConnectedAppConnection, { toolkit });
  }

  async searchConnectedAppTools(toolkit: string, query: string): Promise<ConnectedAppToolSearch> {
    await this.#authenticate();
    return this.#client.action(searchConnectedAppTools, { toolkit, query });
  }

  async executeConnectedAppTool(toolkit: string, toolSlug: string, arguments_: Record<string, unknown>): Promise<ConnectedAppExecution> {
    await this.#authenticate();
    return this.#client.action(executeConnectedAppTool, { toolkit, toolSlug, arguments: arguments_ });
  }

  async usage(period: string, throughDate: string): Promise<UsageState> {
    await this.#authenticate();
    return this.#client.query(getCurrentUsage, { period, throughDate });
  }

  async recordUsage(deviceId: string, input: UsageRecordInput): Promise<void> {
    await this.#authenticate();
    await this.#client.mutation(recordUsage, {
      ...input,
      deviceId,
      occurredAt: new Date(input.occurredAt).valueOf(),
    });
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
