import { UpdateControls } from "./UpdateControls.js";
import { Icon } from "./Icon.js";
import { useState, type ReactNode } from "react";

import { DEFAULT_AGENT_PROVIDER_ID, agentProviderName, agentRuntimeAttentionCopy, providerLoginActive, selectedProvider, type AgentRuntimeAttention, type ProviderLoginHandoff, type StudiWorkspaceState } from "../../shared/index.js";

export type AppScreen = "week" | "settings" | "learn";
export type SettingsLanding = "settings" | "usage" | "feedback" | "rules";

// The bar holds only what the student uses: home, the two modes, the school check, an update when one is
// ready, and settings. Notifications arrive from the OS; account, usage and feedback live in Settings.
export function AppChrome({
  schoolStatus,
  onSchool,
  screen,
  onNavigate,
}: {
  schoolStatus?: string;
  onSchool?: () => void;
  chatName?: string | undefined;
  screen: AppScreen;
  onNavigate: (screen: AppScreen, landing?: SettingsLanding) => void;
}) {
  const schoolTone = schoolStatus === "Checking school now" || schoolStatus === "School check paused" ? "is-busy" : schoolStatus === "School needs sign-in" ? "is-attention" : "is-ok";
  return (
    <header className="app-chrome">
      <button className="brand-lockup brand-home" type="button" onClick={() => onNavigate("week")} aria-label="Open dashboard"><strong>studi</strong></button>
      <nav className={`rd-mode-switch ${screen === "learn" ? "is-learn" : ""}`} aria-label="Studi mode">{screen !== "settings" && <span className="rd-mode-thumb" aria-hidden="true" />}<button aria-current={screen === "week" ? "page" : undefined} onClick={() => onNavigate("week")}>Homework</button><button aria-current={screen === "learn" ? "page" : undefined} onClick={() => onNavigate("learn")}>Learn</button></nav>
      <div className="chrome-end">
        {onSchool && <button className={`rd-chrome-icon rd-school-status ${schoolTone}`} aria-label={schoolStatus ?? "School check"} title={schoolStatus ?? "School check"} onClick={onSchool}><Icon name="school" size={19} />{schoolTone !== "is-ok" && <span>{schoolStatus}</span>}<i aria-hidden="true" /></button>}
        <UpdateControls />
        <button className="chrome-settings" type="button" aria-label="Settings" title="Settings" aria-current={screen === "settings" ? "page" : undefined} onClick={() => onNavigate("settings", "settings")}><Icon name="settings" size={19} /></button>
      </div>
    </header>
  );
}

export function PaperCard({ id, tone = "paper", className = "", children }: { id?: string; tone?: "paper" | "yellow" | "coral" | "mint" | "sky" | "pink" | "lavender"; className?: string; children: ReactNode }) {
  return <section id={id} className={`paper-card tone-${tone} ${className}`}>{children}</section>;
}

export function StatusPill({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "mint" | "yellow" | "coral" | "pink" | "sky" }) {
  return <span className={`status-pill status-pill--${tone}`}>{children}</span>;
}

export interface ProviderLoginActions {
  /** Hands over a code the student pasted when the browser sign-in did not come back on its own. */
  onCompleteLogin?: ((code: string) => void) | undefined;
  /** Abandons the attempt, or clears a failed one so the student can choose again. */
  onCancelLogin?: (() => void) | undefined;
  /** Starts the same subscription's sign-in again after it failed or expired. */
  onRetryLogin?: (() => void) | undefined;
}

