import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProductPreferencesStore } from "../../dist/electron/storage/product-preferences.js";

test("product preferences default safely and survive a validated atomic save", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-product-preferences-"));
  const path = join(root, "product-preferences.json");
  try {
    const store = new ProductPreferencesStore(path);
    assert.deepEqual(await store.get(), {
      schemaVersion: 1,
      reviewMinutes: 15,
      handoffMinutes: 30,
      memoryVisibility: "selected",
      updatedAt: "1970-01-01T00:00:00.000Z",
    });

    const saved = {
      schemaVersion: 1,
      reviewMinutes: 25,
      handoffMinutes: 45,
      memoryVisibility: "all",
      updatedAt: "2026-09-01T12:00:00.000Z",
    };
    await store.put(saved);
    assert.deepEqual(await new ProductPreferencesStore(path).get(), saved);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), saved);

    await assert.rejects(
      store.put({ ...saved, reviewMinutes: 0 }),
      (error) => error?.name === "ZodError",
    );
    assert.deepEqual(await store.get(), saved);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
