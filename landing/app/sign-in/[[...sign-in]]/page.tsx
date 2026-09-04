import { SignIn } from "@clerk/nextjs";
import { SiteNav } from "../../../components/site-nav";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  const configured = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
  );

  return (
    <>
      <SiteNav flat />
      <main className="auth-page">
        {configured ? (
          <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/dashboard" />
        ) : (
          <section className="config-card">
            <p className="kicker">Sign in</p>
            <h1>This door is not connected yet.</h1>
            <p>Add the Clerk keys from <code>landing/.env.example</code>, then restart the landing app.</p>
            <a className="btn primary" href="/">Back home</a>
          </section>
        )}
      </main>
    </>
  );
}
