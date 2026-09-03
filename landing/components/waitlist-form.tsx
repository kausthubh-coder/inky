"use client";

import { useMutation } from "convex/react";
import { useState, type FormEvent, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";

type WaitlistFormProps = {
  emailId: string;
  finePrint: ReactNode;
  joined: boolean;
  onJoined: () => void;
  darkButton?: boolean;
};

export function WaitlistForm(props: WaitlistFormProps) {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <p className="form-error" role="alert">
        The waitlist is temporarily offline. Please try again soon.
      </p>
    );
  }

  return <ConnectedWaitlistForm {...props} />;
}

function ConnectedWaitlistForm({
  emailId,
  finePrint,
  joined,
  onJoined,
  darkButton = false,
}: WaitlistFormProps) {
  const join = useMutation(api.waitlist.join);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      await join({ email });
      onJoined();
    } catch {
      setError("Something on my end hiccuped. Give it a second and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (joined) {
    return (
      <p className="ok-msg" role="status">
        You’re on the list. I’ll email you once, when your seat opens.
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
          {busy ? "Saving…" : "Save me a seat"}
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
