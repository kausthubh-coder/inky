import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  DEFAULT_AGENT_MODEL_ID,
  DEFAULT_AGENT_REASONING_EFFORT,
  ProductPreferencesSchema,
  STUDI_SCHEMA_VERSION,
  type ProductPreferences,
} from "../../shared/index.js";

const defaults: ProductPreferences = ProductPreferencesSchema.parse({
  schemaVersion: STUDI_SCHEMA_VERSION,
  reviewMinutes: 15,
  handoffMinutes: 30,
  memoryVisibility: "selected",
  agentModelId: DEFAULT_AGENT_MODEL_ID,
  agentReasoningEffort: DEFAULT_AGENT_REASONING_EFFORT,
  updatedAt: "1970-01-01T00:00:00.000Z",
});

export class ProductPreferencesStore {
  readonly path: string;

  constructor(path: string) {
    this.path = resolve(path);
  }

  async get(): Promise<ProductPreferences> {
    try {
      const stored = JSON.parse(await readFile(this.path, "utf8")) as Record<string, unknown>;
      return ProductPreferencesSchema.parse({ ...defaults, ...stored });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaults;
      throw error;
    }
  }

  async put(value: unknown): Promise<ProductPreferences> {
    const record = ProductPreferencesSchema.parse(value);
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(record, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporary, this.path);
    } catch (error) {
      try { await unlink(temporary); } catch { /* Best-effort cleanup retains the original record. */ }
      throw error;
    }
    return record;
  }
}

