import { UserProfile } from "@clerk/nextjs";

export default function SettingsPage() {
  return (
    <>
      <header className="account-heading">
        <div>
          <p className="kicker">Account settings</p>
          <h1>You, according to Studi.</h1>
          <p>Change your name, email, password, security, and active sessions through Clerk.</p>
        </div>
      </header>
      <section className="account-panel clerk-frame">
        <UserProfile routing="path" path="/settings" />
      </section>
    </>
  );
}
