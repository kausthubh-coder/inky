import type { AgentRunEvent, AssignmentCommandOutput } from "../../shared/index.js";

// Only assignment shell output belongs in the file panel. Browser snapshots,
// tool arguments and arbitrary result objects stay out of this stored view.
export function commandOutput(event: AgentRunEvent, recordedAt: string): AssignmentCommandOutput | undefined {
  if (event.type !== "tool_finished" || (event.toolName !== "bash" && event.toolName !== "powershell")) return undefined;
  let text = "";
  const result = event.result;
  if (typeof result === "string") text = result;
  else if (result && typeof result === "object" && "content" in result && Array.isArray(result.content)) {
    text = result.content.flatMap(item => item && typeof item === "object" && item.type === "text" && typeof item.text === "string" ? [item.text] : []).join("\n");
  }
  text = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  return { toolCallId: event.toolCallId, shell: event.toolName, outcome: event.outcome,
    text: text.slice(-20_000), truncated: text.length > 20_000, durationMs: event.durationMs, recordedAt };
}

/** A few words for the thread: the line that says how tests went, or the last line of output. */
export function commandSummary(text: string): string | undefined {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const verdict = [...lines].reverse().find(line => /\b\d+\s+(passed|failed|passing|failing|errors?)\b|\bok\b|\bFAIL(ED)?\b/i.test(line));
  const line = verdict ?? lines.at(-1);
  return line ? line.slice(0, 80) : undefined;
}
