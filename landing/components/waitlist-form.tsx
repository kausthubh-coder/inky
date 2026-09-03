"use client";

import { useMutation } from "convex/react";
import { FormEvent, useState } from "react";
import { api } from "../../convex/_generated/api";

export function WaitlistForm() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return <p className="lead">Waitlist isn’t connected in this environment.</p>;
  }
  return <ConnectedWaitlistForm />;
}

function ConnectedWaitlistForm() {
  const join = useMutation(api.waitlist.join);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await join({ email });
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not join right now.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <p className="ok-msg on">You’re on the list. Go do something that isn’t a lab report.</p>;
  }

  return (
    <form className="form-block" onSubmit={onSubmit} noValidate>
      <label className="field">
        Campus email
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@school.edu"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      {error ? <p className="lead">{error}</p> : null}
      <div className="form-row">
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "Joining…" : "Join the waitlist"}
        </button>
      </div>
    </form>
  );
}
