/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";
import { admissionDecision } from "./clerkAdmission.js";

const modules = import.meta.glob("./**/*.ts");
const subject = "user_admitted_test";
const email = "admitted@example.com";
const deviceId = "00000000-0000-4000-8000-000000000001";
const user = {
  id: subject, banned: false, locked: false, primary_email_address_id: "email_test",
  email_addresses: [{ id: "email_test", email_address: email, verification: { status: "verified" } }],
};
const entry = { email_address: email, status: "completed" as const, invitation: { status: "accepted" as const } };

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

function mockClerk(waitlist = [entry] as Parameters<typeof admissionDecision>[1]) {
  vi.stubEnv("CLERK_SECRET_KEY", "test-only-key");
  const fetch = vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname === `/v1/users/${subject}`) return Response.json(user);
    if (url.pathname === "/v1/waitlist_entries") return Response.json({ data: waitlist, total_count: waitlist.length });
    throw new Error(`Unexpected Clerk endpoint: ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("Clerk admission policy", () => {
  it("accepts completed and still-pending valid invitations for a verified email", () => {
    expect(admissionDecision(user, [entry])).toBe("approved");
    expect(admissionDecision(user, [{ ...entry, status: "invited", invitation: { status: "pending" } }])).toBe("approved");
  });
  it("does not grant access merely because the Clerk user exists", () => {
    expect(admissionDecision(user, [])).toBe("waitlist");
    expect(admissionDecision(user, [{ ...entry, status: "pending", invitation: null }])).toBe("waitlist");
  });
  it("rejects fuzzy matches, unverified email, and expired invitations", () => {
    expect(admissionDecision(user, [{ ...entry, email_address: "not-" + email }])).toBe("waitlist");
    expect(admissionDecision({ ...user, email_addresses: [{ ...user.email_addresses[0]!, verification: null }] }, [entry])).toBe("waitlist");
    expect(admissionDecision(user, [{ ...entry, invitation: { status: "expired" } }])).toBe("waitlist");
  });
  it("honors bans, locks, waitlist rejection, and invitation revocation", () => {
    expect(admissionDecision({ ...user, banned: true }, [entry])).toBe("revoked");
    expect(admissionDecision({ ...user, locked: true }, [entry])).toBe("revoked");
    expect(admissionDecision(user, [{ ...entry, status: "rejected" }])).toBe("revoked");
    expect(admissionDecision(user, [{ ...entry, invitation: { status: "revoked" } }])).toBe("revoked");
  });
});

describe("installed app access contract", () => {
  it("reconciles accepted admission, grants access on retry, and keeps one-device protection", async () => {
    vi.useFakeTimers();
    mockClerk();
    const t = convexTest(schema, modules);
    const signedIn = t.withIdentity({ subject, email });
    expect(await signedIn.mutation(api.account.bootstrap, { deviceId })).toMatchObject({ approved: false, reason: "waitlist" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await signedIn.mutation(api.account.bootstrap, { deviceId })).toMatchObject({ approved: true, plan: "beta", credits: 0 });
    expect(await signedIn.mutation(api.account.bootstrap, { deviceId: "00000000-0000-4000-8000-000000000002" })).toMatchObject({ approved: false, reason: "device_conflict" });
    expect(await signedIn.query(api.account.portalOverview, {})).toMatchObject({ access: "approved", plan: "beta" });
  });
  it("keeps pending users denied after reconciliation", async () => {
    vi.useFakeTimers();
    mockClerk([{ ...entry, status: "pending", invitation: null }]);
    const t = convexTest(schema, modules);
    const signedIn = t.withIdentity({ subject, email });
    await signedIn.mutation(api.account.bootstrap, { deviceId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await signedIn.mutation(api.account.bootstrap, { deviceId })).toMatchObject({ approved: false, reason: "waitlist" });
  });
  it("never approves an unauthenticated request", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.account.bootstrap, { deviceId })).rejects.toThrow("Unauthenticated");
    await expect(t.mutation(api.account.setBetaAccess, { subject, approved: true, plan: "beta", credits: 0 })).rejects.toThrow("Unauthenticated");
  });
  it("preserves explicit manual revocation and paid entitlements", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("accounts", { clerkSubject: subject, email, name: null, createdAt: 1, lastSeenAt: 1, accessSyncRequestedAt: 10 });
      await ctx.db.insert("betaAccess", { clerkSubject: subject, approved: false, reason: "revoked", updatedBy: "admin", updatedAt: 1 });
      await ctx.db.insert("entitlements", { clerkSubject: subject, plan: "supporter", credits: 42, updatedAt: 1 });
    });
    await t.mutation(internal.accessSync.apply, { subject, requestedAt: 10, decision: "approved" });
    expect(await t.query(internal.accessSync.status, { subject })).toEqual({ approved: false, reason: "revoked", plan: "supporter" });
  });
  it("ignores stale results and revokes device access without deleting account data", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("accounts", { clerkSubject: subject, email, name: null, createdAt: 1, lastSeenAt: 1, accessSyncRequestedAt: 20 });
      await ctx.db.insert("betaAccess", { clerkSubject: subject, approved: true, reason: "approved", updatedBy: "clerk", updatedAt: 1 });
      await ctx.db.insert("activeDevices", { clerkSubject: subject, deviceId, registeredAt: 1, lastSeenAt: 1 });
    });
    await t.mutation(internal.accessSync.apply, { subject, requestedAt: 10, decision: "revoked" });
    expect((await t.query(internal.accessSync.status, { subject })).approved).toBe(true);
    await t.mutation(internal.accessSync.apply, { subject, requestedAt: 20, decision: "revoked" });
    expect((await t.query(internal.accessSync.status, { subject })).approved).toBe(false);
    expect(await t.run(async (ctx) => ({ accounts: (await ctx.db.query("accounts").take(2)).length, devices: (await ctx.db.query("activeDevices").take(2)).length }))).toEqual({ accounts: 1, devices: 0 });
  });
  it("leaves approval unchanged on Clerk outages rather than manufacturing a rejection", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "test-only-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Unavailable", { status: 503 })));
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("accounts", { clerkSubject: subject, email, name: null, createdAt: 1, lastSeenAt: 1, accessSyncRequestedAt: 10 });
      await ctx.db.insert("betaAccess", { clerkSubject: subject, approved: true, reason: "approved", updatedBy: "clerk", updatedAt: 1 });
    });
    await expect(t.action(internal.clerkAccess.reconcile, { subject, requestedAt: 10 })).rejects.toThrow("lookup failed (503)");
    expect((await t.query(internal.accessSync.status, { subject })).approved).toBe(true);
  });
});
