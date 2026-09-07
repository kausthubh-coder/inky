import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { parseEnv, parseArgs } from "node:util";

export function testEmail(value) {
  const email = value.trim().toLowerCase();
  if (!/^studi\.[a-z0-9._-]+\+clerk_test@example\.com$/.test(email)) {
    throw new Error("Use a dedicated studi.*+clerk_test@example.com QA identity");
  }
  return email;
}

export async function lookup(api, email) {
  const users = await api(`/users?${new URLSearchParams({ "email_address[]": email, limit: "100" })}`);
  if (!Array.isArray(users)) throw new Error("Unexpected Clerk user response");
  const matching = users.filter(user => user.email_addresses?.some(item => item.email_address.toLowerCase() === email));
  if (matching.length > 1) throw new Error("Ambiguous test identity");
  const entries = [];
  const invitations = [];
  for (const [path, target] of [["waitlist_entries", entries], ["invitations", invitations]]) {
    for (let offset = 0; ; offset += 100) {
      if (offset >= 10000) throw new Error("Clerk pagination limit exceeded; lookup is incomplete");
      const page = await api(`/${path}?${new URLSearchParams({ limit: "100", offset: String(offset), ...(path === "waitlist_entries" ? { query: email } : {}) })}`);
      const rows = Array.isArray(page) ? page : page.data;
      if (!Array.isArray(rows)) throw new Error("Unexpected Clerk list response");
      target.push(...rows.filter(row => row.email_address?.toLowerCase() === email));
      if (rows.length < 100 || (page.total_count !== undefined && offset + rows.length >= page.total_count)) break;
    }
  }
  return { email, user: matching[0] ?? null, entries, invitations };
}

export function summarize(state) {
  return {
    email: state.email,
    userId: state.user?.id ?? null,
    blocked: Boolean(state.user?.banned || state.user?.locked || state.entries.some(entry => entry.status === "rejected" || entry.invitation?.revoked || entry.invitation?.status === "revoked")),
    waitlist: state.entries.map(entry => ({ id: entry.id, status: entry.status, invitationStatus: entry.invitation?.status ?? null })),
    invitations: state.invitations.map(invite => ({ id: invite.id, status: invite.status })),
    // This is diagnostic evidence, not a replacement for live Convex approval.
    linkedInvitation: state.entries.some(entry => ["pending", "accepted"].includes(entry.invitation?.status)),
  };
}

export async function prepare(api, state, createUser = false) {
  if (summarize(state).blocked) throw new Error("QA identity is locked, banned, or rejected; do not override admission");
  let entry = state.entries[0];
  if (!entry) entry = await api("/waitlist_entries", { email_address: state.email, notify: false });
  if (!entry.invitation || ["expired"].includes(entry.invitation.status)) {
    if (entry.invitation?.revoked || entry.invitation?.status === "revoked") throw new Error("Invitation is revoked; do not override it");
    // This endpoint links the invitation to the waitlist, unlike /invitations.
    entry = await api(`/waitlist_entries/${encodeURIComponent(entry.id)}/invite`, { ignore_existing: Boolean(state.user || entry.invitation) });
  }
  if (!["pending", "accepted"].includes(entry.invitation?.status)) {
    throw new Error("Clerk returned no usable linked invitation. Diagnose admission; do not grant temporary Convex access");
  }
  if (createUser && !state.user) {
    await api("/users", { email_address: [state.email], first_name: "Studi", last_name: "QA", skip_password_requirement: true });
  }
  return lookup(api, state.email);
}

export function invitationUrl(state, expectedHost) {
  const invite = state.entries.map(entry => entry.invitation).find(invite => invite?.status === "pending" && invite?.url)
    ?? state.invitations.find(invite => invite.status === "pending" && invite.url);
  if (!invite) throw new Error("No pending invitation; run lookup to check accepted/expired status");
  const url = new URL(invite.url);
  if (url.protocol !== "https:" || url.hostname !== expectedHost || url.port || url.username || url.password) throw new Error("Unexpected invitation host");
  return url.href;
}

