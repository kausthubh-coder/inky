import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Unsafe, type TSchema } from "typebox";

import type { ConnectedAppExecution, ConnectedAppTool } from "../../shared/index.js";

export interface ConnectedAppGateway {
  connectedApps(): Promise<{ readonly configured: boolean; readonly toolkits: readonly { readonly toolkit: string }[] }>;
  connectedAppTools(toolkit: string): Promise<readonly ConnectedAppTool[]>;
  executeConnectedAppTool(toolkit: string, toolSlug: string, arguments_: Record<string, unknown>): Promise<ConnectedAppExecution>;
}

export async function createConnectedAppTools(gateway: ConnectedAppGateway): Promise<readonly ToolDefinition[]> {
  const state = await gateway.connectedApps();
  if (!state.configured) return [];
  const definitions = (await Promise.all(
    state.toolkits.map(({ toolkit }) => gateway.connectedAppTools(toolkit)),
  )).flat();
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
        const result = await gateway.executeConnectedAppTool(
          definition.toolkit,
          definition.slug,
          input as Record<string, unknown>,
        );
        if (result.error) throw new Error(result.error);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result.data.value, null, 2) }],
          details: result,
        };
      },
    });
  });
}
