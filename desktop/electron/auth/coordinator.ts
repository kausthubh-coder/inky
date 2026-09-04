import { randomUUID } from "node:crypto";

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";

import type { AuthState, AuthUser, ConnectedAppConnection, ConnectedAppExecution, ConnectedAppsState, ConnectedAppTool, FeedbackReceipt } from "../../shared/index.js";
import { CloudAccountClient, type CloudAccountResult } from "./cloud.js";
import { studiCloudConfig } from "./config.js";
import { openLoopbackCallback } from "./loopback.js";
import { createOAuthTransaction } from "./pkce.js";
import {
  AuthVault,
  createOfflineCache,
  validOfflineCache,
  type AuthVaultPayload,
  type OfflineApprovalCache,
} from "./vault.js";

const MetadataSchema = z.object({
  issuer: z.string().url(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  revocation_endpoint: z.string().url(),
  jwks_uri: z.string().url(),
});

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1),
  expires_in: z.number().positive(),
}).passthrough();

interface TokenSet {
  readonly refreshToken: string;
  readonly identityToken: string;
  readonly identityExpiresAt: number;
  readonly user: AuthUser;
}

interface AuthCoordinatorOptions {
  readonly vault: AuthVault;
  readonly openExternal: (url: string) => Promise<unknown>;
  readonly identityReset?: () => void;
  readonly fetch?: typeof fetch;
}

export class AuthCoordinator {
  readonly #vault: AuthVault;
  readonly #openExternal: (url: string) => Promise<unknown>;
  readonly #identityReset: () => void;
  readonly #fetch: typeof fetch;
  readonly #cloud: CloudAccountClient;
  #state: AuthState = { status: "checking" };
  #deviceId = "";
  #tokens: TokenSet | null = null;
  #stored: AuthVaultPayload | null = null;
  #metadata: z.infer<typeof MetadataSchema> | null = null;
  #jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  #activeSignIn: Promise<AuthState> | null = null;

  constructor(options: AuthCoordinatorOptions) {
    this.#vault = options.vault;
    this.#openExternal = options.openExternal;
    this.#identityReset = options.identityReset ?? (() => undefined);
    this.#fetch = options.fetch ?? fetch;
    this.#cloud = new CloudAccountClient(studiCloudConfig.convexUrl, () => this.#freshIdentityToken());
  }

  state(): AuthState {
    return this.#state;
  }

  async start(): Promise<AuthState> {
    this.#state = { status: "checking" };
    this.#deviceId = await this.#vault.deviceId();
    this.#stored = await this.#vault.load();
    if (!this.#stored) return this.#setState({ status: "signed_out" });
    try {
      await this.#refresh(this.#stored.refreshToken);
      return await this.#evaluateEntitlement();
    } catch (error) {
      return this.#recoverStartup(error);
    }
  }

  signIn(): Promise<AuthState> {
    if (this.#activeSignIn) return this.#activeSignIn;
    this.#activeSignIn = this.#performSignIn().finally(() => {
      this.#activeSignIn = null;
    });
    return this.#activeSignIn;
  }

