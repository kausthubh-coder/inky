import { UserProfile } from "@clerk/nextjs";

export default function SettingsPage() {
  return (
    <>
      <header className="account-heading">
        <h1>Settings</h1>
      </header>
      <section className="clerk-frame" aria-label="Account settings">
        <UserProfile
          routing="path"
          path="/settings"
          appearance={{
            elements: {
              rootBox: { width: "100%" },
              cardBox: {
                width: "100%",
                height: "auto",
                border: "2px solid var(--ink)",
                borderRadius: "var(--wobble)",
                boxShadow: "3px 3px 0 var(--line)",
                background: "var(--paper-2)",
              },
              scrollBox: {
                background: "transparent",
                boxShadow: "none",
                border: "0",
                borderRadius: "0",
              },
              navbar: { background: "transparent" },
              pageScrollBox: { padding: "clamp(16px, 3vw, 32px)" },
            },
          }}
        />
      </section>
    </>
  );
}
