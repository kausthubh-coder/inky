import { z } from "zod";

export const ConnectedAppToolkitSchema = z.strictObject({
  toolkit: z.string().min(1).max(128),
  version: z.string().regex(/^[0-9]{8}_[0-9]{2}$/),
  tools: z.array(z.string().min(1).max(256)).min(1),
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
export type ConnectedAppExecution = z.infer<typeof ConnectedAppExecutionSchema>;

export function connectedAppIsActive(connection: ConnectedAppConnection | null): boolean {
  return connection?.status.toLocaleUpperCase() === "ACTIVE";
}
