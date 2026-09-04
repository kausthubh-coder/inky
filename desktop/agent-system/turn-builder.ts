import { createHash } from "node:crypto";

import {
  inferCapabilityPacks,
  selectCapabilities,
  toolNamesForCapabilities,
  type CapabilityContext,
} from "./capability-registry.js";
import type { AgentTarget } from "./contracts.js";
import { buildInstructions, type AgentRole, type BuiltInstructions } from "./packs.js";

export interface AgentBrief {
  readonly sections: readonly Readonly<{ title: string; content: string }>[];
}

export interface BuiltAgentTurn {
  readonly target: AgentTarget;
  readonly role: AgentRole;
  readonly system: BuiltInstructions;
  readonly prompt: string;
  readonly promptHash: string;
  readonly toolNames: readonly string[];
}

function roleForTarget(target: AgentTarget): AgentRole {
  if (target.kind === "home") return "home";
  if (target.kind === "scan") return "scan";
  if (target.kind === "tutor") return "tutor";
  return "assignment";
}

export async function buildAgentTurn(
  context: CapabilityContext,
  message: string,
  brief: AgentBrief = { sections: [] },
): Promise<BuiltAgentTurn> {
  const capabilities = selectCapabilities(context);
  const system = await buildInstructions(roleForTarget(context.target), capabilities);
  const toolNames = toolNamesForCapabilities(capabilities, context.composioTools);
  const prompt = buildPrompt(message, brief);
  return Object.freeze({
    target: context.target,
    role: roleForTarget(context.target),
    system,
    prompt,
    promptHash: createHash("sha256").update(prompt).digest("hex"),
    toolNames,
  });
}

export async function buildAgentTurnForTools(
  target: AgentTarget,
  toolNames: readonly string[],
  message: string,
  brief: AgentBrief = { sections: [] },
): Promise<BuiltAgentTurn> {
  const role = roleForTarget(target);
  const system = await buildInstructions(role, inferCapabilityPacks(toolNames));
  const prompt = buildPrompt(message, brief);
  return Object.freeze({
    target,
    role,
    system,
    prompt,
    promptHash: createHash("sha256").update(prompt).digest("hex"),
    toolNames: Object.freeze([...toolNames]),
  });
}

export async function buildRuntimeInstructions(
  role: AgentRole,
  toolNames: readonly string[],
): Promise<BuiltInstructions> {
  return buildInstructions(role, inferCapabilityPacks(toolNames));
}

function buildPrompt(message: string, brief: AgentBrief): string {
  return [
    ...brief.sections.map((section) => `# ${section.title}\n\n${section.content.trim()}`),
    `# Student message\n\n${message.trim()}`,
  ].join("\n\n");
}