  async retryEntitlement(): Promise<AuthState> {
    this.#state = { status: "checking" };
    try {
      if (!this.#tokens) {
        this.#stored ??= await this.#vault.load();
        if (!this.#stored) return this.#setState({ status: "signed_out" });
        await this.#refresh(this.#stored.refreshToken);
      }
      return await this.#evaluateEntitlement();
    } catch (error) {
      if (isCredentialRejection(error)) {
        await this.#eraseCredentials();
        return this.#setState({ status: "signed_out", message: "Your Studi sign-in expired. Sign in again." });
      }
      const offline = this.#offlineState();
      if (offline) return this.#setState(offline);
      return this.#setState({ status: "error", message: "Studi could not check beta access. Check your connection and retry.", recoverable: true });
    }
  }

  async signOut(): Promise<AuthState> {
    if (this.#tokens) {
      try {
        await this.#cloud.releaseDevice(this.#deviceId);
      } catch {
        // Offline sign-out still removes the local credential.
      }
    }
    const refreshToken = this.#tokens?.refreshToken ?? this.#stored?.refreshToken;
    if (refreshToken) {
      try {
        const metadata = await this.#getMetadata();
        await this.#fetch(metadata.revocation_endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: refreshToken, client_id: studiCloudConfig.clerkClientId }),
        });
      } catch {
        // Local sign-out still removes the credential when Clerk is unavailable.
      }
    }
    await this.#eraseCredentials();
    this.#identityReset();
    return this.#setState({ status: "signed_out" });
  }

  async submitFeedback(message: string): Promise<FeedbackReceipt> {
    if (!this.#tokens || this.#state.status === "offline") throw new Error("Feedback needs an online signed account");
    return this.#cloud.submitFeedback(this.#deviceId, randomUUID(), message);
  }

  async connectedApps(): Promise<ConnectedAppsState> {
    this.#requireOnlineApproval();
    return this.#cloud.connectedApps();
  }

  async authorizeConnectedApp(toolkit: string): Promise<ConnectedAppConnection> {
    this.#requireOnlineApproval();
    return this.#cloud.authorizeConnectedApp(toolkit);
  }

  async connectedAppConnection(toolkit: string): Promise<ConnectedAppConnection> {
    this.#requireOnlineApproval();
    return this.#cloud.connectedAppConnection(toolkit);
  }

  async connectedAppTools(toolkit: string): Promise<readonly ConnectedAppTool[]> {
    this.#requireOnlineApproval();
    const connection = await this.#cloud.connectedAppConnection(toolkit);
    if (connection.status.toLocaleUpperCase() !== "ACTIVE") return [];
    return this.#cloud.connectedAppTools(toolkit);
  }

  async executeConnectedAppTool(toolkit: string, toolSlug: string, arguments_: Record<string, unknown>): Promise<ConnectedAppExecution> {
    this.#requireOnlineApproval();
    return this.#cloud.executeConnectedAppTool(toolkit, toolSlug, arguments_);
  }

  #requireOnlineApproval(): void {
    if (!this.#tokens || this.#state.status !== "approved") {
      throw new Error("Connected apps need an online approved Studi account");
    }
  }

  async #performSignIn(): Promise<AuthState> {
    this.#state = { status: "signing_in" };
    const transaction = createOAuthTransaction();
    const callback = await openLoopbackCallback(transaction.state);
    try {
      const metadata = await this.#getMetadata();
      const authorizationUrl = new URL(metadata.authorization_endpoint);
      authorizationUrl.search = new URLSearchParams({
        response_type: "code",
        client_id: studiCloudConfig.clerkClientId,
        redirect_uri: callback.redirectUri,
        scope: studiCloudConfig.clerkScopes,
        code_challenge: transaction.challenge,
        code_challenge_method: "S256",
        state: transaction.state,
        nonce: transaction.nonce,
      }).toString();
      await this.#openExternal(authorizationUrl.toString());
      const authorizationCode = await callback.code;
      const tokenResponse = await this.#requestToken(metadata.token_endpoint, {
        grant_type: "authorization_code",
        client_id: studiCloudConfig.clerkClientId,
        redirect_uri: callback.redirectUri,
        code: authorizationCode,
        code_verifier: transaction.verifier,
      });
      if (!tokenResponse.refresh_token) throw new Error("Clerk did not return an offline refresh token");
      const verified = await this.#verifyIdentityToken(tokenResponse.id_token, transaction.nonce);
      this.#tokens = tokenSet(tokenResponse, tokenResponse.refresh_token, verified);
      this.#stored = { schemaVersion: 1, refreshToken: tokenResponse.refresh_token };
      return await this.#evaluateEntitlement();
    } catch (error) {
      this.#tokens = null;
      const message = isProtocolFailure(error)
        ? "Studi rejected an unverifiable sign-in response. Please try again."
        : "Studi could not finish sign-in. Check your connection and try again.";
      return this.#setState({ status: "signed_out", message });
    } finally {
      await callback.close().catch(() => undefined);
    }
  }

  async #evaluateEntitlement(): Promise<AuthState> {
    if (!this.#tokens) throw new Error("Authentication is no longer valid");
    const result = await this.#cloud.evaluate(this.#deviceId);
    if (!result.approved || !result.plan || result.credits === null) {
      this.#stored = { schemaVersion: 1, refreshToken: this.#tokens.refreshToken };
      await this.#vault.save(this.#stored);
      return this.#setState({
        status: "denied",
        user: this.#tokens.user,
        reason: result.reason ?? "waitlist",
        message: result.reason === "device_conflict"
          ? "This beta account already has another active Studi computer."
          : "This account is still on the Studi beta waitlist.",
      });
    }
    const entitlement = { plan: result.plan, credits: result.credits } as const;
    const offlineCache = createOfflineCache(this.#tokens.user, entitlement, this.#deviceId, result.checkedAt);
    this.#stored = { schemaVersion: 1, refreshToken: this.#tokens.refreshToken, offlineCache };
    await this.#vault.save(this.#stored);
    return this.#setState({
      status: "approved",
      user: this.#tokens.user,
      entitlement,
      deviceId: this.#deviceId,
      secureStorage: this.#vault.secureStorageAvailable,
    });
  }

  async #refresh(refreshToken: string): Promise<void> {
    const metadata = await this.#getMetadata();
    const tokenResponse = await this.#requestToken(metadata.token_endpoint, {
      grant_type: "refresh_token",
      client_id: studiCloudConfig.clerkClientId,
      refresh_token: refreshToken,
    }, true);
    const verified = await this.#verifyIdentityToken(tokenResponse.id_token);
    this.#tokens = tokenSet(tokenResponse, tokenResponse.refresh_token ?? refreshToken, verified);
  }

  async #freshIdentityToken(): Promise<string | null> {
    if (!this.#tokens) return null;
    if (this.#tokens.identityExpiresAt <= Date.now() + 60_000) {
      await this.#refresh(this.#tokens.refreshToken);
    }
    return this.#tokens.identityToken;
  }

  async #getMetadata(): Promise<z.infer<typeof MetadataSchema>> {
    if (this.#metadata) return this.#metadata;
    let response: Response;
    try {
      response = await this.#fetch(`${studiCloudConfig.clerkIssuer}/.well-known/openid-configuration`);
    } catch (error) {
      throw new AuthUnavailableError("Clerk metadata is unavailable", { cause: error });
    }
    if (!response.ok) throw new AuthUnavailableError(`Clerk metadata returned ${response.status}`);
    this.#metadata = MetadataSchema.parse(await response.json());
    if (this.#metadata.issuer !== studiCloudConfig.clerkIssuer) throw new AuthProtocolError("Clerk issuer mismatch");
    this.#jwks = createRemoteJWKSet(new URL(this.#metadata.jwks_uri));
    return this.#metadata;
  }

  async #requestToken(
    endpoint: string,
    parameters: Record<string, string>,
    refresh = false,
  ): Promise<z.infer<typeof TokenResponseSchema>> {
    let response: Response;
    try {
      response = await this.#fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(parameters),
      });
    } catch (error) {
      throw new AuthUnavailableError("Clerk token endpoint is unavailable", { cause: error });
    }
    if (!response.ok) {
      const errorText = (await response.text()).slice(0, 500);
      if (refresh && (response.status === 400 || response.status === 401)) {
        throw new AuthRevokedError("Stored Clerk credential was rejected");
      }
      if (response.status >= 500) throw new AuthUnavailableError(`Clerk token endpoint returned ${response.status}`);
      throw new AuthProtocolError(`Clerk token exchange failed: ${errorText}`);
    }
    return TokenResponseSchema.parse(await response.json());
  }

  async #verifyIdentityToken(identityToken: string, expectedNonce?: string): Promise<JWTPayload & { sub: string }> {
    const metadata = await this.#getMetadata();
    if (!this.#jwks) throw new AuthProtocolError("Clerk verification keys are unavailable");
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(identityToken, this.#jwks, {
        issuer: metadata.issuer,
        audience: studiCloudConfig.clerkClientId,
      }));
    } catch (error) {
      throw new AuthProtocolError("Clerk identity token verification failed", { cause: error });
    }
    if (!payload.sub) throw new AuthProtocolError("Clerk identity token has no subject");
    if (expectedNonce !== undefined && payload.nonce !== expectedNonce) throw new AuthProtocolError("Clerk identity nonce mismatch");
    return payload as JWTPayload & { sub: string };
  }

  async #recoverStartup(error: unknown): Promise<AuthState> {
    if (isCredentialRejection(error)) {
      await this.#eraseCredentials();
      return this.#setState({ status: "signed_out", message: "Your Studi sign-in expired. Sign in again." });
    }
    const offline = this.#offlineState();
    if (offline) return this.#setState(offline);
    return this.#setState({ status: "error", message: "Studi could not verify beta access. Check your connection and retry.", recoverable: true });
  }

  #offlineState(): AuthState | null {
    const cache = validOfflineCache(this.#stored?.offlineCache, this.#deviceId);
    if (!cache) return null;
    return offlineState(cache);
  }

  async #eraseCredentials(): Promise<void> {
    this.#tokens = null;
    this.#stored = null;
    this.#cloud.clearAuth();
    await this.#vault.clearCredentials();
  }

  #setState(state: AuthState): AuthState {
    this.#state = state;
    return state;
  }
}

