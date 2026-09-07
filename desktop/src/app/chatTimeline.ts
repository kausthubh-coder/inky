import type { AgentMessage } from "../../shared/index.js";

export interface ChatCardEntry {
  kind: "assignment" | "review" | "scan_handoff";
  key: string;
  createdAt: string;
}

export function chatTimeline(messages: readonly AgentMessage[], cards: readonly ChatCardEntry[]) {
  const entries = [
    ...messages.map((message, index) => ({
      kind: "message" as const,
      key: message.messageId,
      createdAt: message.createdAt,
      message,
      index,
    })),
    ...cards,
  ];
  return entries.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}
