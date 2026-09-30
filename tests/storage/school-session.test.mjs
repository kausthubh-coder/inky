import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SchoolSessionKeeper } from "../../dist/electron/browser/school-session.js";

const DAY = 86_400_000;
const crypto = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from([...Buffer.from(text)].map((byte) => byte ^ 0x5a)),
  decryptString: (data) => Buffer.from([...data].map((byte) => byte ^ 0x5a)).toString(),
};
function fakeSession(cookies = []) {
  const jar = [...cookies];
  return { jar, fetched: [], cookies: { get: async () => jar, set: async (cookie) => { jar.push({ ...cookie, session: true }); } }, async fetch(url) { this.fetched.push(url); } };
}

test("school session cookies survive a restart, encrypted, for 14 days, and go on sign-out", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-school-session-"));
  try {
    const file = join(root, "school-session.bin");
    let now = Date.parse("2026-09-28T12:00:00Z");
    const before = fakeSession([
      { name: "MoodleSession", value: "abc", domain: "moodle.school.edu", path: "/", secure: true, httpOnly: true, session: true },
      { name: "remember", value: "kept-by-chromium", domain: "moodle.school.edu", path: "/", secure: true, session: false, expirationDate: 2e9 },
    ]);
    await new SchoolSessionKeeper(before, file, crypto, { schoolRoot: () => null, now: () => now }).save();
    assert.doesNotMatch(await readFile(file, "utf8"), /MoodleSession/, "the file is encrypted");

    const after = fakeSession();
    assert.equal(await new SchoolSessionKeeper(after, file, crypto, { schoolRoot: () => null, now: () => now + DAY }).restore(), 1, "only the session cookie needed saving");
    assert.equal(after.jar[0].name, "MoodleSession");
    assert.equal(after.jar[0].url, "https://moodle.school.edu/");

    const late = fakeSession();
    assert.equal(await new SchoolSessionKeeper(late, file, crypto, { schoolRoot: () => null, now: () => now + 15 * DAY }).restore(), 0, "after 14 days the sign-in is dropped");

    const keeper = new SchoolSessionKeeper(fakeSession(), file, crypto, { schoolRoot: () => "https://moodle.school.edu/", now: () => now });
    await keeper.keepAlive();
    keeper.setAsleep(true);
    await keeper.keepAlive();
    await keeper.forget();
    assert.equal(existsSync(file), false, "signing out deletes the saved sign-in");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("nothing is saved in plain text when the OS can't encrypt", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-school-session-"));
  try {
    const file = join(root, "school-session.bin");
    const session = fakeSession([{ name: "s", value: "v", domain: "school.edu", path: "/", session: true }]);
    await new SchoolSessionKeeper(session, file, { ...crypto, isEncryptionAvailable: () => false }, { schoolRoot: () => null }).save();
    assert.equal(existsSync(file), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the keep-alive loads the school's root only while awake", async () => {
  const session = fakeSession();
  const keeper = new SchoolSessionKeeper(session, join(tmpdir(), "unused.bin"), crypto, { schoolRoot: () => "https://moodle.school.edu/" });
  await keeper.keepAlive();
  keeper.setAsleep(true);
  await keeper.keepAlive();
  assert.deepEqual(session.fetched, ["https://moodle.school.edu/"]);
});
