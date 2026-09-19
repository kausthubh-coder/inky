import { z } from "zod";

/**
 * The subscriptions a student can bring to Studi. Each row is a Pi provider that signs in with
 * a subscription OAuth flow, never an API key. Nothing outside this file should name a provider.
 */
export const AgentProviderIdSchema = z.enum(["openai-codex", "anthropic"]);
export type AgentProviderId = z.infer<typeof AgentProviderIdSchema>;

export interface AgentProviderEntry {
  readonly id: AgentProviderId;
  /** The name a student knows the subscription by. */
  readonly name: string;
  /** What the student needs to own for the sign-in to work. */
  readonly plan: string;
  /** device_code: Studi shows a code to type. browser: the browser page hands the sign-in back. */
  readonly signIn: "device_code" | "browser";
  /** Where the student signs in, shown as a fallback link when the browser did not open. */
  readonly signInUrl: string;
  /** Preferred model ids, best first. The first one installed in the Pi catalog wins. */
  readonly preferredModelIds: readonly string[];
}

export const DEFAULT_AGENT_PROVIDER_ID: AgentProviderId = "openai-codex";
export const DEFAULT_AGENT_MODEL_ID = "gpt-5.6-sol";

export const AGENT_PROVIDERS: readonly AgentProviderEntry[] = [
  {
    id: DEFAULT_AGENT_PROVIDER_ID,
    name: "ChatGPT",
    plan: "ChatGPT Plus or Pro",
    signIn: "device_code",
    signInUrl: "https://chatgpt.com/auth/device",
    preferredModelIds: [DEFAULT_AGENT_MODEL_ID, "gpt-5.6-terra"],
  },
  {
    id: "anthropic",
    name: "Claude",
    plan: "Claude Pro or Max",
    signIn: "browser",
    signInUrl: "https://claude.ai/login",
    preferredModelIds: ["claude-fable-5-1", "claude-opus-5", "claude-sonnet-5"],
  },
];

export function agentProvider(providerId: AgentProviderId): AgentProviderEntry {
  const entry = AGENT_PROVIDERS.find((provider) => provider.id === providerId);
  if (!entry) throw new Error(`Unknown Studi provider: ${providerId}`);
  return entry;
}

/** The student-facing name for a catalogued subscription, or the fallback for any other Pi provider. */
export function agentProviderName(providerId: string, fallback = providerId): string {
  return AGENT_PROVIDERS.find((provider) => provider.id === providerId)?.name ?? fallback;
}
