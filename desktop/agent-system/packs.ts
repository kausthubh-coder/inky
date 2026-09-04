import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { CapabilityName } from "./capability-registry.js";

export type AgentRole = "home" | "assignment" | "scan" | "tutor";

export interface LoadedPack {
  readonly id: string;
  readonly text: string;
  readonly hash: string;
}

export interface BuiltInstructions {
  readonly text: string;
  readonly packs: readonly LoadedPack[];
  readonly hash: string;
}

function assertPackId(id: string): void {
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(id)) {
    throw new TypeError(`Invalid agent pack id: ${id}`);
  }
}

export async function loadPack(id: string): Promise<LoadedPack> {
  assertPackId(id);
  const text = (await readFile(new URL(`./packs/${id}/instructions.md`, import.meta.url), "utf8")).trim();
  if (!text) throw new Error(`Agent pack ${id} is empty`);
  return Object.freeze({ id, text, hash: createHash("sha256").update(text).digest("hex") });
}

export async function buildInstructions(
  role: AgentRole,
  capabilities: readonly CapabilityName[],
): Promise<BuiltInstructions> {
  const ids = ["core/inky", `roles/${role}`, ...[...new Set(capabilities)].sort().map((name) => `capabilities/${name}`)];
  const packs = await Promise.all(ids.map(loadPack));
  const text = packs.map((pack) => `# Pack: ${pack.id}\n\n${pack.text}`).join("\n\n");
  const hash = createHash("sha256")
    .update(packs.map((pack) => `${pack.id}:${pack.hash}`).join("\n"))
    .digest("hex");
  return Object.freeze({ text, packs: Object.freeze(packs), hash });
}

