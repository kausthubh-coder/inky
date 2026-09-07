# Development accounts, invitations, and Electron login

Use isolated Playwright browser contexts for Clerk. Never use the user's system-browser cookies. Use the Clerk CLI for account lookup/management; the helper captures raw responses internally and prints safe summaries.

## Prepare a dedicated identity

For a fresh profile use `testEmail` from the launcher receipt. For an existing dedicated profile, reuse its observed identity. The historical fixture is `studi.wp12+clerk_test@example.com`; it is not guaranteed to exist or be approved. Concurrent worktrees must not share that subject.

The helper reads development keys from environment or configured local env files, including the primary checkout of this Git repository. It verifies the key's domain against the checkout's Clerk issuer, restricts email to `studi.*+clerk_test@example.com`, paginates lookups, and never prints the key.

```powershell
node .agents/skills/test-studi/scripts/qa-account.mjs --email <test-email> --dry-run
node .agents/skills/test-studi/scripts/qa-account.mjs --email <test-email> --prepare --create-user
```

The second command performs another lookup, creates a waitlist entry if missing, invites that entry, then creates a passwordless test user only if missing. It never deletes or recreates an existing user. The order matters: **invite before creating the user** preserves the linked invitation used by admission sync. Existing pending/accepted linked invitations are reused. Rejected or revoked admission is not overridden.

When specifically proving UI signup, omit `--create-user` and complete signup through the invitation page. Provisioning with the Backend API is legitimate QA setup, but is not proof the website signup UI works.

This request's authorization to create/reuse dedicated test accounts and accept their invitations covers those operations. Lookup first; do not ask again for each step. Creating waitlist entries suppresses notification; Clerk's waitlist invite endpoint may send its invitation to the dedicated reserved test email. Do not use it for other recipients.

## Accept an invitation

First read the helper's status. A linked invitation may already become accepted during account creation. Do not reopen accepted invitations just to generate a screenshot.

For a pending invitation:

```powershell
node .agents/skills/test-studi/scripts/qa-account.mjs --email <test-email> --serve-invite
```

Keep that terminal session alive. Open the returned `invitationClaimUrl` in a **new isolated browser context**, not an already signed-in tab. It redirects once to the invitation without logging or persisting the ticket; it expires after five minutes. Follow Clerk's sign-up or sign-in screen. A preexisting session can silently skip acceptance.

Prefer email-code verification. Clerk documents the test address suffix `+clerk_test` with code `424242`. Do not request a real inbox or password. If the website gets stuck on a waitlist-only signup screen, record that website failure; provision the missing dedicated test user with the helper when the task is desktop QA, then verify invitation status again. Do not call arbitrary frontend authentication internals to fabricate UI success.

Afterward rerun lookup. Require invitation status `accepted` for an acceptance test. Inspect whether the waitlist entry retains a linked invitation. A dashboard redirect alone proves neither.

## Sign into Electron

1. Read `window.studi.getAuthState()`. If the dedicated profile is already approved, continue without another login.
2. Activate the current greeting/sign-in control in Electron. In QA mode it publishes an OAuth authorize URL to the loopback relay, instead of opening the system browser.
3. Open the receipt's `clerkClaimUrl` in a fresh isolated Chromium context. If it returns 425, allow the publish to finish and retry once. The relay validates the development host, S256 PKCE, and a loopback callback.
4. Enter the exact test email and continue; use code `424242` when prompted. Before consent verify the displayed identity. Never consent for a different account.
5. Finish the callback and wait for Electron's public auth state. Check `status=approved`, expected email/subject when exposed, and secure storage. Do not hard-code a subject, balance, or device ID.
6. Restart the same profile and check approval again. Do not share the profile or its device ID with another running worktree.

## Diagnose the right boundary

- CLI authentication/configuration failure is not “user missing.” The helper withholds raw CLI output because it can contain tickets. Check CLI installation, development key availability, and issuer matching.
- Missing user: provision it after invitation, within the dedicated test scope.
- Pending invite: accept in a fresh context, then verify with Clerk.
- Accepted standalone invite + completed waitlist entry with no linked invitation: admission-sync mismatch. PR 21 encountered this on the historical fixture. Read the current deployed behavior; a historical note is not proof of today's state.
- Clerk approved/accepted but Electron waitlisted: use **Check again**, allow reconciliation, and compare live Convex state after restart. Do not write beta credits or temporarily make the test user an admin.
- Device conflict: identify the other QA run. Use that run's profile/receipt or a separate named identity; do not revoke another task's lease.

If an access-sync regression remains, report Clerk status, linked-invitation status, renderer reason, deployment, and reproduction. Continue independent tests; do not mark the full journey passed.

Official references: [test emails](https://clerk.com/docs/guides/development/testing/test-emails-and-phones), [waitlist creation](https://clerk.com/docs/reference/backend/waitlist-entries/create), [linked invitations](https://clerk.com/docs/reference/backend/waitlist-entries/invite), [application invitations](https://clerk.com/docs/guides/users/inviting).
