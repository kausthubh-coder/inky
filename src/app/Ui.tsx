import type { ReactNode } from "react";

import type { TelemetryState } from "../../shared/index.js";

export type AppScreen = "week" | "library" | "settings";

export function AppChrome({
  screen,
  studentName,
  status,
  onNavigate,
}: {
  screen: AppScreen;
  studentName: string;
  status: string;
  onNavigate: (screen: AppScreen) => void;
}) {
  return (
    <header className="app-chrome">
      <div className="brand-lockup"><strong>studi <span className="brand-pencil" aria-hidden="true">✎</span></strong><small>{status}</small></div>
      <nav aria-label="Main navigation">
        <button className={screen === "week" ? "is-active" : ""} onClick={() => onNavigate("week")}>This week</button>
        <button className={screen === "library" ? "is-active" : ""} onClick={() => onNavigate("library")}>Library</button>
        <button className={screen === "settings" ? "is-active" : ""} onClick={() => onNavigate("settings")}>Settings</button>
      </nav>
      <span className="account-chip"><span aria-hidden="true">{(studentName || "S").slice(0, 1).toUpperCase()}</span>{studentName || "Student"}</span>
    </header>
  );
}

export function PaperCard({ tone = "paper", className = "", children }: { tone?: "paper" | "yellow" | "coral" | "mint" | "sky" | "pink" | "lavender"; className?: string; children: ReactNode }) {
  return <section className={`paper-card tone-${tone} ${className}`}>{children}</section>;
}

export function StatusPill({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "mint" | "yellow" | "coral" | "pink" | "sky" }) {
  return <span className={`status-pill status-pill--${tone}`}>{children}</span>;
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
      <div className="card-heading"><div><p className="eyebrow">Product evidence</p><h3>Privacy and telemetry</h3></div><StatusPill tone={configured ? "mint" : "yellow"}>{configured ? "configured" : "local only"}</StatusPill></div>
      <label className="toggle-row"><input type="checkbox" checked={telemetry?.enabled ?? false} disabled={!configured || busy} onChange={(event) => onChange(event.target.checked, telemetry?.replayEnabled ?? true)} /><span><strong>Share scrubbed product events</strong><small>No school content, URLs, answers, or browser data.</small></span></label>
      <label className="toggle-row"><input type="checkbox" checked={telemetry?.replayEnabled ?? false} disabled={!configured || busy || !telemetry?.enabled} onChange={(event) => onChange(telemetry?.enabled ?? false, event.target.checked)} /><span><strong>Share masked Studi replay</strong><small>The school browser is excluded from capture.</small></span></label>
      <button className="quiet-button" type="button" disabled={!configured || busy || !telemetry?.enabled} onClick={() => onDebug(telemetry?.debugUntil ? 0 : 30)}>{telemetry?.debugUntil ? "Stop beta debug" : "Enable beta debug for 30 minutes"}</button>
      <details><summary>Local scrubbed inspector ({telemetry?.inspector.length ?? 0})</summary><div className="inspector">{(telemetry?.inspector.length ?? 0) === 0 ? <small>No upload-eligible envelopes yet.</small> : telemetry?.inspector.slice(-4).reverse().map((item) => <code key={`${item.capturedAt}-${item.event}`}>{JSON.stringify(item)}</code>)}</div></details>
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
