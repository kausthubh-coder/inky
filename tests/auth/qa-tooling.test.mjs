import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { testEmail, lookup, prepare, summarize, invitationUrl } from "../../.agents/skills/test-studi/scripts/qa-account.mjs";
import { schoolFixture } from "../../.agents/skills/test-studi/scripts/school-fixture.mjs";

test("QA account lookup rejects personal identities and filters fuzzy paginated matches", async () => {
  assert.throws(() => testEmail("someone@gmail.com"));
  const email = testEmail("studi.qa.fixture+clerk_test@example.com");
  const state = await lookup(async path => {
    if (path.startsWith("/users")) return [];
    if (path.startsWith("/waitlist")) return { data: [{ email_address: "wrong@example.com" }], total_count: 1 };
    if (path.includes("offset=0")) return Array.from({ length: 100 }, () => ({ email_address: "wrong@example.com" }));
    return [{ email_address: email, id: "accepted", status: "accepted", url: "secret" }];
  }, email);
  assert.equal(state.entries.length, 0);
  assert.equal(state.invitations[0].id, "accepted");
  assert.equal(JSON.stringify(summarize(state)).includes("secret"), false);
  assert.equal(summarize(state).linkedInvitation, false);
});

test("account setup links an invitation before optionally creating a missing user", async () => {
  const email = "studi.qa.fixture+clerk_test@example.com";
  const calls = [];
  await prepare(async (path, body) => {
    if (!body) return path.startsWith("/users") ? [] : { data: [], total_count: 0 };
    calls.push({ path, body });
    if (path === "/waitlist_entries") return { id: "wle_fixture" };
    if (path.endsWith("/invite")) return { invitation: { status: "pending" } };
    return { id: "user_fixture" };
  }, { email, user: null, entries: [], invitations: [] }, true);
  assert.deepEqual(calls.map(call => call.path), ["/waitlist_entries", "/waitlist_entries/wle_fixture/invite", "/users"]);
  assert.equal(calls[0].body.notify, false);
});

test("existing users are preserved and a missing invitation link stays a failure", async () => {
  const state = { email: "studi.qa.fixture+clerk_test@example.com", user: { id: "existing" }, entries: [{ id: "wle", status: "completed", invitation: null }], invitations: [{ status: "accepted" }] };
  const writes = [];
  await assert.rejects(prepare(async (path, body) => { writes.push(path); return { status: "completed", invitation: null }; }, state, true), /no usable linked invitation/);
  assert.deepEqual(writes, ["/waitlist_entries/wle/invite"]);
  await assert.rejects(prepare(() => { throw new Error("should not call"); }, { ...state, user: { banned: true } }), /locked, banned, or rejected/);
  assert.throws(() => invitationUrl({ entries: [], invitations: [{ status: "pending", url: "https://attacker.example/ticket" }] }, "qa.clerk.accounts.dev"), /Unexpected/);
});

test("local school fixture saves drafts, escapes answers, and isolates simultaneous schools", async () => {
  const a = await schoolFixture(), b = await schoolFixture();
  try {
    assert.notEqual(a.url, b.url);
    const html = await (await fetch(`${a.url}/assignments/observation`)).text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)[1];
    const response = await fetch(`${a.url}/assignments/observation`, { method: "POST", body: new URLSearchParams({ csrf, revision: "0", answer: "<script>unsafe</script>", action: "save" }) });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /&lt;script&gt;/);
    assert.equal(a.inspect().state.drafts.observation.answer, "<script>unsafe</script>");
    assert.equal(a.inspect().state.submissions.length, 0);
    assert.equal(b.inspect().state.drafts.observation, undefined);
    assert.equal((await fetch(`${a.url}/health`)).status, 404);
  } finally { await Promise.all([a.close(), b.close()]); }
});

test("auth import preserves refreshed profile credentials instead of overwriting with stale cache", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studi-qa-auth-test-"));
  const profile = join(directory, "profile");
  const destination = join(profile, "studi-data", "pi", "auth.json");
  await mkdir(join(profile, "studi-data", "pi"), { recursive: true });
  const fixture = JSON.stringify({ "openai-codex": { type: "oauth", access: "synthetic-access", refresh: "synthetic-refresh", expires: 1 } });
  await writeFile(destination, fixture);
  const result = spawnSync(process.execPath, [resolve(".agents/skills/test-studi/scripts/sync-studi-qa-codex-auth.mjs"), "--import", "--profile", profile, "--cache", join(directory, "missing")], { encoding: "utf8", env: { ...process.env, STUDI_QA_CODEX_AUTH: "invalid-cache" } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).preserved, true);
  assert.equal(await readFile(destination, "utf8"), fixture);
});

