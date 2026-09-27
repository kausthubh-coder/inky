import type { AgentMessage } from "@earendil-works/pi-agent-core";

const EARLIER_SNAPSHOT = "[Earlier browser snapshot omitted. Take a new browser_snapshot if you need this page again.]";
const EARLIER_IMAGE = "[Earlier image omitted. Take a new screenshot if you need to see it again.]";
/** Large results beyond the most recent few keep their opening as a note; the facts are already saved in Studi. */
const KEEP_RECENT_LARGE = 3;
const LARGE = 2_500;
const NOTE = 800;

/**
 * Keep transcript evidence intact while limiting what the model re-reads on every call. Nothing stops the model
 * from re-running a tool; only the bulk of old results stops being re-sent: older page snapshots are dropped,
 * older large results (PDF pages, class reads, email) shrink to their opening lines, and older images go.
 */
export function compactBrowserSnapshotContext(messages: AgentMessage[]): AgentMessage[] {
  const results = messages.flatMap((message, index) => message.role === "toolResult" ? [index] : []);
  const snapshots = results.filter(index => (messages[index] as { toolName?: string }).toolName === "browser_snapshot");
  // Change-only re-reads need their base: the latest full read of the page always stays.
  const isChangeOnly = (index: number) => JSON.stringify((messages[index] as { content?: unknown }).content ?? "").includes("Only what changed since your last read");
  const latestFull = [...snapshots].reverse().find(index => !isChangeOnly(index));
  const keepSnapshots = new Set([...snapshots.slice(-2), ...(latestFull === undefined ? [] : [latestFull])]);
  const size = (message: AgentMessage) => ((message as { content?: unknown }).content as { text?: string }[] | undefined ?? [])
    .reduce((total, part) => total + (typeof part.text === "string" ? part.text.length : 0), 0);
  const keepLarge = new Set(results.filter(index => !snapshots.includes(index) && size(messages[index]!) > LARGE).slice(-KEEP_RECENT_LARGE));
  const keepImages = new Set(results.slice(-2));
  return messages.map((message, index) => {
    if (message.role !== "toolResult") return message;
    if (snapshots.includes(index)) return keepSnapshots.has(index) ? message : { ...message, content: [{ type: "text", text: EARLIER_SNAPSHOT }] };
    const content = message.content.map(part => {
      if (part.type === "image") return keepImages.has(index) ? part : { type: "text" as const, text: EARLIER_IMAGE };
      if (part.type === "text" && part.text.length > LARGE && !keepLarge.has(index)) {
        return { ...part, text: `${part.text.slice(0, NOTE)}\n[Earlier result shortened. Run the tool again if you need the rest.]` };
      }
      return part;
    });
    return { ...message, content };
  });
}
