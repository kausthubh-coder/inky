import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Unsafe } from "typebox";

import { connectedAppIsActive, type ConnectedAppConnection, type ConnectedAppExecution, type ConnectedAppToolSearch } from "../../shared/index.js";

export interface ConnectedAppGateway {
  connectedApps(): Promise<{ readonly configured: boolean; readonly toolkits: readonly { readonly toolkit: string }[] }>;
  connectedAppConnection(toolkit: string): Promise<ConnectedAppConnection>;
  searchConnectedAppTools(toolkit: string, query: string): Promise<ConnectedAppToolSearch>;
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
  const activeToolkits = connections
    .filter(({ connection }) => connectedAppIsActive(connection))
    .map(({ toolkit }) => toolkit);
  if (activeToolkits.length === 0) return [];

  const toolkitSchema = { type: "string", enum: activeToolkits } as const;
  const toolkitList = activeToolkits.join(", ");

  const search = defineTool({
    name: "connected_apps_search",
    label: "Find a connected-app action",
    description: `Find the exact action and input schema needed to work in a student's connected app. Available apps: ${toolkitList}. Search before executing an unfamiliar action. Read, create, edit, send, upload, organize, and other provider-supported actions are available.`,
    parameters: Unsafe<{ toolkit: string; query: string }>({
      type: "object",
      properties: {
        toolkit: toolkitSchema,
        query: { type: "string", minLength: 1, maxLength: 500, description: "Describe the concrete action to perform." },
      },
      required: ["toolkit", "query"],
      additionalProperties: false,
    }),
    execute: async (_toolCallId, input) => {
      const result = await gateway.searchConnectedAppTools(input.toolkit, input.query);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });

  const execute = defineTool({
    name: "connected_apps_execute",
    label: "Run a connected-app action",
    description: "Run an action returned by connected_apps_search in the student's connected account. Use the exact tool slug and argument schema from search. Destructive actions still require clear intent from the student's request.",
    parameters: Unsafe<{ toolkit: string; toolSlug: string; arguments: Record<string, unknown> }>({
      type: "object",
      properties: {
        toolkit: toolkitSchema,
        toolSlug: { type: "string", pattern: "^[A-Z0-9_]+$", description: "Exact action slug returned by connected_apps_search." },
        arguments: { type: "object", additionalProperties: true },
      },
      required: ["toolkit", "toolSlug", "arguments"],
      additionalProperties: false,
    }),
    execute: async (_toolCallId, input) => executeConnectedAppAction(gateway, options, input),
  });

  return [search, execute];
}

async function executeConnectedAppAction(
  gateway: ConnectedAppGateway,
  options: ConnectedAppToolOptions,
  input: { toolkit: string; toolSlug: string; arguments: Record<string, unknown> },
) {
  const startedAt = Date.now();
  let result: ConnectedAppExecution;
  try {
    result = await gateway.executeConnectedAppTool(input.toolkit, input.toolSlug, input.arguments);
  } catch (error) {
    options.observeExecution?.({
      toolkit: input.toolkit,
      tool: input.toolSlug,
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
}
