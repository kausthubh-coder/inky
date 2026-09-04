"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "../../../../convex/_generated/api";
import { track } from "../../../lib/analytics";

export default function DashboardPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const syncProfile = useMutation(api.account.syncWebProfile);
  const overview = useQuery(api.account.portalOverview, isAuthenticated ? {} : "skip");
  const synced = useRef(false);
  const viewed = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || synced.current) return;
    synced.current = true;
    void syncProfile({}).catch(() => undefined);
  }, [isAuthenticated, syncProfile]);

  useEffect(() => {
    if (!isAuthenticated || viewed.current) return;
    viewed.current = true;
    track("dashboard_viewed");
  }, [isAuthenticated]);

  if (isLoading || overview === undefined) {
    return <div className="account-panel account-loading">Inky is checking your seat…</div>;
  }

  const firstName = overview.name?.split(/\s+/)[0] || "there";
  const approved = overview.access === "approved";
  const waiting = overview.access === "waitlist";
  const statusClass = waiting ? " waiting" : approved ? "" : " revoked";

  return (
    <>
      <header className="account-heading">
        <div>
          <p className="kicker">Your Studi account</p>
          <h1>Hi, {firstName}.</h1>
          <p>One place for your seat, desktop, plan, and account.</p>
        </div>
      </header>

      <section className="dashboard-grid" aria-label="Account overview">
        <article className="dashboard-card dashboard-primary">
          <div>
            <span className={`status-pill${statusClass}`}>
              {approved ? "Seat ready" : waiting ? "On the waitlist" : "Seat paused"}
            </span>
            <h2>{approved ? "Open Studi. I’ll take it from here." : waiting ? "I saved your place." : "Your seat needs a quick check."}</h2>
            <p>
              {approved
                ? "The desktop will open Clerk in your browser and finish a fresh PKCE sign-in. Your password and tokens never pass through this page."
                : waiting
                  ? "I’ll email you when your seat opens. You can set up your account now, so there is nothing else to remember later."
                  : "Your account is signed in, but beta access is paused. Your local schoolwork has not been changed."}
            </p>
          </div>
          <div className="dashboard-actions">
            {approved ? <a className="btn primary" href="/connect/desktop">Open Studi</a> : null}
            <a className="btn" href="/settings">Account settings</a>
          </div>
        </article>

        <article className="dashboard-card">
          <p className="eyebrow">Plan</p>
          <h2>{overview.plan === "supporter" ? "Supporter" : overview.plan === "beta" ? "Private beta" : "No active plan"}</h2>
          <p>{overview.credits === null ? "Your plan will appear when your seat opens." : `${overview.credits.toLocaleString()} credits available.`}</p>
          <div className="dashboard-actions">
            <a className="btn" href="/billing">Beta plan</a>
          </div>
        </article>

        <article className="dashboard-card">
          <p className="eyebrow">Desktop</p>
          <h2>{overview.desktop.connected ? "Connected" : "Not connected yet"}</h2>
          <p>{overview.desktop.connected ? "This account already has a Studi computer." : "Open Studi on the computer where you want Inky to work."}</p>
          <div className="dashboard-actions">
            <a className="btn" href="/connect/desktop">{overview.desktop.connected ? "Open desktop" : "Connect desktop"}</a>
          </div>
        </article>

        <article className="dashboard-card" style={{ gridColumn: "1 / -1" }}>
          <p className="eyebrow">This month</p>
          <div className="metric-row">
            <div className="metric"><strong>{overview.usage.assignments.toLocaleString()}</strong><span>assignments</span></div>
            <div className="metric"><strong>{overview.usage.browserMinutes.toLocaleString()}</strong><span>browser minutes</span></div>
            <div className="metric"><strong>{overview.usage.agentTokens.toLocaleString()}</strong><span>agent tokens</span></div>
          </div>
        </article>
      </section>
    </>
  );
}
