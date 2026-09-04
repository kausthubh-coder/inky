import { z } from "zod";

import type { AgentJobPhase, AgentTarget } from "./contracts.js";

export const CapabilityNameSchema = z.enum([
  "home",
  "queue",
  "notes-search",
  "notes-read",
  "assignment",
  "browser",
  "assignment-effects",
  "scan",
  "scan-record",
  "files",
  "shell",
  "composio",
  "submit",
]);

export type CapabilityName = z.infer<typeof CapabilityNameSchema>;

export interface CapabilityContext {
  readonly target: AgentTarget;
  readonly phase: AgentJobPhase;
  readonly hasBrowserClaim: boolean;
  readonly filesAvailable?: boolean;
  readonly shellAvailable?: boolean;
  readonly composioTools?: readonly string[];
  readonly submissionAuthorized?: boolean;
}

const toolsByCapability = Object.freeze({
  home: ["home_status"],
  queue: ["queue_inspect", "queue_start", "queue_cancel"],
  "notes-search": ["note_search"],
  "notes-read": ["note_read"],
  assignment: ["assignment_read"],
  browser: [
    "browser_snapshot",
    "browser_navigate",
    "browser_click",
    "browser_type",
    "browser_select",
    "browser_press",
    "browser_wait",
  ],
  "assignment-effects": [
    "assignment_record_answer_snapshot",
    "assignment_record_recovery",
    "assignment_request_takeover",
    "assignment_mark_unsupported",
    "assignment_start_review",
    "note_upsert",
  ],
  scan: ["scan_status"],
  "scan-record": ["scan_record_course", "scan_record_assignment", "scan_record_coverage", "scan_request_handoff"],
  files: ["file_list", "file_read", "file_write"],
  shell: ["shell_run"],
  composio: [],
  submit: ["browser_submit"],
} satisfies Record<CapabilityName, readonly string[]>);

export function selectCapabilities(context: CapabilityContext): readonly CapabilityName[] {
  if (context.target.kind === "tutor") return [];
  if (context.target.kind === "home") return ["home", "queue", "notes-search", ...((context.composioTools?.length ?? 0) > 0 ? ["composio" as const] : [])];

  if (context.target.kind === "scan") {
    return context.phase === "working" && context.hasBrowserClaim
      ? ["scan", "browser", "scan-record"]
      : ["scan"];
  }

  const selected: CapabilityName[] = ["assignment", "notes-search", "notes-read"];
  if ((context.composioTools?.length ?? 0) > 0) selected.push("composio");
  if (context.phase !== "working" || !context.hasBrowserClaim) return selected;

  selected.push("browser", "assignment-effects");
  if (context.filesAvailable) selected.push("files");
  if (context.shellAvailable) selected.push("shell");
  if (context.submissionAuthorized) selected.push("submit");
  return selected;
}

export function toolNamesForCapabilities(
  capabilities: readonly CapabilityName[],
  composioTools: readonly string[] = [],
): readonly string[] {
  const names = capabilities.flatMap((capability) =>
    capability === "composio" ? composioTools : toolsByCapability[capability],
  );
  if (new Set(names).size !== names.length) {
    throw new Error("Capability selection produced duplicate tool names");
  }
  return Object.freeze([...names]);
}

export function inferCapabilityPacks(toolNames: readonly string[]): readonly CapabilityName[] {
  const selected = new Set<CapabilityName>();
  for (const toolName of toolNames) {
    const normalized = toolName.toLocaleLowerCase();
    for (const [capability, names] of Object.entries(toolsByCapability) as Array<[CapabilityName, readonly string[]]>) {
      if (names.includes(toolName)) selected.add(capability);
    }
    if (normalized.startsWith("manager_") || normalized.startsWith("queue_")) selected.add("queue");
    if (normalized.startsWith("browser_")) selected.add("browser");
    if (normalized.startsWith("assignment_")) selected.add("assignment-effects");
    if (normalized.startsWith("scan_record_") || normalized === "scan_request_handoff") selected.add("scan-record");
    if (normalized.startsWith("note_search")) selected.add("notes-search");
    if (normalized.startsWith("note_read")) selected.add("notes-read");
    if (normalized.startsWith("file_")) selected.add("files");
    if (normalized.startsWith("shell_")) selected.add("shell");
    if (normalized.startsWith("composio_") || normalized.startsWith("composio:") || normalized.startsWith("connected_apps_")) selected.add("composio");
    if (normalized === "browser_submit") selected.add("submit");
  }
  return [...selected].sort();
}
