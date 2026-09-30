import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { developmentClient, lookup, prepare } from './qa-account.mjs';

// A durable lease proves this tool reserved an absent, uniquely named identity.
// Legacy/reusable QA users cannot be selected by this cleanup mechanism.
export function validateLease(lease, host) {
  if (lease.schemaVersion !== 1 || !/^[a-f0-9-]{36}$/.test(lease.id) ||
      lease.email !== `studi.ephemeral.${lease.id}+clerk_test@example.com` ||
      lease.host !== host || !Number.isFinite(Date.parse(lease.createdAt))) throw new Error('Invalid disposable QA lease or Clerk issuer');
}

export async function cleanupAccount(api, lease, host, dryRun = false) {
  validateLease(lease, host);
  const state = await lookup(api, lease.email);
  if (state.user) {
    if (lease.cleanedAt) throw new Error('A cleaned lease cannot delete a recreated account');
    const emails = state.user.email_addresses ?? [];
    if (emails.length !== 1 || emails[0].email_address.toLowerCase() !== lease.email ||
        !Number.isFinite(state.user.created_at) || state.user.created_at < Date.parse(lease.createdAt) - 60000) throw new Error('Account no longer matches the disposable lease; refusing deletion');
  }
  const pendingInvites = new Set([
    ...state.invitations,
    ...state.entries.map(entry => entry.invitation).filter(Boolean),
  ].filter(invite => invite.status === 'pending').map(invite => invite.id));
  const actions = [
    ...[...pendingInvites].map(id => ({ path: `/invitations/${encodeURIComponent(id)}/revoke`, method: 'POST' })),
    ...(state.user ? [{ path: `/users/${encodeURIComponent(state.user.id)}`, method: 'DELETE' }] : []),
    ...state.entries.filter(entry => entry.status === 'pending').map(entry => ({ path: `/waitlist_entries/${encodeURIComponent(entry.id)}`, method: 'DELETE' })),
  ];
  if (!dryRun) {
    for (const action of actions) await api(action.path, undefined, action.method);
    const remaining = await lookup(api, lease.email);
    if (remaining.user || remaining.invitations.some(invite => invite.status === 'pending') || remaining.entries.some(entry => entry.invitation?.status === 'pending')) throw new Error('Cleanup incomplete; lease retained for retry');
  }
  return { email: lease.email, dryRun, actions, retainedHistory: state.entries.filter(entry => entry.status !== 'pending').length };
}

export async function withCleanup(run, cleanup) {
  try { return await run(); }
  finally { await cleanup(); }
}

export function splitCommand(raw) {
  const separator = raw.indexOf('--');
  if (separator !== -1) return { args: raw.slice(0, separator), command: raw.slice(separator + 1) };
  // `bun run qa:account -- node ...` consumes its leading separator.
  for (let index = 0; index < raw.length; index++) {
    if (raw[index] === '--cleanup') { index++; continue; }
    if (!raw[index].startsWith('-')) return { args: raw.slice(0, index), command: raw.slice(index) };
  }
  return { args: raw, command: [] };
}

async function main() {
  const { args, command } = splitCommand(process.argv.slice(2));
  const { values } = parseArgs({ args, options: {
    allocate: { type: 'boolean' }, cleanup: { type: 'string' }, 'create-user': { type: 'boolean' }, 'dry-run': { type: 'boolean' },
  } });
  if (Number(Boolean(values.allocate)) + Number(Boolean(values.cleanup)) + Number(command.length > 0) !== 1) throw new Error('Use --allocate, --cleanup <lease.json>, or -- <command> [args]. Default is UI signup; --create-user provisions a user.');
  if (values['dry-run'] && !values.cleanup) throw new Error('--dry-run requires --cleanup');
  if (values.cleanup && values['create-user']) throw new Error('Cleanup cannot create users');
  const { api, host, root } = await developmentClient();
  async function clean(path) {
    const lease = JSON.parse(await readFile(path, 'utf8'));
    const result = await cleanupAccount(api, lease, host, values['dry-run']);
    if (!values['dry-run']) await writeFile(path, JSON.stringify({ ...lease, cleanedAt: new Date().toISOString() }, null, 2));
    console.log(JSON.stringify({ cleanup: result, leasePath: path }));
  }
  if (values.cleanup) { await clean(resolve(values.cleanup)); return; }
  const id = randomUUID();
  const lease = { schemaVersion: 1, id, host, email: `studi.ephemeral.${id}+clerk_test@example.com`, createdAt: new Date().toISOString() };
  const state = await lookup(api, lease.email);
  if (state.user || state.entries.length || state.invitations.length) throw new Error('Disposable identity already exists; nothing changed');
  const directory = resolve(root, '.agents/studi-qa/accounts');
  await mkdir(directory, { recursive: true });
  const leasePath = resolve(directory, `${id}.json`);
  await writeFile(leasePath, JSON.stringify(lease, null, 2), { flag: 'wx' });
  // Print the non-secret recovery receipt BEFORE any network mutation.
  console.log(JSON.stringify({ email: lease.email, leasePath, lifecycle: 'ephemeral' }));
  const run = async () => {
    await prepare(api, state, values['create-user']);
    if (!command.length) return;
    const exitCode = await new Promise((accept, reject) => {
      const child = spawn(command[0], command.slice(1), { stdio: 'inherit', windowsHide: true,
        env: { ...process.env, STUDI_QA_TEST_EMAIL: lease.email, STUDI_QA_ACCOUNT_LEASE: leasePath } });
      child.once('error', reject);
      child.once('exit', (code) => accept(code ?? 1));
    });
    process.exitCode = exitCode;
  };
  if (values.allocate) {
    try { await run(); } catch (error) { await clean(leasePath); throw error; }
  } else await withCleanup(run, () => clean(leasePath));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
