import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupAccount, validateLease, withCleanup, splitCommand } from '../../.agents/skills/test-studi/scripts/qa-ephemeral.mjs';

test('Bun and Node command separators preserve child arguments', () => {
  const command = ['node', '-e', 'process.exit(7)'];
  assert.deepEqual(splitCommand(['--', ...command]), { args: [], command });
  assert.deepEqual(splitCommand(command), { args: [], command });
  assert.deepEqual(splitCommand(['--create-user', '--', ...command]), { args: ['--create-user'], command });
  assert.deepEqual(splitCommand(['--cleanup', 'lease.json', '--dry-run']), { args: ['--cleanup', 'lease.json', '--dry-run'], command: [] });
});

const id = '12345678-1234-1234-1234-123456789abc';
const lease = { schemaVersion: 1, id, email: `studi.ephemeral.${id}+clerk_test@example.com`, host: 'qa.clerk.accounts.dev', createdAt: '2026-09-19T12:00:00Z' };
function fixture() {
  let user = { id: 'user_disposable', created_at: Date.parse(lease.createdAt), email_addresses: [{ email_address: lease.email }] };
  let invitation = { id: 'inv_disposable', email_address: lease.email, status: 'pending' };
  const writes = [];
  return {
    writes,
    get user() { return user; },
    api: async (path, body, method = 'GET') => {
      if (method !== 'GET') {
        writes.push([path, method]);
        if (path === '/users/user_disposable') user = null;
        if (path === '/invitations/inv_disposable/revoke') invitation.status = 'revoked';
        return {};
      }
      if (path.startsWith('/users?')) return user ? [user] : [];
      if (path.startsWith('/invitations?')) return [invitation];
      return { data: [] };
    },
  };
}

test('cleanup previews, deletes only its disposable identity, verifies absence, and can be retried', async () => {
  const fake = fixture();
  const preview = await cleanupAccount(fake.api, lease, lease.host, true);
  assert.equal(preview.actions.length, 2);
  assert.equal(fake.writes.length, 0);
  await cleanupAccount(fake.api, lease, lease.host);
  assert.deepEqual(fake.writes, [['/invitations/inv_disposable/revoke', 'POST'], ['/users/user_disposable', 'DELETE']]);
  await cleanupAccount(fake.api, lease, lease.host);
  assert.equal(fake.writes.length, 2);
});

test('cleanup refuses reusable, foreign-instance, older, or changed identities', async () => {
  assert.throws(() => validateLease({ ...lease, email: 'studi.qa.reusable+clerk_test@example.com' }, lease.host));
  assert.throws(() => validateLease(lease, 'other.clerk.accounts.dev'));
  const changed = fixture();
  changed.user.email_addresses.push({ email_address: 'person@example.com' });
  await assert.rejects(cleanupAccount(changed.api, lease, lease.host), /refusing deletion/);
  assert.equal(changed.writes.length, 0);
  const older = fixture();
  older.user.created_at = 0;
  await assert.rejects(cleanupAccount(older.api, lease, lease.host), /refusing deletion/);
  await assert.rejects(cleanupAccount(fixture().api, { ...lease, cleanedAt: lease.createdAt }, lease.host), /recreated account/);
});

test('failed verification stays a failure; cleanup runs after success and failure', async () => {
  const fake = fixture();
  await assert.rejects(cleanupAccount((path) => fake.api(path), lease, lease.host), /incomplete/);
  let cleanups = 0;
  assert.equal(await withCleanup(async () => 42, async () => { cleanups++; }), 42);
  await assert.rejects(withCleanup(async () => { throw new Error('journey failed'); }, async () => { cleanups++; }), /journey failed/);
  assert.equal(cleanups, 2);
  await assert.rejects(withCleanup(async () => 42, async () => { throw new Error('cleanup failed'); }), /cleanup failed/);
});
