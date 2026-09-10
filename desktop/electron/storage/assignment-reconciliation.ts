import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { AssignmentSchema, resolvePermission, type Assignment, type Task } from "../../shared/index.js";
import { schoolIdentity } from "../scan/source-identity.js";
import type { LocalStore } from "./store.js";

export interface AssignmentConflict {
  readonly assignmentIds: string[];
  readonly reason: string;
}

// Run before workers start, or inside a scan's synchronous commit. Never merge
// two independent work histories. Originals are retained in the redirect ledger.
export function reconcileAssignments(store: LocalStore): AssignmentConflict[] {
  const groups = new Map<string, Assignment[]>();
  for (const row of store.database.handle.prepare("SELECT record_json FROM assignments").all()) {
    // Leave corrupt rows to the normal repository validation/error surface.
    // A startup repair must never use a partially valid record as merge evidence.
    const parsed = AssignmentSchema.safeParse(JSON.parse(String(row.record_json)));
    if (!parsed.success) continue;
    const assignment = parsed.data;
    const identity = assignment.sourceIdentity ?? schoolIdentity(assignment.sourceTarget, "assignment");
    if (!identity) continue;
    const group = groups.get(identity) ?? [];
    group.push(assignment);
    groups.set(identity, group);
  }
  if (![...groups.values()].some(group => group.length > 1)) return [];
  const files = artifactText(store.artifacts.rootDirectory);
  return store.database.transaction(() => {
    const conflicts: AssignmentConflict[] = [];
    for (const [identity, group] of groups) {
      if (group.length < 2) continue;
      const tasks = store.tasks.listAll();
      const records = group.map(assignment => ({
        assignment,
        tasks: tasks.filter(task => task.assignmentId === assignment.assignmentId),
      }));
      const protectedRecords = records.filter(record => hasWork(store, record.assignment, record.tasks, files));
      const modes = new Set(group.map(assignment => resolvePermission({
        assignmentId: assignment.assignmentId,
        courseId: assignment.courseId,
        matchedPatternIds: store.manager.listConfirmedPatterns(assignment.assignmentId, assignment.courseId).map(match => match.patternId),
      }, store.permissionRules.listAll()).mode));
      const orphanedWork = protectedRecords.length === 1 && protectedRecords[0]!.tasks.length === 0 && records.some(record => record.tasks.length > 0);
      if (protectedRecords.length > 1 || modes.size > 1 || orphanedWork || records.some(record => record.tasks.length > 1)) {
        conflicts.push({ assignmentIds: group.map(item => item.assignmentId), reason: modes.size > 1
          ? "These copies have different homework permissions. Review them before merging."
          : "These copies have separate saved work or history. Review them before merging." });
        continue;
      }
      const keeper = protectedRecords[0] ?? records.sort((a, b) =>
        b.tasks.length - a.tasks.length || a.assignment.discoveredAt.localeCompare(b.assignment.discoveredAt) ||
        a.assignment.assignmentId.localeCompare(b.assignment.assignmentId))[0]!;
      let kept = keeper.assignment;
      for (const donor of records) {
        if (donor === keeper) continue;
        // Keep the chosen course/permissions, task, answers, jobs and files intact.
        // Only the unstarted duplicate's origin/queue history is archived.
        const id = donor.assignment.assignmentId;
        archive(store, "assignment", id, kept.assignmentId, donor.assignment);
        for (const task of donor.tasks) {
          const canonicalTask = keeper.tasks[0];
          if (!canonicalTask) throw new Error("Cannot retire a task without a retained task");
          const queue = store.database.handle.prepare("SELECT record_json FROM manager_queue WHERE task_id = ?").get(task.taskId);
          archive(store, "task", task.taskId, canonicalTask.taskId, {
            task, events: store.tasks.listEvents(task.taskId), queue: queue ?? null,
          });
          store.database.handle.prepare("DELETE FROM manager_queue WHERE task_id = ?").run(task.taskId);
          store.database.handle.prepare("DELETE FROM task_events WHERE task_id = ?").run(task.taskId);
          store.database.handle.prepare("DELETE FROM task_projections WHERE task_id = ?").run(task.taskId);
        }
        kept = {
          ...donor.assignment, ...kept, sourceIdentity: identity,
          discoveredAt: [kept.discoveredAt, donor.assignment.discoveredAt].sort()[0]!,
          evidence: [...new Map([...donor.assignment.evidence, ...kept.evidence].map(item => [item.evidenceId, item])).values()],
        };
        store.assignments.put(kept);
        store.database.handle.prepare("DELETE FROM assignments WHERE assignment_id = ?").run(id);
      }
    }
    return conflicts;
  });
}

function archive(store: LocalStore, kind: "assignment" | "task", id: string, canonicalId: string, original: unknown): void {
  store.database.handle.prepare("INSERT INTO record_redirects(kind, old_id, canonical_id, record_json) VALUES (?, ?, ?, ?)")
    .run(kind, id, canonicalId, JSON.stringify(original));
}

function hasWork(store: LocalStore, assignment: Assignment, tasks: Task[], files: string[]): boolean {
  if (tasks.some(task => !["discovered", "queued"].includes(task.state) ||
    store.tasks.listEvents(task.taskId).some(event => event.type !== "task_created" &&
      !(event.payload.from === "discovered" && event.payload.to === "queued")))) return true;
  const ids = [assignment.assignmentId, ...tasks.map(task => task.taskId)];
  if (files.some(text => ids.some(id => text.includes(id)))) return true;
  // Conservatively protect all other durable references, including explicit
  // permissions, pattern matches, notes, sessions, receipts and notifications.
  // Scans are historical observations; their old ids continue to resolve.
  const ignored = new Set(["assignments", "task_projections", "task_events", "manager_queue", "school_scans", "record_redirects"]);
  const tables = store.database.handle.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  for (const row of tables) {
    const table = String(row.name);
    if (ignored.has(table)) continue;
    if (!/^[a-z_]+$/.test(table)) throw new Error("Unexpected storage table name");
    const columns = store.database.handle.prepare("SELECT name FROM pragma_table_info(?)").all(table);
    if (!columns.some(column => column.name === "record_json")) continue;
    for (const record of store.database.handle.prepare(`SELECT record_json FROM ${table}`).all()) {
      if (ids.some(id => String(record.record_json).includes(JSON.stringify(id)))) return true;
    }
  }
  return false;
}

function artifactText(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Cannot reconcile assignments with linked artifact files");
    return entry.isDirectory() ? artifactText(path) : [readFileSync(path, "utf8")];
  });
}
