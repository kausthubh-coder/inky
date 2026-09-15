import { z } from "zod";

import { AgentReasoningEffortSchema, ProviderStatusSchema, type ProviderStatus } from "./agent-runtime.js";
import { AgentProviderIdSchema, agentProvider, type AgentProviderId } from "./providers.js";
import { IsoTimestampSchema } from "./schema-version.js";

export const BrowserElementSchema = z.strictObject({
  ref: z.string().min(1),
  role: z.string().min(1),
  name: z.string(),
  value: z.string().optional(),
  href: z.string().url().optional(),
});

export const BrowserSnapshotSchema = z.strictObject({
  revision: z.number().int().positive(),
  url: z.string(),
  title: z.string(),
  text: z.string().max(8_000),
  elements: z.array(BrowserElementSchema).max(80),
  truncated: z.boolean(),
  nextOffset: z.number().int().nonnegative().optional(),
  search: z.string().optional(),
});

export const BROWSER_TOOL_NAMES = [
  "browser_snapshot",
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_select",
  "browser_press",
  "browser_wait",
  "browser_scroll",
  "browser_link",
  "browser_screenshot",
] as const;

export const BrowserDriverSchema = z.enum(["inky", "student", "none"]);
export type BrowserDriver = z.infer<typeof BrowserDriverSchema>;

export const BrowserStateSchema = z.strictObject({
  url: z.string(),
  title: z.string(),
  revision: z.number().int().positive(),
  driver: BrowserDriverSchema,
});

export function browserDriver(input: {
  readonly layout: "hidden" | "onboarding" | "desk";
  readonly scanState?: "running" | "needs_user" | "succeeded" | "partial" | "failed";
  readonly executionPhase?:
    | "working"
    | "needs_user"
    | "ready_review"
    | "submitting"
    | "submitted"
    | "preserved"
    | "failed";
}): BrowserDriver {
  if (input.layout === "hidden") return "none";
  if (input.executionPhase === "working" || input.executionPhase === "submitting") return "inky";
  if (input.scanState === "running") return "inky";
  return "student";
}

export function driveOverlayActive(input: { readonly driver: BrowserDriver }): boolean {
  return input.driver === "inky";
}

export const AgentModelSchema = z.strictObject({
  providerId: AgentProviderIdSchema,
  id: z.string().min(1),
  name: z.string().min(1),
});

/**
 * What the renderer may know about an in-flight subscription sign-in. Tokens never cross.
 * waiting: ChatGPT showed a device code to type. browser: Claude opened a sign-in page that
 * hands the result back on its own, with a pasted code as the fallback.
 */
export const ProviderLoginHandoffSchema = z.discriminatedUnion("phase", [
  z.strictObject({ phase: z.literal("starting"), providerId: AgentProviderIdSchema }),
  z.strictObject({
    phase: z.literal("waiting"),
    providerId: AgentProviderIdSchema,
    verificationUri: z.string().url(),
    userCode: z.string().min(1).max(100),
    expiresAt: IsoTimestampSchema,
  }),
  z.strictObject({
    phase: z.literal("browser"),
    providerId: AgentProviderIdSchema,
    authorizationUrl: z.string().url(),
    expiresAt: IsoTimestampSchema,
  }),
  z.strictObject({ phase: z.literal("failed"), providerId: AgentProviderIdSchema }),
  z.strictObject({ phase: z.literal("expired"), providerId: AgentProviderIdSchema }),
]);

export const StudiWorkspaceStateSchema = z.strictObject({
  browser: BrowserStateSchema,
  /** One status per catalogued subscription, in catalog order. */
  providers: z.array(ProviderStatusSchema).min(1),
  selectedProviderId: AgentProviderIdSchema,
  providerLogin: ProviderLoginHandoffSchema.nullable(),
  /** Models of every catalogued subscription; pick by providerId. */
  models: z.array(AgentModelSchema),
  selectedModelId: z.string().min(1),
  selectedReasoningEffort: AgentReasoningEffortSchema,
});

/** The subscription Inky is using right now. */
export function selectedProvider(
  workspace: Pick<StudiWorkspaceState, "providers" | "selectedProviderId">,
): ProviderStatus {
  const [first] = workspace.providers;
  const selected =
    workspace.providers.find((provider) => provider.providerId === workspace.selectedProviderId) ?? first;
  if (!selected) throw new Error("The workspace has no subscription status");
  return selected;
}

/** The model Inky would use for a subscription: the catalog's preferred one when installed, else the first. */
export function defaultModelFor(
  models: readonly AgentModel[],
  providerId: AgentProviderId,
): AgentModel | undefined {
  const candidates = models.filter((model) => model.providerId === providerId);
  for (const modelId of agentProvider(providerId).preferredModelIds) {
    const preferred = candidates.find((model) => model.id === modelId);
    if (preferred) return preferred;
  }
  return candidates[0];
}

export function providerLoginActive(login: ProviderLoginHandoff | null | undefined): boolean {
  return login?.phase === "starting" || login?.phase === "waiting" || login?.phase === "browser";
}

export const AgentTurnResultSchema = z.strictObject({
  outcome: z.enum(["completed", "failed", "aborted"]),
  text: z.string(),
});

export type BrowserElement = z.infer<typeof BrowserElementSchema>;
export type BrowserSnapshot = z.infer<typeof BrowserSnapshotSchema>;
export type BrowserState = z.infer<typeof BrowserStateSchema>;
export type AgentModel = z.infer<typeof AgentModelSchema>;
export type ProviderLoginHandoff = z.infer<typeof ProviderLoginHandoffSchema>;
export type StudiWorkspaceState = z.infer<typeof StudiWorkspaceStateSchema>;
export type AgentTurnResult = z.infer<typeof AgentTurnResultSchema>;
