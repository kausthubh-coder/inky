import { useEffect, useRef, useState, type ReactNode } from "react";

import { agentRuntimeAttentionCopy, type AgentRuntimeAttention, type StudiWorkspaceState, type TelemetryState } from "../../shared/index.js";

export type AppScreen = "week" | "settings";
export type SettingsLanding = "settings" | "usage" | "feedback";

export function AppChrome({
  screen,
  settingsLanding,
  studentName,
  deskOpen,
  deskBusy,
  onNavigate,
  onOpenDesk,
  onSignOut,
}: {
  screen: AppScreen;
  settingsLanding: SettingsLanding;
  studentName: string;
  deskOpen: boolean;
  deskBusy: boolean;
  onNavigate: (screen: AppScreen, landing?: SettingsLanding) => void;
  onOpenDesk: () => void;
  onSignOut: () => void;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!accountOpen) return undefined;

    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !accountMenuRef.current?.contains(event.target)) {
        setAccountOpen(false);
      }
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAccountOpen(false);
      accountButtonRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [accountOpen]);

  const displayName = studentName || "Student";
  const closeAccountMenu = () => {
    setAccountOpen(false);
    setAccountNotice(null);
  };
  const openSettings = (landing: SettingsLanding) => {
    closeAccountMenu();
    onNavigate("settings", landing);
  };

  return (
    <header className="app-chrome">
      <button className="brand-lockup brand-home" type="button" onClick={() => onNavigate("week")} aria-label="Open dashboard"><strong>studi</strong></button>
      <div className="chrome-end">
        <button className={`desk-launch ${deskOpen ? "is-open" : ""} ${deskBusy ? "is-busy" : ""}`} type="button" onClick={onOpenDesk}>
          Inky’s desk
        </button>
        <div className="account-menu-wrap" ref={accountMenuRef}>
          <button ref={accountButtonRef} className="account-chip" type="button" aria-haspopup="menu" aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => { if (!open) setAccountNotice(null); return !open; })}>
            <span aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span>
            {displayName}
          </button>
          {accountOpen ? (
            <div className="account-menu" role="menu" aria-label="Profile menu">
              <ProfileMenuItem icon="usage" label="Usage" active={screen === "settings" && settingsLanding === "usage"} onClick={() => openSettings("usage")} />
              <ProfileMenuItem icon="invite" label="Invite friend" onClick={() => setAccountNotice("Invite friends is coming soon.")} />
              <ProfileMenuItem icon="feedback" label="Feedback" active={screen === "settings" && settingsLanding === "feedback"} onClick={() => openSettings("feedback")} />
              <ProfileMenuItem icon="settings" label="Settings" active={screen === "settings" && settingsLanding === "settings"} onClick={() => openSettings("settings")} />
              <ProfileMenuItem icon="logout" label="Log out" danger onClick={() => { closeAccountMenu(); onSignOut(); }} />
              {accountNotice ? <p className="account-menu__notice" role="status">{accountNotice}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

type ProfileMenuIconName = "usage" | "invite" | "feedback" | "settings" | "logout";

function ProfileMenuItem({ icon, label, active = false, danger = false, onClick }: { icon: ProfileMenuIconName; label: string; active?: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <button className={`${active ? "is-active" : ""} ${danger ? "is-danger" : ""}`} type="button" role="menuitem" onClick={onClick}>
      <ProfileMenuIcon name={icon} />
      <span>{label}</span>
      {danger ? null : <span className="account-menu__arrow" aria-hidden="true">›</span>}
    </button>
  );
}

function ProfileMenuIcon({ name }: { name: ProfileMenuIconName }) {
  const paths = {
    usage: <><path d="M4 12V8" /><path d="M8 12V4" /><path d="M12 12V6" /></>,
    invite: <><circle cx="6" cy="6" r="2.25" /><path d="M2.75 13c.45-2.2 1.55-3.25 3.25-3.25S8.8 10.8 9.25 13" /><path d="M12 4v4M10 6h4" /></>,
    feedback: <><path d="M3 3.5h10v7H7l-3.5 2v-2H3z" /><path d="M5.5 6h5M5.5 8h3.5" /></>,
    settings: <><circle cx="8" cy="8" r="2.25" /><path d="M8 2.5v1.1M8 12.4v1.1M2.5 8h1.1M12.4 8h1.1M4.1 4.1l.8.8M11.1 11.1l.8.8M11.9 4.1l-.8.8M4.9 11.1l-.8.8" /></>,
    logout: <><path d="M7 3H3.5v10H7" /><path d="M9.5 5.5 12 8l-2.5 2.5M6 8h6" /></>,
  } satisfies Record<ProfileMenuIconName, ReactNode>;

  return <svg className="account-menu__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function PaperCard({ id, tone = "paper", className = "", children }: { id?: string; tone?: "paper" | "yellow" | "coral" | "mint" | "sky" | "pink" | "lavender"; className?: string; children: ReactNode }) {
  return <section id={id} className={`paper-card tone-${tone} ${className}`}>{children}</section>;
}

export function StatusPill({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "mint" | "yellow" | "coral" | "pink" | "sky" }) {
  return <span className={`status-pill status-pill--${tone}`}>{children}</span>;
}

export function RuntimeAttentionBanner({
  attention,
  workspace,
  busy,
  onConnect,
}: {
  attention: AgentRuntimeAttention;
  workspace?: StudiWorkspaceState | null;
  busy: boolean;
  onConnect: () => void;
}) {
  const login = workspace?.providerLogin;
  const loginActive = login?.phase === "starting" || login?.phase === "waiting" || login?.phase === "failed" || login?.phase === "expired";
  const kind = attention !== "none" ? attention : loginActive ? "needs_login" : "none";
  const copy = agentRuntimeAttentionCopy(kind);
  if (!copy) return null;
  return (
    <div className={`truth-banner ${kind === "usage" ? "truth-banner--partial" : "truth-banner--error"}`}>
      <strong>{copy.title}</strong>
      <span>{copy.body}</span>
      {login?.phase === "waiting" && <p className="provider-code">{login.userCode}<small>Enter this at {login.verificationUri}</small></p>}
      {login?.phase === "starting" && <span>Getting your code…</span>}
      {(login?.phase === "failed" || login?.phase === "expired") && <span>{login.phase === "expired" ? "That code expired." : "Couldn't get a code."}</span>}
      <button type="button" onClick={onConnect} disabled={busy || login?.phase === "starting" || login?.phase === "waiting"}>
        {kind === "usage" ? "Connect another ChatGPT" : loginActive ? "Waiting for Codex…" : "Reconnect Codex"}
      </button>
    </div>
  );
}

export function TelemetryControls({
  telemetry,
  busy,
  onChange,
  onDebug,
}: {
  telemetry: TelemetryState | null;
  busy: boolean;
  onChange: (enabled: boolean, replayEnabled: boolean) => void;
  onDebug: (minutes: 0 | 30) => void;
}) {
  const configured = telemetry?.configured === true;
  return (
    <PaperCard tone="lavender" className="settings-card">
      <div className="card-heading"><div><p className="eyebrow">Privacy</p><h3>What I may share</h3></div><StatusPill tone={configured ? "mint" : "yellow"}>{configured ? "configured" : "local only"}</StatusPill></div>
      <label className="toggle-row"><input type="checkbox" checked={telemetry?.enabled ?? false} disabled={!configured || busy} onChange={(event) => onChange(event.target.checked, telemetry?.replayEnabled ?? true)} /><span><strong>Share product events</strong><small>Private beta includes messages, answers, tool activity, performance, and errors. Passwords, cookies, and credentials stay out.</small></span></label>
      <label className="toggle-row"><input type="checkbox" checked={telemetry?.replayEnabled ?? false} disabled={!configured || busy || !telemetry?.enabled} onChange={(event) => onChange(telemetry?.enabled ?? false, event.target.checked)} /><span><strong>Share Studi replay</strong><small>Records the Studi window, not the school page.</small></span></label>
      <button className="quiet-button" type="button" disabled={!configured || busy || !telemetry?.enabled} onClick={() => onDebug(telemetry?.debugUntil ? 0 : 30)}>{telemetry?.debugUntil ? "Stop beta debug" : "Enable beta debug for 30 minutes"}</button>
      <details><summary>Local inspector ({telemetry?.inspector.length ?? 0})</summary><div className="inspector">{(telemetry?.inspector.length ?? 0) === 0 ? <small>No upload-eligible envelopes yet.</small> : telemetry?.inspector.slice(-4).reverse().map((item) => <code key={`${item.capturedAt}-${item.event}`}>{JSON.stringify(item)}</code>)}</div></details>
    </PaperCard>
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
