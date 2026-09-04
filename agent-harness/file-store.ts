import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { AgentHostSnapshotSchema, type AgentHostSnapshot, type AgentJobStore } from "../desktop/agent-system/index.js";

export class FileAgentJobStore implements AgentJobStore {
  readonly #path: string;
  #saveTail: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  async load(): Promise<AgentHostSnapshot | null> {
    try {
      return AgentHostSnapshotSchema.parse(JSON.parse(await readFile(this.#path, "utf8")));
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  save(snapshot: AgentHostSnapshot): Promise<void> {
    const pending = this.#saveTail.then(() => this.#save(snapshot));
    this.#saveTail = pending.catch(() => undefined);
    return pending;
  }

  async #save(snapshot: AgentHostSnapshot): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const temporaryPath = `${this.#path}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await renameWithWindowsRetry(temporaryPath, this.#path);
  }
}

async function renameWithWindowsRetry(source: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (!isRetryableWindowsLock(error) || attempt >= 9) throw error;
      await delay(20 * (attempt + 1));
    }
  }
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isRetryableWindowsLock(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && ["EACCES", "EBUSY", "EPERM"].includes(String(error.code)));
}
