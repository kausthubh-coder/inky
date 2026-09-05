import { SignUp } from "@clerk/nextjs";
import { SiteNav } from "../../../components/site-nav";

export const dynamic = "force-dynamic";

export default function SignUpPage() {
  const configured = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
  );

  return (
    <>
      <SiteNav flat />
      <main className="auth-page">
        {configured ? (
          <SignUp
            routing="path"
            path="/sign-up"
            signInUrl="/sign-in"
            forceRedirectUrl="/connect/desktop"
          />
        ) : (
          <section className="config-card">
            <p className="kicker">Private beta</p>
            <h1>Inky is getting this door ready.</h1>
            <p>Join the waitlist on the home page and Inky will write when your free seat opens.</p>
            <a className="btn primary" href="/#wait">Save my seat</a>
          </section>
        )}
      </main>
    </>
  );
}
