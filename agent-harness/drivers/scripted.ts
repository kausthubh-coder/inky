import type { AgentDriver, AgentDriverResult, BuiltAgentTurn } from "../../desktop/agent-system/index.js";

export class ScriptedAgentDriver implements AgentDriver {
  readonly id = "scripted";

  async run(turn: BuiltAgentTurn, signal: AbortSignal): Promise<AgentDriverResult> {
    if (signal.aborted) throw new Error("Scripted turn was aborted");
    const target = turn.target.kind === "assignment"
      ? `assignment ${turn.target.assignmentId}`
      : turn.target.kind === "scan"
        ? `scan ${turn.target.scanId}`
        : turn.target.kind;
    return {
      text: `Inky handled ${target} with ${turn.toolNames.length} attached tools.`,
      outcome: "completed",
      usage: {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        costUsd: null,
      },
      toolCalls: [],
    };
  }
}

