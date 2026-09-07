"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { DashboardLoading } from "../../../components/dashboard-overview";
import styles from "./usage.module.css";

export default function UsagePage() {
  const { isAuthenticated } = useConvexAuth();
  const overview = useQuery(
    api.account.portalOverview,
    isAuthenticated ? {} : "skip",
  );

  if (overview === undefined) return <DashboardLoading />;

  const { usage, credits } = overview;
  const period = new Date(`${usage.period}-01T00:00:00Z`).toLocaleDateString(
    "en-US",
    {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    },
  );
  const empty =
    usage.assignments === 0 &&
    usage.browserMinutes === 0 &&
    usage.agentTokens === 0;

  return (
    <>
      <header className="account-heading">
        <h1>Usage</h1>
        <p>{period}</p>
      </header>
      <section
        className={`account-panel ${styles.sheet}`}
        aria-label="Monthly usage"
      >
        <dl className={styles.totals}>
          <div>
            <dt>Assignments</dt>
            <dd>{usage.assignments.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Browser minutes</dt>
            <dd>{usage.browserMinutes.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Agent tokens</dt>
            <dd>{usage.agentTokens.toLocaleString()}</dd>
          </div>
        </dl>
        {empty && <p className={styles.note}>No activity yet this month.</p>}
        <div className={styles.credits}>
          <span>Credits available</span>
          <strong>
            {credits === null
              ? "Available when your access opens"
              : credits.toLocaleString()}
          </strong>
        </div>
      </section>
    </>
  );
}
