import type { AgentMessage } from "@earendil-works/pi-agent-core";

const EARLIER_SNAPSHOT = "[Earlier browser snapshot omitted. Take a new browser_snapshot if you need this page again.]";

/** Keep transcript evidence intact while limiting the model's repeated page context. */
export function compactBrowserSnapshotContext(messages: AgentMessage[]): AgentMessage[] {
  const snapshots = messages.flatMap((message, index) =>
    message.role === "toolResult" && message.toolName === "browser_snapshot" ? [index] : [],
  );
  const keep = new Set(snapshots.slice(-2));
  return messages.map((message, index) =>
    message.role === "toolResult" && message.toolName === "browser_snapshot" && !keep.has(index)
      ? { ...message, content: [{ type: "text", text: EARLIER_SNAPSHOT }] }
      : message,
  );
}
