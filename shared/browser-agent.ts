import { z } from "zod";

import { ProviderStatusSchema } from "./agent-runtime.js";
import { IsoTimestampSchema } from "./schema-version.js";

export const BrowserElementSchema = z.strictObject({
  ref: z.string().min(1),
  role: z.string().min(1),
  name: z.string(),
  value: z.string().optional(),
});

export const BrowserSnapshotSchema = z.strictObject({
  revision: z.number().int().positive(),
  url: z.string(),
  title: z.string(),
  text: z.string().max(8_000),
  elements: z.array(BrowserElementSchema).max(80),
  truncated: z.boolean(),
});

export const BrowserStateSchema = z.strictObject({
  url: z.string(),
  title: z.string(),
  revision: z.number().int().positive(),
});

export const AgentModelSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
});

export const ProviderLoginHandoffSchema = z.discriminatedUnion("phase", [
  z.strictObject({ phase: z.literal("starting") }),
  z.strictObject({
    phase: z.literal("waiting"),
    verificationUri: z.string().url(),
    userCode: z.string().min(1).max(100),
    expiresAt: IsoTimestampSchema,
  }),
  z.strictObject({ phase: z.literal("failed") }),
  z.strictObject({ phase: z.literal("expired") }),
]);

export const StudiWorkspaceStateSchema = z.strictObject({
  browser: BrowserStateSchema,
  provider: ProviderStatusSchema,
  providerLogin: ProviderLoginHandoffSchema.nullable(),
  models: z.array(AgentModelSchema),
  selectedModelId: z.string().min(1),
});

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
