"use client";

import { useEffect, useState } from "react";

export default function ConnectDesktopPage() {
  const [opening, setOpening] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const downloadUrl = process.env.NEXT_PUBLIC_STUDI_WINDOWS_DOWNLOAD_URL;

  useEffect(() => {
    if (!opening) return;
    const timer = window.setTimeout(() => setShowHelp(true), 1800);
    return () => window.clearTimeout(timer);
  }, [opening]);

  return (
    <>
      <header className="account-heading">
        <div>
          <p className="kicker">Desktop handoff</p>
          <h1>Let’s get Inky onto this computer.</h1>
          <p>Your browser account makes sign-in faster. Studi still creates and verifies its own one-time PKCE transaction.</p>
        </div>
      </header>
      <section className="account-panel">
        <div className="connect-steps">
          <div className="connect-step"><strong>Open Studi</strong><span>The installed app receives only a connect command.</span></div>
          <div className="connect-step"><strong>Approve in Clerk</strong><span>Your signed-in browser can reuse this account.</span></div>
          <div className="connect-step"><strong>Return to the app</strong><span>Studi exchanges the code with its private PKCE verifier.</span></div>
        </div>
        <div className="dashboard-actions">
          <a className="btn primary" href="studi://connect" onClick={() => { setOpening(true); setShowHelp(false); }}>
            {opening ? "Opening Studi…" : "Open Studi"}
          </a>
          <a className="btn" href="/dashboard">Back to dashboard</a>
        </div>
        {showHelp ? (
          <p className="connect-note" role="status">
            Nothing opened? {downloadUrl ? <a href={downloadUrl}>Install Studi for Windows</a> : "Install the Studi desktop app, then press Open Studi again."}
          </p>
        ) : null}
      </section>
    </>
  );
}
