import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { AgentHostSnapshot, AgentTraceEvent } from "../desktop/agent-system/index.js";

const execFileAsync = promisify(execFile);

export interface HarnessRunRecord {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly suite: string;
  readonly driver: string;
  readonly gitSha: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly outcome: "passed" | "failed";
  readonly state: AgentHostSnapshot;
  readonly events: readonly AgentTraceEvent[];
  readonly assertions: readonly Readonly<{ name: string; passed: boolean; detail: string }>[];
}

export async function currentGitSha(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd, windowsHide: true });
  return stdout.trim();
}

export async function writeRunRecord(root: string, record: HarnessRunRecord): Promise<string> {
  const directory = join(root, record.runId);
  await mkdir(directory, { recursive: true });
  const path = join(directory, "run.json");
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return path;
}

