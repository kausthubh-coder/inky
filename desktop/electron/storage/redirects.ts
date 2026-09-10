import type { StudiSqliteDatabase } from "./database.js";

export function resolveRecordId(database: StudiSqliteDatabase, kind: "assignment" | "task", id: string): string {
  const seen = new Set<string>();
  while (!seen.has(id)) {
    seen.add(id);
    const row = database.handle.prepare("SELECT canonical_id FROM record_redirects WHERE kind = ? AND old_id = ?")
      .get(kind, id) as { canonical_id: string } | undefined;
    if (!row) return id;
    id = row.canonical_id;
  }
  throw new Error("Cyclic record redirect");
}
