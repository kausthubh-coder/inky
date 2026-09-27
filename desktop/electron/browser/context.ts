import type { AgentMessage } from "@earendil-works/pi-agent-core";

const EARLIER_SNAPSHOT = "[Earlier browser snapshot omitted. Take a new browser_snapshot if you need this page again.]";
const EARLIER_IMAGE = "[Earlier image omitted. Take a new screenshot if you need to see it again.]";
const LARGE = 2_500;
const NOTE = 800;
/** Recent results stay whole until they add up to this much text, then the older ones are shortened in one go. */
const OPEN_BUDGET = 60_000;
/** The results the model is acting on right now always stay whole. */
const KEEP_OPEN = 2;

type Result = AgentMessage & { role: "toolResult"; toolCallId: string; toolName?: string };

/**
 * Limits what the model re-reads on every call without breaking the provider's prompt cache. Older page snapshots
 * are dropped, older large results (documents, class reads, email) shrink to their opening lines and older images
 * go, but only in batches: between batches every earlier message is sent exactly as before, so the cache holds.
 * Each session needs its own compactor. The transcript itself is never changed.
 */
export function createBrowserContextCompactor(options: { budget?: number } = {}): (messages: AgentMessage[]) => AgentMessage[] {
  const budget = options.budget ?? OPEN_BUDGET;
  const settled = new Map<string, "whole" | "short">();
  let pinned: string | undefined;
  const size = (message: AgentMessage) => ((message as { content?: unknown }).content as { text?: string }[] | undefined ?? [])
    .reduce((total, part) => total + (typeof part.text === "string" ? part.text.length : 0), 0);
  const isSnapshot = (message: Result) => message.toolName === "browser_snapshot";
  // Change-only re-reads need their base: the latest full read of the page stays until a newer one exists.
  const isChangeOnly = (message: Result) => JSON.stringify(message.content ?? "").includes("Only what changed since your last read");
  return messages => {
    const results = messages.filter((message): message is Result => message.role === "toolResult");
    const open = results.filter(message => !settled.has(message.toolCallId));
    if (open.reduce((total, message) => total + size(message), 0) > budget) {
      const latestFull = [...results].reverse().find(message => isSnapshot(message) && !isChangeOnly(message))?.toolCallId;
      if (pinned && pinned !== latestFull) settled.set(pinned, "short");
      pinned = latestFull;
      for (const message of open.slice(0, -KEEP_OPEN)) {
        settled.set(message.toolCallId, message.toolCallId === latestFull || (!isSnapshot(message) && !message.content.some(part => part.type === "image") && size(message) <= LARGE) ? "whole" : "short");
      }
    }
    return messages.map(message => {
      if (message.role !== "toolResult" || settled.get(message.toolCallId) !== "short") return message;
      if (isSnapshot(message as Result)) return { ...message, content: [{ type: "text", text: EARLIER_SNAPSHOT }] };
      return { ...message, content: message.content.map(part => {
        if (part.type === "image") return { type: "text" as const, text: EARLIER_IMAGE };
        if (part.type === "text" && part.text.length > LARGE) return { ...part, text: `${part.text.slice(0, NOTE)}\n[Earlier result shortened. Run the tool again if you need the rest.]` };
        return part;
      }) };
    });
  };
}