async function main() {
  const { values } = parseArgs({ options: {
    email: { type: "string" }, prepare: { type: "boolean" }, "create-user": { type: "boolean" },
    "serve-invite": { type: "boolean" }, "dry-run": { type: "boolean" },
  } });
  const email = testEmail(values.email ?? "");
  if (values["create-user"] && !values.prepare) throw new Error("--create-user requires --prepare");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const env = {};
  // A linked worktree can read the main checkout's configured DEV key without
  // copying its personal profiles or committing credentials into the worktree.
  const common = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8", windowsHide: true });
  const mainRoot = common.status === 0 ? dirname(common.stdout.trim()) : root;
  for (const directory of [...new Set([mainRoot, root])]) {
    for (const file of [".env.local", "landing/.env.local"]) {
      try { Object.assign(env, parseEnv(await readFile(resolve(directory, file), "utf8"))); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  const key = process.env.CLERK_SECRET_KEY ?? env.CLERK_SECRET_KEY;
  if (!key?.startsWith("sk_test_")) throw new Error("A Clerk DEVELOPMENT secret key is required; never print it");
  const config = await readFile(resolve(root, "desktop/electron/auth/config.ts"), "utf8");
  const host = config.match(/clerkIssuer:\s*"https:\/\/([a-z0-9.-]+\.clerk\.accounts\.dev)"/)?.[1];
  if (!host) throw new Error("Checkout must target Clerk development");
  const api = async (path, body) => {
    // CLI gets credentials only through its environment; capture raw responses
    // because they can contain invitation tickets. Output only summaries below.
    const args = ["--mode", "agent", "api", path];
    if (body) args.push("--method", "POST", "--data", JSON.stringify(body), "--yes");
    const options = { cwd: root, env: { ...process.env, CLERK_SECRET_KEY: key }, encoding: "utf8", windowsHide: true, timeout: 30000 };
    let result = spawnSync("clerk", args, options);
    if (result.error?.code === "ENOENT") {
      // Bun's native executable also works on Windows without a .cmd shell.
      result = spawnSync("bun", ["x", "clerk@3.3.0", ...args], { ...options, timeout: 120000 });
    }
    if (result.error || result.status !== 0) throw new Error(`Clerk ${body ? "write" : "lookup"} failed for ${path.split("?")[0]}; check CLI auth/config (raw output withheld)`);
    try { return JSON.parse(result.stdout); } catch { throw new Error("Clerk returned non-JSON output (withheld)"); }
  };
  const domains = await api("/domains");
  if (!(domains.data ?? domains).some(domain => domain.name === host || domain.frontend_api_url === `https://${host}`)) {
    throw new Error("Clerk key does not match the checkout's issuer");
  }
  let state = await lookup(api, email);
  console.log(JSON.stringify({ phase: "before", ...summarize(state) }));
  if (values.prepare && !values["dry-run"]) {
    state = await prepare(api, state, values["create-user"]);
    console.log(JSON.stringify({ phase: "after", ...summarize(state) }));
  }
  if (values["serve-invite"] && !values["dry-run"]) {
    let url = invitationUrl(state, host);
    const server = createServer((request, response) => {
      response.setHeader("Cache-Control", "no-store");
      if (request.method !== "GET" || request.url !== "/invite" || !url) { response.writeHead(404).end(); return; }
      response.writeHead(302, { location: url }).end();
      url = null;
      server.close();
    });
    server.listen(0, "127.0.0.1", () => console.log(JSON.stringify({ invitationClaimUrl: `http://127.0.0.1:${server.address().port}/invite`, expiresInSeconds: 300 })));
    const timer = setTimeout(() => server.close(), 300000);
    timer.unref();
    server.on("close", () => clearTimeout(timer));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
