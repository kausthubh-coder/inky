import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openLocalStore } from "../../dist/electron/storage/index.js";
import { resolvePermission } from "../../dist/shared/permission.js";

const now = "2026-09-12T12:00:00.000Z";
const context = { assignmentId: "homework", courseId: "class", matchedPatternIds: ["weekly"] };
const rule = (ruleId, target, mode = "attempt", updatedAt = now) => ({ schemaVersion: 1, ruleId, ...target, mode, updatedAt });
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "studi-permission-rules-"));
  const store = await openLocalStore(root);
  try { await run(store, root); }
  finally { store.close(); await rm(root, { recursive: true, force: true }); }
}

// Reproduce records written by older builds without going through the fixed save.
function legacyInsert(store, value) {
  store.database.handle.prepare(`INSERT INTO permission_rules
    (rule_id, scope, course_id, assignment_id, pattern_id, updated_at, record_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(value.ruleId, value.scope, value.courseId ?? null, value.assignmentId ?? null,
      value.patternId ?? null, value.updatedAt, JSON.stringify(value));
}

test("saving the same target replaces its permission across every scope and survives reopening", async () => {
  await fixture(async (store, root) => {
    const targets = [{ scope: "global" }, { scope: "course", courseId: "class" },
      { scope: "assignment", assignmentId: "homework" },
      { scope: "pattern", courseId: "class", patternId: "weekly" },
      { scope: "pattern", courseId: "other-class", patternId: "weekly" },
      { scope: "pattern", courseId: "class", patternId: "other-group" }];
    targets.forEach((target, i) => {
      store.permissionRules.put(rule(`old-${i}`, target, "auto_submit"));
      store.permissionRules.put(rule(`new-${i}`, target, "do_not_attempt"));
    });
    assert.equal(store.permissionRules.listAll().length, targets.length);
    assert.equal(store.database.handle.prepare("SELECT count(*) AS n FROM permission_rules").get().n, targets.length);
    assert.equal(resolvePermission(context, store.permissionRules.listAll()).mayAttempt, false);
    const reopened = await openLocalStore(root);
    try {
      assert.deepEqual(reopened.permissionRules.listAll(), store.permissionRules.listAll());
      assert.ok(reopened.permissionRules.listAll().every(item => item.mode === "do_not_attempt"));
    } finally { reopened.close(); }
  });
});

test("legacy duplicates display the existing winner; deleting it cannot resurrect an older permission", async () => {
  await fixture(async store => {
    const values = [rule("old-allow", { scope: "global" }, "auto_submit", "2026-09-11T12:00:00.000Z"),
      rule("z-tied-allow", { scope: "global" }, "auto_submit"),
      rule("a-current-deny", { scope: "global" }, "do_not_attempt")];
    values.forEach(value => legacyInsert(store, value));
    assert.deepEqual(store.permissionRules.listAll(), [values[2]]);
    assert.deepEqual(store.permissionRules.listByScope("global"), [values[2]]);
    assert.deepEqual(resolvePermission(context, store.permissionRules.listAll()), resolvePermission(context, values));
    assert.equal(store.permissionRules.delete("a-current-deny"), true);
    assert.deepEqual(store.permissionRules.listAll(), []);
    assert.equal(store.database.handle.prepare("SELECT count(*) AS n FROM permission_rules").get().n, 0);
    assert.equal(resolvePermission(context, store.permissionRules.listAll()).maySubmit, false);
  });
});

test("replacement clears legacy duplicates atomically and a failed save preserves the current rule", async () => {
  await fixture(async store => {
    const target = { scope: "course", courseId: "class" };
    legacyInsert(store, rule("old", target, "auto_submit", "2026-09-11T12:00:00.000Z"));
    legacyInsert(store, rule("current", target, "do_not_attempt"));
    store.database.handle.exec("CREATE TRIGGER fail_rule_save BEFORE INSERT ON permission_rules BEGIN SELECT RAISE(ABORT, 'save failure'); END");
    assert.throws(() => store.permissionRules.put(rule("replacement", target)), /save failure/);
    assert.equal(store.permissionRules.listAll()[0].mode, "do_not_attempt");
    assert.equal(store.database.handle.prepare("SELECT count(*) AS n FROM permission_rules").get().n, 2);
    store.database.handle.exec("DROP TRIGGER fail_rule_save");
    store.permissionRules.put(rule("replacement", target));
    assert.deepEqual(store.permissionRules.listAll(), [rule("replacement", target)]);
    assert.equal(store.database.handle.prepare("SELECT count(*) AS n FROM permission_rules").get().n, 1);
  });
});

test("specific exceptions retain precedence after a broader rule is updated", async () => {
  await fixture(async store => {
    store.permissionRules.put(rule("all", { scope: "global" }));
    store.permissionRules.put(rule("class-deny", { scope: "course", courseId: "class" }, "do_not_attempt"));
    store.permissionRules.put(rule("all-new", { scope: "global" }, "auto_submit"));
    assert.equal(resolvePermission(context, store.permissionRules.listAll()).mode, "do_not_attempt");
    store.permissionRules.put(rule("assignment", { scope: "assignment", assignmentId: "homework" }));
    assert.equal(resolvePermission(context, store.permissionRules.listAll()).mode, "attempt");
    store.permissionRules.delete("assignment");
    assert.equal(resolvePermission(context, store.permissionRules.listAll()).mode, "do_not_attempt");
  });
});
