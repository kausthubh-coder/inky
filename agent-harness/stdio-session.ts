import { createInterface } from "node:readline";

import type { AgentJobHost } from "../desktop/agent-system/index.js";

export async function runStdioSession(host: AgentJobHost): Promise<void> {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let command: unknown;
    try {
      command = JSON.parse(line);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: false, command: "inspect", state: host.snapshot(), error: error instanceof Error ? error.message : "Invalid JSON" })}\n`);
      continue;
    }
    const reply = await host.execute(command);
    process.stdout.write(`${JSON.stringify(reply)}\n`);
    if (reply.quit) break;
  }
}

