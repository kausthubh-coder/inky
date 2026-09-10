import { useId } from "react";
import { connectedAppCatalogEntry, connectedAppIsActive, type ConnectedAppConnection } from "../../shared/index.js";
import type { ConnectionFeedback } from "./useConnectedApps.js";

export function ConnectedAppRow({ toolkit, connection, feedback, access, disabled, onboarding = false, onConnect, onCheck }: {
  toolkit: string;
  connection: ConnectedAppConnection | null;
  feedback: ConnectionFeedback | undefined;
  access: string;
  disabled: boolean;
  onboarding?: boolean;
  onConnect: (toolkit: string) => void;
  onCheck: (toolkit: string) => void;
}) {
  const statusId = useId();
  const app = connectedAppCatalogEntry(toolkit);
  const active = connectedAppIsActive(connection);
  const status = connection?.status.toUpperCase();
  const waiting = status === "INITIATED" || status === "INITIALIZING";
  const pending = feedback?.phase === "checking" || feedback?.phase === "connecting";
  const failed = feedback?.phase === "error";
  const checked = feedback?.phase === "checked";
  const needsReconnect = Boolean(connection && !active && !waiting && status !== "DISCONNECTED");
  let tone = pending ? "sky" : failed || needsReconnect ? "coral" : active ? "mint" : waiting ? "yellow" : "plain";
  let message = feedback?.phase === "checking" ? "Checking connection…"
    : feedback?.phase === "connecting" ? "Opening sign-in…"
    : failed ? feedback.operation === "check" ? "Couldn't check. Try again." : "Couldn't open sign-in. Try again."
    : active ? checked ? "All good · connected" : "Connected"
    : waiting ? checked && feedback.operation === "check" ? "Still waiting — finish signing in." : "Finish signing in in your browser."
    : needsReconnect ? "Connection expired or unavailable. Sign in again."
    : checked ? "No connection found. Connect again." : "Not connected";
  let label = feedback?.phase === "checking" ? "Checking…"
    : feedback?.phase === "connecting" ? "Opening…"
    : failed ? "Try again" : active ? "Check" : waiting ? "I finished" : needsReconnect || checked ? "Reconnect" : "Connect";
  const check = failed ? feedback.operation === "check" : active || waiting;
  if (onboarding) {
    const needsRedo = failed || needsReconnect || waiting;
    tone = pending ? "sky" : needsRedo ? "coral" : active ? "mint" : "plain";
    message = pending ? feedback.phase === "connecting" ? "Connecting… Finish signing in in your browser." : "Checking connection…"
      : failed || needsReconnect ? "Connection failed." : waiting ? "Sign-in wasn't finished." : active ? "Connected" : "Not connected";
    label = pending ? feedback.phase === "connecting" ? "Connecting…" : "Checking…" : needsRedo ? "Redo" : "Connect";
  }

  return (
    <div className={onboarding ? "fable-pick fable-connected-app" : "connected-app-row"} data-connected-app={toolkit}>
      <img className="connected-app-logo" src={app.logoUrl} alt="" loading="lazy" />
      <span className="connected-app-copy">
        <strong>{app.label}</strong>
        {!onboarding && <small>{app.description}</small>}
        <small>{access}</small>
        <span className={`connection-feedback connection-feedback--${tone}`} id={statusId} role="status" aria-live="polite" aria-atomic="true">
          <i className={pending ? "connection-feedback__spinner" : "connection-feedback__mark"} aria-hidden="true">{pending ? null : failed || needsReconnect ? "!" : active ? "✓" : waiting ? "…" : "·"}</i>
          {message}
        </span>
      </span>
      {!(onboarding && active && !pending && !failed) && <button className={onboarding ? "fable-button" : "quiet-button"} type="button" disabled={disabled || pending} aria-describedby={statusId} onClick={() => !onboarding && check ? onCheck(toolkit) : onConnect(toolkit)}>{label}</button>}
    </div>
  );
}
