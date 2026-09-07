"use client";

import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import { InkyMascot } from "./inky-mascot";
import styles from "./dashboard-overview.module.css";

type Overview = FunctionReturnType<typeof api.account.portalOverview>;

export function DashboardLoading() {
  return (
    <div className={styles.loading} role="status">
      <span aria-hidden="true">
        <InkyMascot state="thinking" size={100} />
      </span>
      <p>One moment…</p>
    </div>
  );
}

export function DashboardOverview({ overview }: { overview: Overview }) {
  const firstName = overview.name?.trim().split(/\s+/)[0] || "there";
  const approved = overview.access === "approved";
  const waiting = overview.access === "waitlist";
  const hasActivity =
    overview.usage.assignments > 0 || overview.usage.browserMinutes > 0;
  const month = new Date(
    `${overview.usage.period}-01T00:00:00Z`,
  ).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

  return (
    <div className={styles.dashboard}>
      <section className={styles.welcome} aria-labelledby="dashboard-greeting">
        <div className={styles.inky} aria-hidden="true">
          <InkyMascot
            state={approved ? "hello" : waiting ? "waiting" : "needs"}
            size={190}
          />
        </div>
        <div className={styles.message}>
          <h1 id="dashboard-greeting">Hey, {firstName}.</h1>
          <p>
            {approved
              ? "Ready when you are."
              : waiting
                ? "Your spot is saved. I’ll email you when it’s your turn."
                : "Your access is paused. Let’s sort it out."}
          </p>
          {approved ? (
            <Link className="btn primary" href="/connect/desktop">
              Let’s open Studi <span aria-hidden="true">↗</span>
            </Link>
          ) : !waiting ? (
            <Link className="btn primary" href="/feedback">
              Get help <span aria-hidden="true">↗</span>
            </Link>
          ) : null}
        </div>
      </section>

      {approved && (
        <dl className={styles.account} aria-label="Account summary">
          <div>
            <dt>Plan</dt>
            <dd>
              {overview.plan === "supporter"
                ? "Supporter"
                : overview.plan === "beta"
                  ? "Private beta"
                  : "No active plan"}
            </dd>
          </div>
          {overview.credits !== null && (
            <div>
              <dt>Credits</dt>
              <dd>{overview.credits.toLocaleString()}</dd>
            </div>
          )}
          <div>
            <dt>Computer</dt>
            <dd>{overview.desktop.connected ? "Linked" : "Not linked yet"}</dd>
          </div>
        </dl>
      )}

      {hasActivity && (
        <section className={styles.activity} aria-labelledby="activity-title">
          <h2 id="activity-title">{month} so far</h2>
          <dl className={styles.stats}>
            <div>
              <dt>assignments</dt>
              <dd>{overview.usage.assignments.toLocaleString()}</dd>
            </div>
            <div>
              <dt>browser minutes</dt>
              <dd>{overview.usage.browserMinutes.toLocaleString()}</dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}
