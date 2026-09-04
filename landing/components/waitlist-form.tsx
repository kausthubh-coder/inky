"use client";

import { useState, type FormEvent, type ReactNode } from "react";

type WaitlistFormProps = {
  emailId: string;
  finePrint: ReactNode;
  joined: boolean;
  onJoined: () => void;
  darkButton?: boolean;
};

export function WaitlistForm(props: WaitlistFormProps) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <p className="form-error" role="alert">
        The waitlist is being connected. Check back in a little while.
      </p>
    );
  }

  return <ClerkWaitlistForm {...props} />;
}

function ClerkWaitlistForm({
  emailId,
  finePrint,
  joined,
  onJoined,
  darkButton = false,
}: WaitlistFormProps) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, company: "" }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Waitlist request failed");
      onJoined();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message === "Enter a real email address"
          ? cause.message
          : "Something on my end hiccuped. Give it a second and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (joined) {
    return (
      <p className="ok-msg" role="status">
        You’re on the list. Check your inbox for confirmation, then I’ll write again when your seat opens.
      </p>
    );
  }

  return (
    <form className="join" onSubmit={onSubmit}>
      <label className="visually-hidden" htmlFor={emailId}>
        Email
      </label>
      <div className="join-row">
        <input
          id={emailId}
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={busy}
        />
        <button
          type="submit"
          className={`btn primary${darkButton ? " dark" : ""}`}
          disabled={busy}
        >
          {busy ? "Saving…" : "Save my seat"}
        </button>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="fine">{finePrint}</p>
    </form>
  );
}
