import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Unsafe, type TSchema } from "typebox";

import { connectedAppIsActive, type ConnectedAppConnection, type ConnectedAppExecution, type ConnectedAppTool } from "../../shared/index.js";

export interface ConnectedAppGateway {
  connectedApps(): Promise<{ readonly configured: boolean; readonly toolkits: readonly { readonly toolkit: string }[] }>;
  connectedAppConnection(toolkit: string): Promise<ConnectedAppConnection>;
  connectedAppTools(toolkit: string): Promise<readonly ConnectedAppTool[]>;
  executeConnectedAppTool(toolkit: string, toolSlug: string, arguments_: Record<string, unknown>): Promise<ConnectedAppExecution>;
}

export interface ConnectedAppToolObservation {
  readonly toolkit: string;
  readonly tool: string;
  readonly status: "succeeded" | "failed";
  readonly durationMs: number;
  readonly originalBytes?: number;
  readonly retainedBytes?: number;
  readonly truncated?: boolean;
  readonly logId?: string;
  readonly error?: string;
}

export interface ConnectedAppToolOptions {
  readonly observeExecution?: (observation: ConnectedAppToolObservation) => void;
}

export async function createConnectedAppTools(
  gateway: ConnectedAppGateway,
  options: ConnectedAppToolOptions = {},
): Promise<readonly ToolDefinition[]> {
  const state = await gateway.connectedApps();
  if (!state.configured) return [];
  const connections = await Promise.all(state.toolkits.map(async ({ toolkit }) => ({
    toolkit,
    connection: await gateway.connectedAppConnection(toolkit),
  })));
  const activeToolkits = connections.filter(({ connection }) => connectedAppIsActive(connection));
  const definitions = (await Promise.all(activeToolkits.map(({ toolkit }) => gateway.connectedAppTools(toolkit)))).flat();
  const names = new Set<string>();
  return definitions.map((definition) => {
    const name = `composio_${definition.slug.toLocaleLowerCase()}`;
    if (names.has(name)) throw new Error(`Connected apps repeated the tool ${name}`);
    names.add(name);
    return defineTool({
      name,
      label: `${definition.toolkit}: ${definition.name}`,
      description: `${definition.description ?? definition.name} Runs through Studi's server for the student's connected ${definition.toolkit} account.`,
      parameters: Unsafe<Record<string, unknown>>(definition.inputParameters as TSchema),
      execute: async (_toolCallId, input) => {
        if (!input || typeof input !== "object" || Array.isArray(input)) {
          throw new Error(`${name} requires an argument object`);
        }
        const startedAt = Date.now();
        let result: ConnectedAppExecution;
        try {
          result = await gateway.executeConnectedAppTool(
            definition.toolkit,
            definition.slug,
            input as Record<string, unknown>,
          );
        } catch (error) {
          options.observeExecution?.({
            toolkit: definition.toolkit,
            tool: definition.slug,
            status: "failed",
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
        options.observeExecution?.({
          toolkit: result.toolkit,
          tool: result.toolSlug,
          status: result.error ? "failed" : "succeeded",
          durationMs: result.durationMs,
          originalBytes: result.data.originalBytes,
          retainedBytes: result.data.retainedBytes,
          truncated: result.data.truncated,
          ...(result.logId ? { logId: result.logId } : {}),
          ...(result.error ? { error: result.error } : {}),
        });
        if (result.error) throw new Error(result.error);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result.data.value, null, 2) }],
          details: result,
        };
      },
    });
  });
}
