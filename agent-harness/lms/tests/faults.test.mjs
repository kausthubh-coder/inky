import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startLms } from "../../../.studi-lms/build/server.mjs";
import { parseFaults } from "../../benchmark/faults.mjs";

test("scheduled faults sign the student out after N requests and slow matching pages", async (t) => {
  const school = await startLms({ scenarioId: "quiz", runDirectory: join(await mkdtemp(join(tmpdir(), "studi-faults-")), "run"),
    faults: parseFaults(["expire-session@after:1", "slow:^/courses$=300"]) });
  t.after(() => school.close());
  assert.equal((await fetch(`${school.url}/`, { redirect: "manual" })).status, 200);
  assert.equal((await fetch(`${school.url}/`, { redirect: "manual" })).headers.get("location"), "/login");
  const started = performance.now();
  await fetch(`${school.url}/courses`, { redirect: "manual" });
  assert.ok(performance.now() - started >= 280);
});

test("fault flags that don't parse are refused", () => {
  assert.throws(() => parseFaults(["sign-out soon"]), /Unknown fault/);
  assert.deepEqual(parseFaults(["expire-session:statistics@minute:2"]), [{ event: "expire-session", service: "statistics", atMinute: 2 }]);
});
