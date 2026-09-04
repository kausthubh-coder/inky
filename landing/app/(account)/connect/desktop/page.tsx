"use client";

import { useEffect, useState } from "react";

export default function ConnectDesktopPage() {
  const [opening, setOpening] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const windowsDownloadUrl = process.env.NEXT_PUBLIC_STUDI_WINDOWS_DOWNLOAD_URL;
  const macDownloadUrl = process.env.NEXT_PUBLIC_STUDI_MAC_DOWNLOAD_URL;

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
        {windowsDownloadUrl || macDownloadUrl ? (
          <div className="connect-note">
            <strong>Need the app first?</strong>
            <div className="download-links">
              {windowsDownloadUrl ? <a className="btn" href={windowsDownloadUrl}>Download for Windows</a> : null}
              {macDownloadUrl ? <a className="btn" href={macDownloadUrl}>Download for Mac</a> : null}
            </div>
          </div>
        ) : null}
        {showHelp ? (
          <div className="connect-note" role="status">
            <strong>Nothing opened?</strong>
            <span>{windowsDownloadUrl || macDownloadUrl ? "Download Studi above, install it, then press Open Studi again." : "Install Studi, then press Open Studi again."}</span>
          </div>
        ) : null}
      </section>
    </>
  );
}