class AuthProtocolError extends Error {}
class AuthUnavailableError extends Error {}
class AuthRevokedError extends Error {}

function tokenSet(
  response: z.infer<typeof TokenResponseSchema>,
  refreshToken: string,
  payload: JWTPayload & { sub: string },
): TokenSet {
  return {
    refreshToken,
    identityToken: response.id_token,
    identityExpiresAt: typeof payload.exp === "number" ? payload.exp * 1_000 : Date.now() + response.expires_in * 1_000,
    user: {
      subject: payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
      name: typeof payload.name === "string" && payload.name.trim() ? payload.name.slice(0, 200) : null,
    },
  };
}

function offlineState(cache: OfflineApprovalCache): AuthState {
  return {
    status: "offline",
    user: cache.user,
    entitlement: cache.entitlement,
    deviceId: cache.deviceId,
    checkedAt: cache.checkedAt,
    expiresAt: cache.expiresAt,
  };
}

function isCredentialRejection(error: unknown): boolean {
  if (error instanceof AuthRevokedError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /unauthenticated|authentication is no longer valid|invalid token|token.*rejected/i.test(message);
}

function isProtocolFailure(error: unknown): boolean {
  return error instanceof AuthProtocolError || /callback validation|nonce|authorization was not completed/i.test(error instanceof Error ? error.message : String(error));
}
