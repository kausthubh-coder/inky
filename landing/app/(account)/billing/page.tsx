export default function BillingPage() {
  return (
    <>
      <header className="account-heading">
        <div>
          <p className="kicker">Your beta pass</p>
          <h1>Inky is free during the private beta.</h1>
          <p>No card, trial clock, or surprise charge. If that ever changes, Inky will ask first.</p>
        </div>
      </header>
      <section className="account-panel free-pass-card">
        <span className="status-chip approved">Private beta</span>
        <h2>$0. Yours while the beta is running.</h2>
        <p>Your invitation includes the desktop app, daily school scans, saved answers, and the option to let Inky submit only when you tell it to.</p>
        <p className="account-note">You do not need to add a payment method.</p>
      </section>
    </>
  );
}
