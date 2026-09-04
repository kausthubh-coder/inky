import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { AgentHostSnapshotSchema, type AgentHostSnapshot, type AgentJobStore } from "../desktop/agent-system/index.js";

export class FileAgentJobStore implements AgentJobStore {
  readonly #path: string;

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

  async save(snapshot: AgentHostSnapshot): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const temporaryPath = `${this.#path}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.#path);
  }
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

