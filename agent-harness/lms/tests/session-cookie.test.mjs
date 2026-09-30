import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startLms } from "../../../.studi-lms/build/server.mjs";

test("in session-cookie mode a browser that lost its session cookie is signed out", async (t) => {
  const school = await startLms({ scenarioId: "quiz", sessionCookies: true, runDirectory: join(await mkdtemp(join(tmpdir(), "studi-cookie-")), "run") });
  t.after(() => school.close());
  const first = await fetch(`${school.url}/`, { redirect: "manual" });
  assert.equal(first.status, 200);
  const cookie = first.headers.get("set-cookie")?.split(";")[0];
  assert.match(cookie ?? "", /^cedar_session_school=/, "the first signed-in page hands out a session cookie with no expiry");
  assert.doesNotMatch(first.headers.get("set-cookie") ?? "", /Expires|Max-Age/i);
  assert.equal((await fetch(`${school.url}/`, { redirect: "manual", headers: { cookie } })).status, 200, "keeping the cookie keeps you signed in");
  assert.equal((await fetch(`${school.url}/`, { redirect: "manual" })).headers.get("location"), "/login", "losing it signs you out");
});
