import type { AgentRunEvent } from "../../shared/index.js";

const labels: Record<string, string> = {
  browser_navigate: "Opened the school page",
  browser_snapshot: "Read the page",
  browser_click: "Clicked a control on the page",
  browser_type: "Typed on the school page",
  browser_fill: "Filled in an answer",
  browser_scroll: "Looked further down the page",
  browser_screenshot: "Saved a picture of the page",
  browser_upload: "Attached the assignment files",
  connected_apps_search: "Looked through your connected apps",
  connected_apps_execute: "Used a connected app",
  read: "Read a file",
  write: "Wrote a file",
  edit: "Updated a file",
  bash: "Ran a command",
  assignment_record_answer_snapshot: "Saved a copy of your answers",
  assignment_start_review: "Checked the requirements and stopped for you",
  assignment_request_takeover: "Asked for your help",
};
export type ActivityLine = {
  key: string;
  text: string;
  kind: "action" | "voice" | "retry";
};
export function assignmentActivity(
  events: readonly AgentRunEvent[],
): ActivityLine[] {
  const lines: ActivityLine[] = [];
  for (const [index, event] of events.entries()) {
    if (event.type === "text") {
      const previous = lines.at(-1);
      if (previous?.kind === "voice") previous.text += event.delta;
      else lines.push({ key: String(index), text: event.delta, kind: "voice" });
    } else if (event.type === "retry" && event.phase === "started") {
      lines.push({
        key: String(index),
        text: `Trying again, ${event.attempt} of ${event.maxAttempts}. ${event.reason}`,
        kind: "retry",
      });
    } else if (
      event.type === "tool_started" ||
      event.type === "tool_finished"
    ) {
      const result = event.type === "tool_finished" ? event.result : null;
      const resultLabel =
        result &&
        typeof result === "object" &&
        "label" in result &&
        typeof result.label === "string"
          ? result.label
          : null;
      const text =
        resultLabel ?? labels[event.toolName] ?? "Worked on the assignment";
      const old = lines.find((line) => line.key === event.toolCallId);
      const line: ActivityLine = {
        key: event.toolCallId,
        text:
          event.type === "tool_finished" && event.outcome === "failed"
            ? `${text} — couldn't finish this action.`
            : text,
        kind:
          event.type === "tool_finished" && event.outcome === "failed"
            ? "retry"
            : "action",
      };
      if (old) Object.assign(old, line);
      else lines.push(line);
    }
  }
  return lines;
}
