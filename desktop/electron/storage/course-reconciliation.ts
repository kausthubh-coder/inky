import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { resolvePermission, type Course } from "../../shared/index.js";
import { schoolIdentity } from "../scan/source-identity.js";
import type { LocalStore } from "./store.js";

export interface CourseConflict {
  readonly courseIds: string[];
  readonly reason: string;
}

export function courseObservations(course: Course): { label: string; sourceTarget: string }[] {
  return [...new Map([...(course.sourceAliases ?? []),
    { label: course.label, sourceTarget: course.sourceTarget },
    { label: course.label, sourceTarget: course.evidence.sourceTarget },
  ].map(observation => [JSON.stringify(observation), observation])).values()].slice(-100);
}

// A legacy directory URL is not a course identity. Its assignments can supply
// one only when their observed Moodle course/list URLs unanimously agree.
export function courseIdentity(store: LocalStore, course: Course): string | null {
  const targets = [course.sourceTarget, course.evidence.sourceTarget,
    ...store.assignments.listByCourse(course.courseId).flatMap(assignment =>
      [assignment.sourceTarget, ...assignment.evidence.map(evidence => evidence.sourceTarget)])];
  const identities = new Set(targets.map(target => schoolIdentity(target, "course")).filter(Boolean));
  if (course.sourceIdentity) identities.add(course.sourceIdentity);
  return identities.size === 1 ? [...identities][0]! : null;
}

export function reconcileCourses(store: LocalStore): CourseConflict[] {
  return store.database.transaction(() => {
    const groups = new Map<string, Course[]>();
    for (const course of store.school.listCourses()) {
      const identity = courseIdentity(store, course);
      if (!identity) continue;
      const verified = store.school.putCourse({ ...course, sourceIdentity: identity });
      groups.set(identity, [...(groups.get(identity) ?? []), verified]);
    }
    const conflicts: CourseConflict[] = [];
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const rules = store.permissionRules.listAll();
      const modes = new Set(group.map(course => {
        const resolution = resolvePermission({
          assignmentId: "course-reconciliation", courseId: course.courseId, matchedPatternIds: [],
        }, rules.filter(rule => rule.scope === "global" || rule.scope === "course"));
        return `${rules.find(rule => rule.ruleId === resolution.matchedRuleId)?.scope ?? "default"}|${resolution.mode}`;
      }));
      // Pattern rules must also agree for every possible future match, not just
      // the assignments currently present. Preserve different policies for review.
      const patterns = group.map(course => JSON.stringify(rules.filter(rule => rule.scope === "pattern" && rule.courseId === course.courseId)
        .map(rule => [rule.scope === "pattern" ? rule.patternId : "", rule.mode, rule.updatedAt]).sort()));
      const protectedCourses = group.filter(course => hasExternalReference(store, course.courseId));
      if (modes.size > 1 || new Set(patterns).size > 1 || protectedCourses.length > 1) {
        conflicts.push({ courseIds: group.map(course => course.courseId), reason: modes.size > 1 || new Set(patterns).size > 1
          ? "These class copies have different homework permissions. Review them before merging."
          : "These class copies have separate saved notes or references. Review them before merging." });
        continue;
      }
      const keeper = protectedCourses[0] ?? [...group].sort((a, b) =>
        store.assignments.listByCourse(b.courseId).length - store.assignments.listByCourse(a.courseId).length ||
        a.lastVerifiedAt.localeCompare(b.lastVerifiedAt) || a.courseId.localeCompare(b.courseId))[0]!;
      store.school.putCourse({ ...keeper, sourceAliases: [...new Map(group.flatMap(courseObservations)
        .map(observation => [JSON.stringify(observation), observation])).values()].slice(-100) });
      for (const donor of group) {
        if (donor.courseId === keeper.courseId) continue;
        store.database.handle.prepare("INSERT INTO record_redirects(kind, old_id, canonical_id, record_json) VALUES ('course', ?, ?, ?)")
          .run(donor.courseId, keeper.courseId, JSON.stringify(donor));
        // Change only current relational membership. Task events, answers, scans,
        // and the original course record remain intact and old IDs still resolve.
        for (const table of ["assignments", "permission_rules", "confirmed_pattern_matches", "manager_queue"]) {
          store.database.handle.prepare(`UPDATE ${table} SET course_id = ?, record_json = json_set(record_json, '$.courseId', ?) WHERE course_id = ?`)
            .run(keeper.courseId, keeper.courseId, donor.courseId);
        }
        store.database.handle.prepare("DELETE FROM courses WHERE course_id = ?").run(donor.courseId);
      }
    }
    return conflicts;
  });
}

function hasExternalReference(store: LocalStore, id: string): boolean {
  // Retain the ID used by durable notes/files rather than rewriting their bodies
  // or relocating homework folders. Two such roots require explicit review.
  const contains = (directory: string): boolean => existsSync(directory) && readdirSync(directory, { withFileTypes: true }).some(entry => {
    if (entry.isSymbolicLink()) return true;
    const path = join(directory, entry.name);
    return entry.isDirectory() ? contains(path) : readFileSync(path, "utf8").includes(id);
  });
  if (contains(store.artifacts.rootDirectory) || contains(store.notes.rootDirectory)) return true;
  const ignored = new Set(["courses", "assignments", "permission_rules", "confirmed_pattern_matches", "manager_queue", "school_scans", "record_redirects"]);
  for (const row of store.database.handle.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
    const table = String(row.name);
    if (ignored.has(table)) continue;
    if (!/^[a-z_]+$/.test(table)) throw new Error("Unexpected storage table name");
    if (!store.database.handle.prepare("SELECT name FROM pragma_table_info(?)").all(table).some(column => column.name === "record_json")) continue;
    if (store.database.handle.prepare(`SELECT record_json FROM ${table}`).all().some(record => String(record.record_json).includes(JSON.stringify(id)))) return true;
  }
  return false;
}
