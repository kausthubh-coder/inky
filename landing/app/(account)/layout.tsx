import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AccountShell } from "../../components/account-shell";

export const dynamic = "force-dynamic";

export default async function SignedInLayout({ children }: { children: ReactNode }) {
  const configured = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
      && process.env.CLERK_SECRET_KEY
      && process.env.NEXT_PUBLIC_CONVEX_URL,
  );

  if (!configured) {
    return (
      <main className="auth-page">
        <section className="config-card">
          <p className="kicker">Studi account</p>
          <h1>The account door is not connected yet.</h1>
          <p>Add the Clerk and Convex values from <code>landing/.env.example</code>, then restart the landing app.</p>
          <a className="btn primary" href="/">Back home</a>
        </section>
      </main>
    );
  }

  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return <AccountShell>{children}</AccountShell>;
}
