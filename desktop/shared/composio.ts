import { z } from "zod";

export const ConnectedAppToolkitSchema = z.strictObject({
  toolkit: z.string().min(1).max(128),
  version: z.string().regex(/^[0-9]{8}_[0-9]{2}$/),
  access: z.literal("all").optional(),
  tools: z.array(z.string().min(1).max(256)).min(1).optional(),
}).refine((value) => value.access === "all" || Boolean(value.tools?.length), {
  message: "A connected app must expose all or selected actions",
});

export const ConnectedAppsStateSchema = z.strictObject({
  configured: z.boolean(),
  toolkits: z.array(ConnectedAppToolkitSchema),
});

export const ConnectedAppConnectionSchema = z.strictObject({
  toolkit: z.string().min(1).max(128),
  sessionId: z.string().min(1),
  connectedAccountId: z.string().min(1).nullable(),
  status: z.string().min(1),
  redirectUrl: z.string().url().nullable(),
});

export const ConnectedAppToolSchema = z.strictObject({
  toolkit: z.string().min(1).max(128),
  slug: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  description: z.string().max(10_000).nullable(),
  version: z.string().regex(/^[0-9]{8}_[0-9]{2}$/),
  inputParameters: z.record(z.string(), z.unknown()),
});

export const ConnectedAppToolSearchSchema = z.strictObject({
  toolkit: z.string().min(1).max(128),
  query: z.string().min(1).max(500),
  tools: z.array(ConnectedAppToolSchema).max(24),
  guidance: z.array(z.string().max(2_000)).max(24),
});

export const ConnectedAppExecutionSchema = z.strictObject({
  toolkit: z.string().min(1).max(128),
  toolSlug: z.string().min(1).max(256),
  durationMs: z.number().int().nonnegative(),
  logId: z.string(),
  error: z.string().nullable(),
  data: z.strictObject({
    value: z.unknown(),
    originalBytes: z.number().int().nonnegative(),
    retainedBytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    truncated: z.boolean(),
  }),
});

export type ConnectedAppsState = z.infer<typeof ConnectedAppsStateSchema>;
export type ConnectedAppConnection = z.infer<typeof ConnectedAppConnectionSchema>;
export type ConnectedAppTool = z.infer<typeof ConnectedAppToolSchema>;
export type ConnectedAppToolSearch = z.infer<typeof ConnectedAppToolSearchSchema>;
export type ConnectedAppExecution = z.infer<typeof ConnectedAppExecutionSchema>;

export function connectedAppIsActive(connection: ConnectedAppConnection | null): boolean {
  return connection?.status.toLocaleUpperCase() === "ACTIVE";
}
