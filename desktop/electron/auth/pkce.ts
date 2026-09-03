import { createHash, randomBytes } from "node:crypto";

export interface OAuthTransaction {
  readonly verifier: string;
  readonly challenge: string;
  readonly state: string;
  readonly nonce: string;
}

export function createOAuthTransaction(): OAuthTransaction {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
  };
}
