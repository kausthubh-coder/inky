import assert from "node:assert/strict";
import test from "node:test";

import { dotState, iconBadge, iconTooltip } from "../../dist/shared/characters/states.js";

test("the icon puts needs-you first, then work to check, then what Dot is busy with", () => {
  assert.deepEqual(iconBadge(dotState({ phase: "needs_user" }), 2), { kind: "needs" });
  assert.deepEqual(iconBadge(dotState({ phase: "working" }), 2), { kind: "ready", count: 2 });
  assert.deepEqual(iconBadge(dotState({ phase: "working" }), 0), { kind: "working" });
  assert.deepEqual(iconBadge(dotState({ scan: "running" }), 0), { kind: "scanning" });
  assert.deepEqual(iconBadge(dotState({ phase: "submitted" }), 0), { kind: "none" });
  assert.equal(iconTooltip({ kind: "ready", count: 3 }), "Studi · 3 ready to check");
});