/** Everything a student needs to finish one subscription sign-in. Tokens never reach this view. */
export function ProviderLoginHandoffView({ login, busy, onCompleteLogin, onCancelLogin, onRetryLogin }: ProviderLoginActions & {
  login: ProviderLoginHandoff | null | undefined;
  busy: boolean;
}) {
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  if (!login) return null;
  const name = agentProviderName(login.providerId);
  if (login.phase === "starting") {
    return <div className="provider-login"><span className="spinner spinner--small" aria-hidden="true" /><div><strong>Opening the {name} sign-in…</strong></div></div>;
  }
  if (login.phase === "failed" || login.phase === "expired") {
    return (
      <div className="provider-login">
        <div><strong>{login.phase === "expired" ? "That sign-in expired." : "That sign-in didn't work."}</strong><small>Try once more.</small></div>
        {onRetryLogin && <button type="button" className="button button--yellow" onClick={onRetryLogin} disabled={busy}>Try again</button>}
        {onCancelLogin && <button type="button" className="button" onClick={onCancelLogin} disabled={busy}>Dismiss</button>}
      </div>
    );
  }
  const copyCode = async () => {
    if (login.phase !== "waiting") return;
    try {
      await navigator.clipboard.writeText(login.userCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch { /* The student can still read the code. */ }
  };
  const submitCode = (event: { preventDefault(): void }) => {
    event.preventDefault();
    const pasted = code.trim();
    if (!pasted || !onCompleteLogin) return;
    onCompleteLogin(pasted);
    setCode("");
  };
  return (
    <div className="provider-login provider-login--code">
      {login.phase === "waiting" ? (
        <>
          <p>Type this code on the {name} page that opened.</p>
          <p className="provider-code" data-secret>{login.userCode}</p>
          <p><a href={login.verificationUri} target="_blank" rel="noreferrer">Open that page again</a></p>
        </>
      ) : (
        <>
          <p>Sign in to {name} on the page that opened. I'll notice when you're done.</p>
          <p><a href={login.authorizationUrl} target="_blank" rel="noreferrer">Open that page again</a></p>
          {onCompleteLogin && (
            <form className="provider-paste" onSubmit={submitCode}>
              <label>Didn't come back here? Paste the code from that page.<input data-secret value={code} onChange={(event) => setCode(event.target.value)} placeholder="Paste the code" autoComplete="off" spellCheck={false} /></label>
              <button type="submit" className="button" disabled={busy || !code.trim()}>Use this code</button>
            </form>
          )}
        </>
      )}
      <div className="provider-login-actions">
        {login.phase === "waiting" && <button type="button" className="button" onClick={() => void copyCode()} disabled={busy}>{copied ? "Copied" : "Copy code"}</button>}
        {onCancelLogin && <button type="button" className="button" onClick={onCancelLogin} disabled={busy}>Cancel</button>}
      </div>
    </div>
  );
}

export function RuntimeAttentionBanner({
  attention,
  workspace,
  busy,
  onConnect,
  onSwitchProvider,
  onCompleteLogin,
  onCancelLogin,
}: ProviderLoginActions & {
  attention: AgentRuntimeAttention;
  workspace?: StudiWorkspaceState | null;
  busy: boolean;
  onConnect: () => void;
  /** Takes the student to the subscription settings when the current one ran out. */
  onSwitchProvider?: (() => void) | undefined;
}) {
  const login = workspace?.providerLogin;
  const loginActive = providerLoginActive(login);
  const kind = attention !== "none" ? attention : login ? "needs_login" : "none";
  const providerName = login ? agentProviderName(login.providerId) : workspace ? selectedProvider(workspace).providerName : agentProviderName(DEFAULT_AGENT_PROVIDER_ID);
  const copy = agentRuntimeAttentionCopy(kind, providerName);
  if (!copy) return null;
  const switching = kind === "usage" && onSwitchProvider;
  return (
    <div className={`truth-banner ${kind === "usage" ? "truth-banner--partial" : "truth-banner--error"}`}>
      <strong>{copy.title}</strong>
      <span>{copy.body}</span>
      <ProviderLoginHandoffView login={login} busy={busy} onCompleteLogin={onCompleteLogin} onCancelLogin={onCancelLogin} />
      <button type="button" onClick={switching ? onSwitchProvider : onConnect} disabled={busy || loginActive}>
        {switching ? "Use another subscription" : loginActive ? `Waiting for ${providerName}…` : `Reconnect ${providerName}`}
      </button>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function formatDue(value?: string): string {
  if (!value) return "No due time";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function executionLabel(phase: string): string {
  return ({ working: "working visibly", needs_user: "waiting for you", ready_review: "ready for review", submitting: "verifying submission", submitted: "submitted", preserved: "saved locally", failed: "stopped" } as Record<string, string>)[phase] ?? phase.replaceAll("_", " ");
}