test("Windows dry-run with reset preserves the existing profile and chooses distinct ports", { skip: process.platform !== "win32" || !existsSync("dist/electron/main.js") }, async () => {
  const name = `qa-dry-run-${process.pid}`;
  const directory = resolve(".agents/studi-qa", name);
  await mkdir(directory, { recursive: true });
  const sentinel = join(directory, "sentinel.txt");
  await writeFile(sentinel, "must survive");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve(".agents/skills/test-studi/scripts/Start-StudiQa.ps1"), "-Persistent", "-ProfileName", name, "-ResetPersistent", "-DryRun"], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
  assert.equal(receipt.profileReset, false);
  assert.equal(receipt.resetRequested, true);
  assert.equal(receipt.processId, null);
  assert.equal(new Set([receipt.cdpEndpoint, receipt.mainInspectorEndpoint, receipt.clerkClaimUrl.replace('/claim', '')]).size, 3);
  assert.equal(await readFile(sentinel, "utf8"), "must survive");
});

test("Clerk handoff is one-shot per attempt, supports retries, and rejects non-loopback callbacks", async () => {
  const child = spawn(process.execPath, [resolve(".agents/skills/test-studi/scripts/clerk-qa-handoff.mjs"), "--port", "0", "--clerk-host", "qa.clerk.accounts.dev"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  try {
    const receipt = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("Relay did not start")), 5000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.stdout.on("data", chunk => { output += chunk; if (output.includes("\n")) { clearTimeout(timer); resolve(JSON.parse(output.split("\n")[0])); } });
    });
    const claim = receipt.claimUrl;
    const publish = claim.replace('/claim', '/publish');
    const authorize = new URL('https://qa.clerk.accounts.dev/oauth/authorize');
    authorize.search = new URLSearchParams({ redirect_uri: 'http://127.0.0.1:45678/callback', code_challenge_method: 'S256', state: 'synthetic-state', nonce: 'synthetic-nonce', code_challenge: 'synthetic-challenge' });
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.equal((await fetch(publish, { method: 'POST', body: authorize.href })).status, 202);
      assert.equal((await fetch(claim, { redirect: 'manual' })).status, 302);
      assert.equal((await fetch(claim, { redirect: 'manual' })).status, 425);
    }
    authorize.searchParams.set('redirect_uri', 'https://external.example/callback');
    assert.equal((await fetch(publish, { method: 'POST', body: authorize.href })).status, 400);
  } finally { child.kill(); }
});

test('disposable launcher refuses reusable or mismatched profiles and permits the same journey restart', { skip: process.platform !== 'win32' || !existsSync('dist/client/index.html') }, async () => {
  const name = `qa-lease-${process.pid}`;
  const directory = resolve('.agents/studi-qa', name);
  const leaseDirectory = await mkdtemp(join(tmpdir(), 'studi-qa-lease-'));
  const leasePath = join(leaseDirectory, 'lease.json');
  const id = '12345678-1234-1234-1234-123456789abc';
  const lease = { id, email: `studi.ephemeral.${id}+clerk_test@example.com` };
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'sentinel'), 'preserve');
  await writeFile(leasePath, JSON.stringify(lease));
  const run = () => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('.agents/skills/test-studi/scripts/Start-StudiQa.ps1'), '-Persistent', '-ProfileName', name, '-DryRun'], {
    encoding: 'utf8', windowsHide: true,
    env: { ...process.env, STUDI_QA_TEST_EMAIL: lease.email, STUDI_QA_ACCOUNT_LEASE: leasePath },
  });
  assert.notEqual(run().status, 0);
  await writeFile(join(directory, 'qa-account-lease.json'), JSON.stringify({ ...lease, id: 'wrong' }));
  assert.notEqual(run().status, 0);
  await writeFile(join(directory, 'qa-account-lease.json'), JSON.stringify(lease));
  const resumed = run();
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(JSON.parse(resumed.stdout.replace(/^\uFEFF/, '')).testEmail, lease.email);
  await writeFile(leasePath, JSON.stringify({ ...lease, cleanedAt: new Date().toISOString() }));
  assert.notEqual(run().status, 0);
  assert.equal(await readFile(join(directory, 'sentinel'), 'utf8'), 'preserve');
});
