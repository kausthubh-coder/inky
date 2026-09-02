import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";
import { AuthUserSchema, EntitlementSchema, type AuthUser, type Entitlement } from "../../shared/index.js";

const MAX_OFFLINE_MS = 24 * 60 * 60_000;

const DeviceFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  deviceId: z.string().uuid(),
});

const OfflineCacheSchema = z.strictObject({
  user: AuthUserSchema,
  entitlement: EntitlementSchema,
  deviceId: z.string().uuid(),
  checkedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

const VaultPayloadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  refreshToken: z.string().min(1),
  offlineCache: OfflineCacheSchema.optional(),
});

const VaultFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  encrypted: z.string().min(1),
});

export interface OfflineApprovalCache {
  readonly user: AuthUser;
  readonly entitlement: Entitlement;
  readonly deviceId: string;
  readonly checkedAt: string;
  readonly expiresAt: string;
}

export interface AuthVaultPayload {
  readonly schemaVersion: 1;
  readonly refreshToken: string;
  readonly offlineCache?: OfflineApprovalCache;
}

export interface SafeStoragePort {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}

export class AuthVault {
  readonly #root: string;
  readonly #safeStorage: SafeStoragePort;
  #memoryPayload: AuthVaultPayload | null = null;

  constructor(root: string, safeStorage: SafeStoragePort) {
    this.#root = root;
    this.#safeStorage = safeStorage;
  }

  get secureStorageAvailable(): boolean {
    if (!this.#safeStorage.isEncryptionAvailable()) return false;
    return this.#safeStorage.getSelectedStorageBackend?.() !== "basic_text";
  }

  async deviceId(): Promise<string> {
    await mkdir(this.#root, { recursive: true });
    try {
      const parsed = DeviceFileSchema.parse(JSON.parse(await readFile(this.#devicePath, "utf8")));
      return parsed.deviceId;
    } catch {
      const deviceId = randomUUID();
      await writeJsonAtomic(this.#devicePath, { schemaVersion: 1, deviceId });
      return deviceId;
    }
  }

  async load(): Promise<AuthVaultPayload | null> {
    if (!this.secureStorageAvailable) return this.#memoryPayload;
    try {
      const file = VaultFileSchema.parse(JSON.parse(await readFile(this.#vaultPath, "utf8")));
      const cleartext = this.#safeStorage.decryptString(Buffer.from(file.encrypted, "base64"));
      return normalizePayload(VaultPayloadSchema.parse(JSON.parse(cleartext)));
    } catch {
      return null;
    }
  }

  async save(payload: AuthVaultPayload): Promise<void> {
    const validated = normalizePayload(VaultPayloadSchema.parse(payload));
    this.#memoryPayload = validated;
    if (!this.secureStorageAvailable) return;
    await mkdir(this.#root, { recursive: true });
    const encrypted = this.#safeStorage.encryptString(JSON.stringify(validated)).toString("base64");
    await writeJsonAtomic(this.#vaultPath, { schemaVersion: 1, encrypted });
  }

  async clearCredentials(): Promise<void> {
    this.#memoryPayload = null;
    await rm(this.#vaultPath, { force: true });
  }

  get #devicePath(): string {
    return join(this.#root, "device.json");
  }

  get #vaultPath(): string {
    return join(this.#root, "credentials.json");
  }
}

export function validOfflineCache(
  cache: OfflineApprovalCache | undefined,
  deviceId: string,
  now = Date.now(),
): OfflineApprovalCache | null {
  if (!cache || cache.deviceId !== deviceId) return null;
  const checkedAt = Date.parse(cache.checkedAt);
  const expiresAt = Date.parse(cache.expiresAt);
  if (!Number.isFinite(checkedAt) || !Number.isFinite(expiresAt)) return null;
  if (checkedAt > now || expiresAt <= now || expiresAt - checkedAt > MAX_OFFLINE_MS) return null;
  return cache;
}

export function createOfflineCache(
  user: AuthUser,
  entitlement: Entitlement,
  deviceId: string,
  checkedAt: number,
): OfflineApprovalCache {
  const boundedCheckedAt = Math.min(checkedAt, Date.now());
  return {
    user,
    entitlement,
    deviceId,
    checkedAt: new Date(boundedCheckedAt).toISOString(),
    expiresAt: new Date(boundedCheckedAt + MAX_OFFLINE_MS).toISOString(),
  };
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

function normalizePayload(value: z.infer<typeof VaultPayloadSchema>): AuthVaultPayload {
  return value.offlineCache
    ? { schemaVersion: 1, refreshToken: value.refreshToken, offlineCache: value.offlineCache }
    : { schemaVersion: 1, refreshToken: value.refreshToken };
}
